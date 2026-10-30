// The rules both forges' fetches share: who reviewed a PR and how, and what on it waits on whom.
// They read a PR's activity in memory; only their counts and logins reach the cache.
import {
  CANVAS_COMMIT,
  CANVAS_MARKER,
  CANVAS_REVIEW,
  type Activity,
  type Reviewer,
  type ReviewNode,
  type Said,
} from './model.js'

/** The later of two ISO times, either of which may be missing. */
function later(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return b > a ? b : a
}

/**
 * Who interacted with a PR and how often: every submitted approval and change request, and every
 * comment, inline or in the conversation. A review sent as "Comment" with no inline comments
 * counts as one comment. A dismissed review counts as dismissed, not as the approval or change
 * request it was, and its inline comments still count. The PR's own author is left out.
 *
 * People each get an entry. Every bot shares one, "Bots". Comments posted from the canvas (a
 * canvas comment, and the comments of a review that says it came from the canvas) go to one
 * "Canvas" entry; the approval or change request of such a review stays the reviewer's own.
 * People come first, those who requested changes, then those who approved, then by comments;
 * then Canvas, then Bots.
 */
export function reviewersOf(
  author: string,
  reviews: readonly ReviewNode[],
  comments: readonly Said[]
): Reviewer[] {
  const entries = new Map<string, Reviewer>()
  const entry = (key: string, login: string, kind: Reviewer['kind']): Reviewer => {
    let found = entries.get(key)
    if (found === undefined) {
      found = {
        login,
        kind,
        members: [],
        approvals: 0,
        changesRequested: 0,
        comments: 0,
        dismissed: 0,
        lastApprovalAt: null,
        lastChangeRequestAt: null,
        lastCommentAt: null,
      }
      entries.set(key, found)
    }
    return found
  }
  // Keys no login can take: logins have no spaces.
  const canvas = () => entry('canvas entry', 'Canvas', 'canvas')
  const entryOf = (login: string, bot: boolean): Reviewer | null => {
    if (login === author) return null
    if (!bot) return entry(login, login, 'person')
    const bots = entry('bots entry', 'Bots', 'bots')
    if (!bots.members.includes(login)) bots.members.push(login)
    return bots
  }
  const comment = (to: Reviewer, count: number, at: string) => {
    to.comments += count
    if (count > 0) to.lastCommentAt = later(to.lastCommentAt, at)
  }
  for (const review of reviews) {
    const who = entryOf(review.author, review.bot)
    if (who === null) continue
    const at = review.submittedAt
    const count = review.state === 'COMMENTED' && review.inline === 0 ? 1 : review.inline
    comment(CANVAS_REVIEW.test(review.body) ? canvas() : who, count, at)
    if (review.state === 'APPROVED') {
      who.approvals++
      who.lastApprovalAt = later(who.lastApprovalAt, at)
    }
    if (review.state === 'CHANGES_REQUESTED') {
      who.changesRequested++
      who.lastChangeRequestAt = later(who.lastChangeRequestAt, at)
    }
    if (review.state === 'DISMISSED') who.dismissed++
  }
  for (const c of comments) {
    const who = entryOf(c.author, c.bot)
    if (who === null) continue
    comment(c.body.includes(CANVAS_MARKER) ? canvas() : who, 1, c.createdAt)
  }
  const rank = (r: Reviewer) =>
    r.kind === 'bots' ? 4 : r.kind === 'canvas' ? 3 : r.changesRequested > 0 ? 0 : r.approvals > 0 ? 1 : 2
  return (
    [...entries.values()]
      // Someone whose only review was a canvas one with nothing else has nothing of their own left.
      .filter(r => r.approvals + r.changesRequested + r.comments + r.dismissed > 0)
      .sort((a, b) => rank(a) - rank(b) || b.comments - a.comments)
  )
}

/** Whether a text names `login` by name: `@login`, ignoring case, not inside a longer name. */
export function mentions(text: string, login: string): boolean {
  if (login === '') return false
  const escaped = login.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w@/-])@${escaped}(?![\\w-])`, 'i').test(text)
}

/** Each person's latest approval or change request, by login; bots and comments carry none. */
function latestDecisions(reviews: readonly ReviewNode[]): Map<string, ReviewNode> {
  const latest = new Map<string, ReviewNode>()
  for (const r of reviews) {
    if (r.bot || r.state === 'COMMENTED') continue
    const before = latest.get(r.author)
    if (before === undefined || r.submittedAt >= before.submittedAt) latest.set(r.author, r)
  }
  return latest
}

/** When `viewer` last wrote on the PR, in the conversation, a review or a thread; null for never. */
function lastWordOf(activity: Activity, viewer: string): string | null {
  let last: string | null = null
  for (const c of activity.comments) if (c.author === viewer) last = later(last, c.createdAt)
  for (const r of activity.reviews) if (r.author === viewer) last = later(last, r.submittedAt)
  for (const t of activity.threads)
    for (const c of t.comments) if (c.author === viewer) last = later(last, c.createdAt)
  return last
}

/**
 * What on one of your own PRs waits on you, as the Pending column counts it: each unresolved
 * thread whose latest comment is not yours (one only you wrote in, a self-review, until it is
 * resolved), each change request that still stands, and each comment people (not bots, not the
 * canvas) left in the conversation after your last word. Failing or stuck CI and a conflict count
 * too; the caller adds those, since they come from the checks.
 */
export function authorPending(activity: Activity, viewer: string): number {
  let count = 0
  for (const t of activity.threads) {
    if (t.resolved) continue
    const last = t.comments.at(-1)
    const onlyYou = t.comments.every(c => c.author === viewer)
    if (last !== undefined && (last.author !== viewer || onlyYou)) count++
  }
  for (const r of latestDecisions(activity.reviews).values()) {
    if (r.state === 'CHANGES_REQUESTED' && r.author !== viewer) count++
  }
  const spoke = lastWordOf(activity, viewer)
  for (const c of activity.comments) {
    if (c.author === viewer || c.bot || c.body.includes(CANVAS_MARKER)) continue
    if (spoke === null || c.createdAt > spoke) count++
  }
  return count
}

/**
 * A Review queue PR's comments that still stand, as you see them reviewing it: each unresolved
 * thread and each standing change request. One waits on you when someone names you in it after
 * your last word there; the rest wait on the author or another reviewer. Conversation comments and
 * reviews that name you after your last word on the PR wait on you too; the rest of the
 * conversation is news, not work. Checks and conflicts are the author's to fix, so they are left
 * out.
 */
export function reviewerPending(activity: Activity, viewer: string): { you: number; others: number } {
  let you = 0
  let others = 0
  const namesYouAfter = (items: readonly Said[]) => {
    let mine: string | null = null
    let named = false
    for (const c of items) {
      if (c.author === viewer) {
        mine = later(mine, c.createdAt)
        named = false
      } else if (mentions(c.body, viewer) && (mine === null || c.createdAt > mine)) {
        named = true
      }
    }
    return named
  }
  for (const t of activity.threads) {
    if (t.resolved) continue
    if (namesYouAfter(t.comments)) you++
    else others++
  }
  for (const r of latestDecisions(activity.reviews).values()) {
    if (r.state !== 'CHANGES_REQUESTED' || r.author === viewer) continue
    if (mentions(r.body, viewer)) you++
    else others++
  }
  const spoke = lastWordOf(activity, viewer)
  const after = (at: string) => spoke === null || at > spoke
  for (const c of activity.comments) {
    if (c.author !== viewer && after(c.createdAt) && mentions(c.body, viewer)) you++
  }
  for (const r of activity.reviews) {
    if (
      r.author !== viewer &&
      r.state !== 'CHANGES_REQUESTED' &&
      after(r.submittedAt) &&
      mentions(r.body, viewer)
    )
      you++
  }
  return { you, others }
}

/**
 * The attention points the latest canvas comment counts as not resolved by the author: its "Not
 * yet resolved by the author" ones and its "For the reviewer" ones (see `tallyMarkdown`). Null
 * without a canvas comment, or one whose tally does not read.
 */
export function canvasOpenOf(comments: readonly Said[]): { author: number; reviewer: number } | null {
  const latest = comments.filter(c => c.body.includes(CANVAS_MARKER)).at(-1)
  if (latest === undefined) return null
  const reviewer = /\*\*For the reviewer:\*\* (?:no open attention points|(\d+) attention points?)/.exec(
    latest.body
  )
  if (reviewer === null) return null
  const author = /\*\*Not yet resolved by the author:\*\* (\d+)/.exec(latest.body)
  return { author: Number(author?.[1] ?? 0), reviewer: Number(reviewer[1] ?? 0) }
}

/** The commits the canvas comments on a PR were made for, oldest first. */
export function canvasShasOf(comments: readonly Said[]): string[] {
  return comments.flatMap(c => {
    if (!c.body.includes(CANVAS_MARKER)) return []
    const sha = CANVAS_COMMIT.exec(c.body)?.[1]
    return sha === undefined ? [] : [sha]
  })
}
