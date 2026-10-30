// The two lists on GitHub: your open PRs, and everyone else's (the Review queue), each from one
// GraphQL search a page of 20 at a time. Each PR brings what its row shows and the activity its
// Pending count is made from; that activity's text stays in this function's memory.
import { z } from 'zod'
import type { Repo } from '../contract/review-artifact.js'
import type { HostClient } from '../host/client.js'
import type {
  Activity,
  Check,
  ListFetch,
  ListFetcher,
  ListKind,
  ListPull,
  ReviewNode,
  Said,
} from './model.js'
import { authorPending, canvasOpenOf, canvasShasOf, reviewerPending, reviewersOf } from './rules.js'

/** Fifty pages is a thousand open PRs; past that the list is cut, never fetched forever. */
export const MAX_PAGES = 50

const Account = z.object({ login: z.string(), kind: z.string().optional() }).nullable()

/** A bot by its account type, or by GitHub's `[bot]` suffix when the type is not given. */
export function isBotAccount(account: { login: string; kind?: string | undefined }): boolean {
  return account.kind === 'Bot' || account.login.endsWith('[bot]')
}

const RawContext = z.union([
  z.object({
    kind: z.literal('CheckRun'),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
    startedAt: z.string().nullable(),
    checkSuite: z.object({ createdAt: z.string() }).nullable(),
  }),
  z.object({ kind: z.literal('StatusContext'), context: z.string(), state: z.string() }),
])

const NodeSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  headRefOid: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  mergeable: z.string(),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
  author: Account,
  mergeQueueEntry: z.object({ enqueuedAt: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
  reviewRequests: z.object({
    nodes: z.array(z.object({ requestedReviewer: z.object({ login: z.string().optional() }).nullable() })),
  }),
  readyEvents: z.object({ nodes: z.array(z.object({ createdAt: z.string().optional() })) }),
  comments: z.object({
    nodes: z.array(z.object({ createdAt: z.string(), body: z.string(), author: Account })),
  }),
  reviews: z.object({
    nodes: z.array(
      z.object({
        state: z.string(),
        submittedAt: z.string().nullable(),
        body: z.string(),
        author: Account,
        comments: z.object({ totalCount: z.number().int().nonnegative() }),
      })
    ),
  }),
  reviewThreads: z.object({
    nodes: z.array(
      z.object({
        isResolved: z.boolean(),
        comments: z.object({
          nodes: z.array(z.object({ createdAt: z.string(), body: z.string(), author: Account })),
        }),
      })
    ),
  }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          committedDate: z.string().nullable(),
          statusCheckRollup: z.object({ contexts: z.object({ nodes: z.array(RawContext) }) }).nullable(),
        }),
      })
    ),
  }),
})
type Node = z.infer<typeof NodeSchema>

const SearchSchema = z.object({
  viewer: z.object({ login: z.string() }),
  search: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    // A search hit that is not a PR comes back as `{}`; it is skipped.
    nodes: z.array(z.record(z.string(), z.unknown())),
  }),
})

const PULL_FIELDS = `number title url isDraft createdAt updatedAt headRefName baseRefName headRefOid additions deletions mergeable reviewDecision
        repository { nameWithOwner }
        author { login kind: __typename }
        mergeQueueEntry { enqueuedAt }
        labels(first: 20) { nodes { name } }
        reviewRequests(first: 30) { nodes { requestedReviewer { ... on User { login } } } }
        readyEvents: timelineItems(last: 1, itemTypes: [READY_FOR_REVIEW_EVENT]) { nodes { ... on ReadyForReviewEvent { createdAt } } }
        comments(last: 50) { nodes { createdAt body author { login kind: __typename } } }
        reviews(last: 50) { nodes { state submittedAt body author { login kind: __typename } comments { totalCount } } }
        reviewThreads(first: 100) { nodes { isResolved comments(first: 50) { nodes { createdAt body author { login kind: __typename } } } } }
        commits(last: 1) { nodes { commit { committedDate statusCheckRollup { contexts(first: 100) { nodes {
          kind: __typename
          ... on CheckRun { name status conclusion startedAt checkSuite { createdAt } }
          ... on StatusContext { context state }
        } } } } } }`

export const LIST_QUERY = `query($q: String!, $cursor: String) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 20, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ${PULL_FIELDS} } }
  }
}`

export const PULL_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { state ${PULL_FIELDS} } }
}`

const OneSchema = z.object({
  viewer: z.object({ login: z.string() }),
  repository: z.object({ pullRequest: z.record(z.string(), z.unknown()).nullable() }).nullable(),
})

export const PEOPLE_QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { login }
    }
  }
}`

const PeopleSchema = z.object({
  repository: z
    .object({
      assignableUsers: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
        nodes: z.array(z.object({ login: z.string() })),
      }),
    })
    .nullable(),
})

/** The people with access to `repo`, as GitHub lists those a PR can be assigned to. */
export async function fetchGithubPeople(client: HostClient, repo: Repo): Promise<string[]> {
  const slug = `${repo.owner}/${repo.name}`
  const logins: string[] = []
  let cursor: string | null = null
  const vars = { owner: repo.owner, name: repo.name }
  for (let page = 0; page < MAX_PAGES; page++) {
    const parsed = PeopleSchema.safeParse(
      await client.graphql(PEOPLE_QUERY, cursor === null ? vars : { ...vars, cursor })
    )
    if (!parsed.success || parsed.data.repository === null) {
      throw new Error(`unexpected answer to the people of ${slug}`)
    }
    const { nodes, pageInfo } = parsed.data.repository.assignableUsers
    logins.push(...nodes.map(n => n.login))
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break
    cursor = pageInfo.endCursor
  }
  return logins
}

const FAILED_RUN = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'])
const SKIPPED_RUN = new Set(['SKIPPED', 'NEUTRAL', 'STALE'])
const QUEUED_RUN = new Set(['QUEUED', 'WAITING', 'PENDING', 'REQUESTED'])

/** One check run or commit status as a check. */
export function checkOf(context: z.infer<typeof RawContext>): Check {
  if (context.kind === 'CheckRun') {
    const { conclusion } = context
    const status =
      context.status !== 'COMPLETED' || conclusion === null
        ? QUEUED_RUN.has(context.status)
          ? 'queued'
          : 'pending'
        : FAILED_RUN.has(conclusion)
          ? 'fail'
          : SKIPPED_RUN.has(conclusion)
            ? 'skip'
            : 'pass'
    // A run a comment or re-run just queued is new however old the commit: the later of the two.
    const times = [context.startedAt, context.checkSuite?.createdAt].filter(
      (t): t is string => typeof t === 'string'
    )
    const since = times.length === 0 ? null : times.reduce((a, b) => (a >= b ? a : b))
    return { name: context.name, status, since }
  }
  const status =
    context.state === 'SUCCESS'
      ? 'pass'
      : context.state === 'FAILURE' || context.state === 'ERROR'
        ? 'fail'
        : context.state === 'EXPECTED'
          ? 'expected'
          : 'pending'
  return { name: context.context, status, since: null }
}

const who = (account: z.infer<typeof Account>) => ({
  author: account?.login ?? 'ghost',
  bot: account !== null && isBotAccount(account),
})

const REVIEW_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'])

/** A PR's activity, in memory: its conversation, its submitted reviews, its threads. */
export function activityOf(n: Node): Activity {
  const said = (c: { createdAt: string; body: string; author: z.infer<typeof Account> }): Said => ({
    ...who(c.author),
    createdAt: c.createdAt,
    body: c.body,
  })
  const reviews: ReviewNode[] = n.reviews.nodes.flatMap(r =>
    // A pending review is nobody's yet; it has no submit time.
    r.submittedAt === null || !REVIEW_STATES.has(r.state)
      ? []
      : [
          {
            ...who(r.author),
            state: r.state as ReviewNode['state'],
            submittedAt: r.submittedAt,
            inline: r.comments.totalCount,
            body: r.body,
          },
        ]
  )
  return {
    comments: n.comments.nodes.map(said),
    reviews,
    threads: n.reviewThreads.nodes.map(t => ({
      resolved: t.isResolved,
      comments: t.comments.nodes.map(said),
    })),
  }
}

/** One search hit as a row; null for another repo's PR, or one on the wrong side of the viewer. */
export function pullOf(n: Node, repo: Repo, viewer: string, kind: ListKind): ListPull | null {
  if (n.repository.nameWithOwner.toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase()) return null
  const author = n.author?.login ?? 'ghost'
  if ((author === viewer) !== (kind === 'pulls')) return null
  const activity = activityOf(n)
  const head = n.commits.nodes[0]?.commit
  const counts =
    kind === 'pulls'
      ? { pending: authorPending(activity, viewer), waiting: 0 }
      : queueCounts(activity, viewer)
  return {
    number: n.number,
    title: n.title,
    url: n.url,
    author,
    authorBot: n.author !== null && isBotAccount(n.author),
    isDraft: n.isDraft,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    readyAt: n.readyEvents.nodes.at(-1)?.createdAt ?? n.createdAt,
    queuedAt: n.mergeQueueEntry?.enqueuedAt ?? null,
    headRefName: n.headRefName,
    baseRefName: n.baseRefName,
    headSha: n.headRefOid,
    labels: n.labels.nodes.map(l => l.name),
    additions: n.additions,
    deletions: n.deletions,
    reviewDecision: n.reviewDecision,
    requested: n.reviewRequests.nodes.some(r => r.requestedReviewer?.login === viewer),
    requestedReviewers: n.reviewRequests.nodes.flatMap(r =>
      r.requestedReviewer?.login === undefined ? [] : [r.requestedReviewer.login]
    ),
    reviewers: reviewersOf(author, activity.reviews, activity.comments),
    checks: (head?.statusCheckRollup?.contexts.nodes ?? []).map(checkOf),
    headCommittedAt: head?.committedDate ?? null,
    mergeable: n.mergeable === 'MERGEABLE' || n.mergeable === 'CONFLICTING' ? n.mergeable : 'UNKNOWN',
    canvasShas: canvasShasOf(activity.comments),
    canvasOpen: canvasOpenOf(activity.comments),
    ...counts,
  }
}

function queueCounts(activity: Activity, viewer: string): { pending: number; waiting: number } {
  const { you, others } = reviewerPending(activity, viewer)
  return { pending: you, waiting: others }
}

/**
 * Every open PR on one side of `repo`, drafts included: yours newest first, or everyone else's
 * oldest first, as a queue waits. The search names the repo, and each hit is checked against it
 * too, so another repo's PR never lands in this one's list.
 */
export async function fetchGithubList(client: HostClient, repo: Repo, kind: ListKind): Promise<ListFetch> {
  const slug = `${repo.owner}/${repo.name}`
  const q =
    kind === 'pulls'
      ? `repo:${slug} is:pr is:open author:@me sort:created-desc`
      : `repo:${slug} is:pr is:open -author:@me sort:created-asc`
  const pulls: ListPull[] = []
  let viewer = ''
  let cursor: string | null = null
  const vars = { q }
  for (let page = 0; page < MAX_PAGES; page++) {
    const raw = await client.graphql(LIST_QUERY, cursor === null ? vars : { ...vars, cursor })
    const parsed = SearchSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`unexpected answer to the pull request search for ${slug}`)
    viewer = parsed.data.viewer.login
    for (const hit of parsed.data.search.nodes) {
      if (Object.keys(hit).length === 0) continue
      const node = NodeSchema.safeParse(hit)
      if (!node.success) throw new Error(`unexpected pull request in the search for ${slug}`)
      const pull = pullOf(node.data, repo, viewer, kind)
      if (pull !== null) pulls.push(pull)
    }
    const { hasNextPage, endCursor } = parsed.data.search.pageInfo
    if (!hasNextPage || endCursor === null) break
    cursor = endCursor
  }
  return { viewer, pulls }
}

/** One PR of `repo` on one side, read alone; null when it is not open there. */
export async function fetchGithubPull(
  client: HostClient,
  repo: Repo,
  kind: ListKind,
  number: number
): Promise<{ viewer: string; pull: ListPull | null }> {
  const slug = `${repo.owner}/${repo.name}`
  const parsed = OneSchema.safeParse(
    await client.graphql(PULL_QUERY, { owner: repo.owner, name: repo.name, number })
  )
  if (!parsed.success) throw new Error(`unexpected answer for #${number} in ${slug}`)
  const viewer = parsed.data.viewer.login
  const raw = parsed.data.repository?.pullRequest ?? null
  if (raw === null || raw['state'] !== 'OPEN') return { viewer, pull: null }
  const node = NodeSchema.safeParse(raw)
  if (!node.success) throw new Error(`unexpected pull request #${number} in ${slug}`)
  return { viewer, pull: pullOf(node.data, repo, viewer, kind) }
}

export function githubLists(client: HostClient, repo: Repo): ListFetcher {
  return {
    fetch: kind => fetchGithubList(client, repo, kind),
    fetchOne: (kind, number) => fetchGithubPull(client, repo, kind, number),
    fetchPeople: () => fetchGithubPeople(client, repo),
  }
}
