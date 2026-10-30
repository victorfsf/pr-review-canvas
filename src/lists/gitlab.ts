// The two lists on GitLab: your open merge requests, and everyone else's (the Review queue), from
// one GraphQL read of the project's open merge requests, 20 at a time, split by author. It asks
// only for fields GitLab has had for long, so a self-hosted instance answers too: approvals stand
// for reviews (GitLab keeps no change requests there), resolvable discussions are threads, other
// notes the conversation, and the head pipeline's jobs are the checks. The notes' text stays in
// this function's memory.
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
import { MAX_PAGES } from './github.js'
import { authorPending, canvasOpenOf, canvasShasOf, reviewerPending, reviewersOf } from './rules.js'

const User = z.object({ username: z.string(), bot: z.boolean().optional() }).nullable()

const NoteSchema = z.object({
  system: z.boolean(),
  body: z.string(),
  createdAt: z.string(),
  author: User,
})

const MrSchema = z.object({
  iid: z.string(),
  title: z.string(),
  webUrl: z.string(),
  draft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceBranch: z.string(),
  targetBranch: z.string(),
  diffHeadSha: z.string().nullable(),
  conflicts: z.boolean(),
  author: User,
  labels: z.object({ nodes: z.array(z.object({ title: z.string() })) }).nullable(),
  diffStatsSummary: z.object({ additions: z.number().int(), deletions: z.number().int() }).nullable(),
  approved: z.boolean().nullable().optional(),
  approvedBy: z.object({ nodes: z.array(User) }).nullable(),
  reviewers: z.object({ nodes: z.array(User) }).nullable(),
  headPipeline: z
    .object({
      createdAt: z.string().nullable(),
      jobs: z
        .object({
          nodes: z.array(
            z.object({
              name: z.string().nullable(),
              status: z.string().nullable(),
              allowFailure: z.boolean().nullable().optional(),
              startedAt: z.string().nullable(),
              createdAt: z.string().nullable(),
            })
          ),
        })
        .nullable(),
    })
    .nullable(),
  discussions: z.object({
    nodes: z.array(
      z.object({
        resolvable: z.boolean(),
        resolved: z.boolean(),
        notes: z.object({ nodes: z.array(NoteSchema) }),
      })
    ),
  }),
})
type Mr = z.infer<typeof MrSchema>

const PageSchema = z.object({
  currentUser: z.object({ username: z.string() }).nullable(),
  project: z
    .object({
      mergeRequests: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
        nodes: z.array(MrSchema),
      }),
    })
    .nullable(),
})

/** What each merge request brings, in the list and in a one-merge-request read alike. */
const MR_FIELDS = `iid title webUrl draft createdAt updatedAt sourceBranch targetBranch diffHeadSha conflicts approved
author { username bot }
labels(first: 20) { nodes { title } }
diffStatsSummary { additions deletions }
approvedBy(first: 50) { nodes { username bot } }
reviewers(first: 30) { nodes { username bot } }
headPipeline { createdAt jobs(first: 100) { nodes { name status allowFailure startedAt createdAt } } }
discussions(first: 100) { nodes { resolvable resolved notes(first: 50) { nodes { system body createdAt author { username bot } } } } }`

export const MR_LIST_QUERY = `query($path: ID!, $cursor: String) {
  currentUser { username }
  project(fullPath: $path) {
    mergeRequests(state: opened, first: 20, after: $cursor, sort: CREATED_DESC) {
      pageInfo { hasNextPage endCursor }
      nodes { ${MR_FIELDS} }
    }
  }
}`

export const MR_QUERY = `query($path: ID!, $iid: String!) {
  currentUser { username }
  project(fullPath: $path) { mergeRequest(iid: $iid) { state ${MR_FIELDS} } }
}`

export const MEMBERS_QUERY = `query($path: ID!, $cursor: String) {
  project(fullPath: $path) {
    projectMembers(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { user { username bot } }
    }
  }
}`

const MembersSchema = z.object({
  project: z
    .object({
      projectMembers: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
        nodes: z.array(z.object({ user: User })),
      }),
    })
    .nullable(),
})

const OneMrSchema = z.object({
  currentUser: z.object({ username: z.string() }).nullable(),
  project: z.object({ mergeRequest: z.record(z.string(), z.unknown()).nullable() }).nullable(),
})

const JOB_STATUS: Record<string, Check['status']> = {
  SUCCESS: 'pass',
  FAILED: 'fail',
  RUNNING: 'pending',
  CREATED: 'queued',
  PENDING: 'queued',
  PREPARING: 'queued',
  WAITING_FOR_RESOURCE: 'queued',
  WAITING_FOR_CALLBACK: 'queued',
  SCHEDULED: 'queued',
  SKIPPED: 'skip',
  CANCELED: 'skip',
  CANCELING: 'skip',
  MANUAL: 'skip',
}

/** One pipeline job as a check; a job allowed to fail never fails the merge request. */
export function jobCheck(job: {
  name: string | null
  status: string | null
  allowFailure?: boolean | null | undefined
  startedAt: string | null
  createdAt: string | null
}): Check {
  const status = JOB_STATUS[job.status ?? ''] ?? 'pending'
  return {
    name: job.name ?? 'job',
    status: status === 'fail' && job.allowFailure === true ? 'skip' : status,
    since: job.startedAt ?? job.createdAt,
  }
}

const who = (user: z.infer<typeof User>) => ({ author: user?.username ?? 'ghost', bot: user?.bot === true })

/** A merge request's activity, in memory: approvals as reviews, discussions as threads, notes as comments. */
export function mrActivity(mr: Mr): Activity {
  const comments: Said[] = []
  const threads: Activity['threads'] = []
  for (const d of mr.discussions.nodes) {
    const notes = d.notes.nodes
      .filter(n => !n.system)
      .map(n => ({ ...who(n.author), createdAt: n.createdAt, body: n.body }))
    if (notes.length === 0) continue
    if (d.resolvable) threads.push({ resolved: d.resolved, comments: notes })
    else comments.push(...notes)
  }
  // GitLab gives no time for an approval: the merge request's last change is the closest it says.
  const reviews: ReviewNode[] = (mr.approvedBy?.nodes ?? []).flatMap(u =>
    u === null
      ? []
      : [{ ...who(u), state: 'APPROVED' as const, submittedAt: mr.updatedAt, inline: 0, body: '' }]
  )
  return { comments, reviews, threads }
}

/** One merge request as a row, on the side `kind` names; null when it is on the other side. */
export function mrPull(mr: Mr, viewer: string, kind: ListKind): ListPull | null {
  const author = mr.author?.username ?? 'ghost'
  if ((author === viewer) !== (kind === 'pulls')) return null
  const activity = mrActivity(mr)
  const reviewers = (mr.reviewers?.nodes ?? []).flatMap(u => (u === null ? [] : [u.username]))
  const { you, others } = reviewerPending(activity, viewer)
  return {
    number: Number(mr.iid),
    title: mr.title,
    url: mr.webUrl,
    author,
    authorBot: mr.author?.bot === true,
    isDraft: mr.draft,
    createdAt: mr.createdAt,
    updatedAt: mr.updatedAt,
    readyAt: mr.createdAt,
    queuedAt: null,
    headRefName: mr.sourceBranch,
    baseRefName: mr.targetBranch,
    headSha: mr.diffHeadSha ?? '',
    labels: (mr.labels?.nodes ?? []).map(l => l.title),
    additions: mr.diffStatsSummary?.additions ?? 0,
    deletions: mr.diffStatsSummary?.deletions ?? 0,
    reviewDecision: mr.approved === true ? 'APPROVED' : reviewers.length > 0 ? 'REVIEW_REQUIRED' : null,
    requested: reviewers.includes(viewer),
    requestedReviewers: reviewers,
    reviewers: reviewersOf(author, activity.reviews, [
      ...activity.comments,
      ...activity.threads.flatMap(t => t.comments),
    ]),
    checks: (mr.headPipeline?.jobs?.nodes ?? []).map(jobCheck),
    headCommittedAt: mr.headPipeline?.createdAt ?? null,
    mergeable: mr.conflicts ? 'CONFLICTING' : 'MERGEABLE',
    canvasShas: canvasShasOf(activity.comments),
    canvasOpen: canvasOpenOf(activity.comments),
    ...(kind === 'pulls'
      ? { pending: authorPending(activity, viewer), waiting: 0 }
      : { pending: you, waiting: others }),
  }
}

/** Every open merge request on one side of `repo`: yours newest first, the queue's oldest first. */
export async function fetchGitlabList(client: HostClient, repo: Repo, kind: ListKind): Promise<ListFetch> {
  const path = `${repo.owner}/${repo.name}`
  const mrs: Mr[] = []
  let viewer = ''
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const parsed = PageSchema.safeParse(
      await client.graphql(MR_LIST_QUERY, cursor === null ? { path } : { path, cursor })
    )
    if (!parsed.success || parsed.data.project === null) {
      throw new Error(`unexpected answer to the merge request list for ${path}`)
    }
    viewer = parsed.data.currentUser?.username ?? ''
    const { nodes, pageInfo } = parsed.data.project.mergeRequests
    mrs.push(...nodes)
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break
    cursor = pageInfo.endCursor
  }
  const pulls = mrs.flatMap(mr => mrPull(mr, viewer, kind) ?? [])
  return { viewer, pulls: kind === 'queue' ? pulls.reverse() : pulls }
}

/** One merge request of `repo` on one side, read alone; null when it is not open there. */
export async function fetchGitlabMr(
  client: HostClient,
  repo: Repo,
  kind: ListKind,
  number: number
): Promise<{ viewer: string; pull: ListPull | null }> {
  const path = `${repo.owner}/${repo.name}`
  const parsed = OneMrSchema.safeParse(await client.graphql(MR_QUERY, { path, iid: String(number) }))
  if (!parsed.success || parsed.data.project === null) {
    throw new Error(`unexpected answer for !${number} in ${path}`)
  }
  const viewer = parsed.data.currentUser?.username ?? ''
  const raw = parsed.data.project.mergeRequest
  if (raw === null || raw['state'] !== 'opened') return { viewer, pull: null }
  const mr = MrSchema.safeParse(raw)
  if (!mr.success) throw new Error(`unexpected merge request !${number} in ${path}`)
  return { viewer, pull: mrPull(mr.data, viewer, kind) }
}

/** The members of `repo`'s project, inherited ones too, but for bots. */
export async function fetchGitlabMembers(client: HostClient, repo: Repo): Promise<string[]> {
  const path = `${repo.owner}/${repo.name}`
  const logins: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const parsed = MembersSchema.safeParse(
      await client.graphql(MEMBERS_QUERY, cursor === null ? { path } : { path, cursor })
    )
    if (!parsed.success || parsed.data.project === null) {
      throw new Error(`unexpected answer to the members of ${path}`)
    }
    const { nodes, pageInfo } = parsed.data.project.projectMembers
    for (const { user } of nodes) if (user !== null && user.bot !== true) logins.push(user.username)
    if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break
    cursor = pageInfo.endCursor
  }
  return logins
}

export function gitlabLists(client: HostClient, repo: Repo): ListFetcher {
  return {
    fetch: kind => fetchGitlabList(client, repo, kind),
    fetchOne: (kind, number) => fetchGitlabMr(client, repo, kind, number),
    fetchPeople: () => fetchGitlabMembers(client, repo),
  }
}
