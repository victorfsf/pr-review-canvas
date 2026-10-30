// Your PRs and the Review queue, the project home page's two tables: what one fetch keeps of each
// open pull or merge request. Both forges answer in this one shape, so everything past the fetch
// (health, pending counts, stacks, sections, filters) never asks which forge it is on. A row holds
// facts only: logins, labels, counts and check states. What people wrote is read in memory to
// count what waits on whom, and never reaches the cache.
import { z } from 'zod'

/** The hidden marker of a canvas comment, and the commit its first line names. */
export const CANVAS_MARKER = '<!-- pr-review-canvas:v1'
export const CANVAS_COMMIT = /PR Review Canvas for commit ([0-9a-f]{7,40})/

/** A review posted from the canvas says so in its body, unless the reviewer turned that off. */
export const CANVAS_REVIEW = /pr-review canvas/i

const Count = z.number().int().nonnegative()
const When = z.string().nullable()

/**
 * One entry's interactions with a PR: how many approvals, change requests and comments still
 * stand, how many approvals or change requests were dismissed, and when the last approval,
 * change request and comment came (to pick whom the column names). An entry is a person, every
 * bot together, or what was posted from the canvas.
 */
export const ReviewerSchema = z.object({
  login: z.string(),
  kind: z.enum(['person', 'bots', 'canvas']),
  /** The bot logins a "Bots" entry stands for; empty for the others. */
  members: z.array(z.string()),
  approvals: Count,
  changesRequested: Count,
  comments: Count,
  dismissed: Count,
  lastApprovalAt: When,
  lastChangeRequestAt: When,
  lastCommentAt: When,
})
export type Reviewer = z.infer<typeof ReviewerSchema>

/** One check on the head commit: a GitHub check run or status, or a GitLab pipeline job. */
export const CheckSchema = z.object({
  name: z.string(),
  /**
   * `pending` is running; `queued` has not started; `expected` is a required check the forge is
   * still waiting to hear from, which may never come.
   */
  status: z.enum(['pass', 'fail', 'pending', 'queued', 'expected', 'skip']),
  /** When it came to be: a run a re-run just queued is new, however old the commit. */
  since: z.string().nullable(),
})
export type Check = z.infer<typeof CheckSchema>

export const ReviewDecisionSchema = z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED'])

/** One open pull or merge request, yours or in the Review queue, as a fetch keeps it. */
export const ListPullSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  author: z.string(),
  /** Its author is a bot, such as Renovate. */
  authorBot: z.boolean(),
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** When it last left draft; its creation when it never was one. */
  readyAt: z.string(),
  /** When it entered a merge queue (GitHub) or was set to merge when its pipeline passes (GitLab). */
  queuedAt: z.string().nullable(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headSha: z.string(),
  labels: z.array(z.string()),
  additions: Count,
  deletions: Count,
  reviewDecision: ReviewDecisionSchema.nullable(),
  /** You were asked to review it by name, not only through a team. */
  requested: z.boolean(),
  /** Who it asks to review it by name, people only. */
  requestedReviewers: z.array(z.string()),
  reviewers: z.array(ReviewerSchema),
  checks: z.array(CheckSchema),
  /** When the head commit was made, for telling stuck CI from slow CI. */
  headCommittedAt: z.string().nullable(),
  mergeable: z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
  /** The commits each canvas comment on it was made for, oldest first. */
  canvasShas: z.array(z.string()),
  /**
   * The attention points its latest canvas comment counts as not resolved by the author: those
   * for the author, and those for the reviewer; null without a canvas comment.
   */
  canvasOpen: z.object({ author: Count, reviewer: Count }).nullable(),
  /** What waits on you: on your PR, what to answer or fix; in the queue, what names you. */
  pending: Count,
  /** In the queue, what waits on the author or other reviewers; 0 on your own PRs. */
  waiting: Count,
})
export type ListPull = z.infer<typeof ListPullSchema>

/** One comment as the pending rules read it; `body` stays in memory. */
export interface Said {
  author: string
  bot: boolean
  createdAt: string
  body: string
}

/** One submitted review as the pending and reviewer rules read it. */
export interface ReviewNode {
  author: string
  bot: boolean
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'
  submittedAt: string
  /** How many inline comments it carried. */
  inline: number
  body: string
}

/** A review thread (GitHub) or a resolvable discussion (GitLab). */
export interface ThreadNode {
  resolved: boolean
  comments: Said[]
}

/** What one PR's activity brings, read in memory only, to count what waits on whom. */
export interface Activity {
  comments: Said[]
  reviews: ReviewNode[]
  threads: ThreadNode[]
}

/** Which list a fetch fills: the PRs you opened, or everyone else's waiting for review. */
export const LIST_KINDS = ['pulls', 'queue'] as const
export type ListKind = (typeof LIST_KINDS)[number]

/** One list as fetched: who you are on the forge, its PRs, and when it was read. */
export const ListSnapshotSchema = z.object({
  viewer: z.string(),
  fetchedAt: z.string(),
  pulls: z.array(ListPullSchema),
})
export type ListSnapshot = z.infer<typeof ListSnapshotSchema>

/** A forge's two reads, each of every open PR on its side, drafts too. */
export interface ListFetch {
  viewer: string
  pulls: ListPull[]
}

export interface ListFetcher {
  fetch(kind: ListKind): Promise<ListFetch>
  /**
   * One PR on one side, read alone: null when it is no longer open there (merged, closed, or on
   * the other side), so its row leaves the list as the next full read would drop it.
   */
  fetchOne(kind: ListKind, number: number): Promise<{ viewer: string; pull: ListPull | null }>
  /** The project's people, by login, that the Authors and Reviewers pickers offer: no bots. */
  fetchPeople(): Promise<string[]>
}

/** The project's people as last read, and when. */
export const PeopleSchema = z.object({ fetchedAt: z.string(), logins: z.array(z.string()) })
export type People = z.infer<typeof PeopleSchema>
