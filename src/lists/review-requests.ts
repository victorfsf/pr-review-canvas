// Who a PR in the tables asks to review it, and changing that from its row's Reviewers popup:
// anyone's PR in the lists, not only yours. Asking someone, or no longer asking them, goes to the
// forge, which refuses it for someone without access to the project; the PR is read again after.
// Only people are asked here: teams a PR asks stay as the forge has them.
import { z } from 'zod'
import type { Repo } from '../contract/review-artifact.js'
import { gitlabProjectApi } from '../gitlab/project.js'
import type { HostClient } from '../host/client.js'
import type { ListPull } from './model.js'

/** A login on either forge: letters, digits, dots, hyphens and underscores. */
export const LOGIN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/

/** Who a PR asks to review it, by login, and whose PR it is, who cannot be asked. */
export interface ReviewRequests {
  author: string
  requested: string[]
}

export function reviewRequestsOf(pull: Pick<ListPull, 'author' | 'requestedReviewers'>): ReviewRequests {
  return { author: pull.author, requested: pull.requestedReviewers }
}

/**
 * Who can be asked to review the PR, for what was typed: the project's people, never its author.
 * Those who are asked or reviewed it come first; then by login. A login carries no name here.
 */
export function reviewerPeople(
  pull: Pick<ListPull, 'author' | 'requestedReviewers' | 'reviewers'>,
  people: readonly string[],
  query: string
): { people: { login: string; name: null }[]; complete: boolean } {
  const lower = (login: string) => login.toLowerCase()
  const wanted = lower(query.trim())
  const involved = new Set(
    [...pull.requestedReviewers, ...pull.reviewers.filter(r => r.kind === 'person').map(r => r.login)].map(
      lower
    )
  )
  const offered = people
    .filter(login => lower(login) !== lower(pull.author) && lower(login).includes(wanted))
    .sort((a, b) => Number(!involved.has(lower(a))) - Number(!involved.has(lower(b))) || a.localeCompare(b))
  return { people: offered.map(login => ({ login, name: null })), complete: true }
}

/** Asks people to review a PR, or stops asking them, on one forge; answers who it asks now. */
export interface ReviewerRequester {
  request(number: number, logins: readonly string[], ask: boolean): Promise<string[]>
}

const GithubPullSchema = z.object({ requested_reviewers: z.array(z.object({ login: z.string() })) })

/** GitHub's requested reviewers, a call each way. */
export function githubRequester(client: HostClient, repo: Repo): ReviewerRequester {
  return {
    async request(number, logins, ask) {
      const answer = await client.post(
        `repos/${repo.owner}/${repo.name}/pulls/${number}/requested_reviewers`,
        { reviewers: logins },
        ask ? 'POST' : 'DELETE'
      )
      const parsed = GithubPullSchema.safeParse(answer)
      return parsed.success ? parsed.data.requested_reviewers.map(r => r.login) : []
    },
  }
}

const GitlabUserSchema = z.array(z.object({ id: z.number().int(), username: z.string() }))
const GitlabMrSchema = z.object({
  reviewers: z.array(z.object({ id: z.number().int(), username: z.string() })).default([]),
})

/**
 * GitLab's reviewers: the merge request's whole list, set at once by user id, so asking keeps
 * those already asked and stopping keeps the rest.
 */
export function gitlabRequester(client: HostClient, repo: Repo): ReviewerRequester {
  const mrPath = (number: number) => `${gitlabProjectApi(repo)}/merge_requests/${number}`
  const idOf = async (username: string): Promise<number> => {
    const [user] = GitlabUserSchema.parse(await client.api('users', { username }))
    if (user === undefined) throw new Error(`no GitLab user ${username}`)
    return user.id
  }
  return {
    async request(number, logins, ask) {
      const current = GitlabMrSchema.parse(await client.api(mrPath(number))).reviewers
      const named = new Set(logins.map(l => l.toLowerCase()))
      const kept = current.filter(r => !named.has(r.username.toLowerCase())).map(r => r.id)
      const ids = ask ? [...kept, ...(await Promise.all(logins.map(idOf)))] : kept
      const answer = GitlabMrSchema.parse(await client.post(mrPath(number), { reviewer_ids: ids }, 'PUT'))
      return answer.reviewers.map(r => r.username)
    },
  }
}
