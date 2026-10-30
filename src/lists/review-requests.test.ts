// Who a PR in the tables asks to review it, who can be asked, and asking or no longer asking
// people on each forge.
import type { HostClient } from '../host/client.js'
import {
  githubRequester,
  gitlabRequester,
  LOGIN,
  reviewerPeople,
  reviewRequestsOf,
} from './review-requests.js'
import { makeListPull, makeReviewer } from './testing.js'

const REPO = { owner: 'acme', name: 'widgets' }

interface Call {
  kind: 'api' | 'post'
  path: string
  params?: Record<string, string>
  body?: unknown
  method?: string
}

/** A forge client that records each call and answers by `api` and `post`. */
function fakeClient(answers: {
  api?: (path: string, params?: Record<string, string>) => unknown
  post?: (path: string, body: unknown, method?: string) => unknown
}): HostClient & { calls: Call[] } {
  const calls: Call[] = []
  const never = () => {
    throw new Error('not asked here')
  }
  return {
    calls,
    api: async (path, params) => {
      calls.push({ kind: 'api', path, ...(params === undefined ? {} : { params }) })
      return (answers.api ?? never)(path, params)
    },
    post: async (path, body, method) => {
      calls.push({ kind: 'post', path, body, ...(method === undefined ? {} : { method }) })
      return (answers.post ?? never)(path, body, method)
    },
    apiWithHeaders: never,
    graphql: never,
    authStatus: never,
    authToken: never,
  }
}

describe('LOGIN', () => {
  it('takes logins on either forge, and nothing that could be more than one', () => {
    for (const login of ['ana', 'Ana-B', 'a.b_c', '9lives', 'x'.repeat(255)])
      expect(LOGIN.test(login)).toBe(true)
    for (const login of ['', '-ana', '.ana', 'ana b', 'ana/b', '@ana', 'x'.repeat(256)])
      expect(LOGIN.test(login)).toBe(false)
  })
})

describe('reviewRequestsOf', () => {
  it('answers whose PR it is and who it asks', () => {
    expect(reviewRequestsOf(makeListPull({ author: 'octo', requestedReviewers: ['ana', 'bob'] }))).toEqual({
      author: 'octo',
      requested: ['ana', 'bob'],
    })
  })
})

describe('reviewerPeople', () => {
  const pull = makeListPull({
    author: 'Octo',
    requestedReviewers: ['Zed'],
    reviewers: [makeReviewer({ login: 'yan' }), makeReviewer({ login: 'core', kind: 'bots' })],
  })
  const people = ['bob', 'octo', 'zed', 'ana', 'yan', 'core', 'Bea']

  it('offers everyone but the author, those asked or who reviewed first, then by login', () => {
    expect(reviewerPeople(pull, people, '')).toEqual({
      people: ['yan', 'zed', 'ana', 'Bea', 'bob', 'core'].map(login => ({ login, name: null })),
      complete: true,
    })
  })

  it('keeps those whose login holds what was typed, in any case and spacing', () => {
    expect(reviewerPeople(pull, people, '  B ').people).toEqual([
      { login: 'Bea', name: null },
      { login: 'bob', name: null },
    ])
    expect(reviewerPeople(pull, people, 'OCT').people).toEqual([])
    expect(reviewerPeople(pull, [], 'a')).toEqual({ people: [], complete: true })
  })
})

describe('githubRequester', () => {
  const path = 'repos/acme/widgets/pulls/7/requested_reviewers'

  it('asks with a POST and stops asking with a DELETE, answering who the PR asks now', async () => {
    const client = fakeClient({
      post: (_path, _body, method) => ({
        requested_reviewers: method === 'POST' ? [{ login: 'ana' }, { login: 'bob' }] : [{ login: 'ana' }],
      }),
    })
    const requester = githubRequester(client, REPO)
    expect(await requester.request(7, ['bob'], true)).toEqual(['ana', 'bob'])
    expect(await requester.request(7, ['bob'], false)).toEqual(['ana'])
    expect(client.calls).toEqual([
      { kind: 'post', path, body: { reviewers: ['bob'] }, method: 'POST' },
      { kind: 'post', path, body: { reviewers: ['bob'] }, method: 'DELETE' },
    ])
  })

  it('answers no one when the forge’s answer is not a pull request', async () => {
    const requester = githubRequester(fakeClient({ post: () => ({ message: 'odd' }) }), REPO)
    expect(await requester.request(7, ['bob'], true)).toEqual([])
  })

  it('passes on what the forge refused', async () => {
    const requester = githubRequester(
      fakeClient({
        post: () => {
          throw new Error('gh: Reviews may only be requested from collaborators')
        },
      }),
      REPO
    )
    await expect(requester.request(7, ['eve'], true)).rejects.toThrow('only be requested from collaborators')
  })
})

describe('gitlabRequester', () => {
  const mr = 'projects/acme%2Fwidgets/merge_requests/7'
  const USERS: Record<string, number> = { ana: 1, bob: 2, cy: 3 }

  /** A merge request asking `reviewers` now; a PUT sets them by id and answers them. */
  const gitlab = (reviewers: Array<{ id: number; username: string }>) => {
    const byId = new Map(Object.entries(USERS).map(([name, id]) => [id, name]))
    return fakeClient({
      api: (path, params) => {
        if (path === mr) return { reviewers }
        if (path === 'users') {
          const id = USERS[params?.['username'] ?? '']
          return id === undefined ? [] : [{ id, username: params?.['username'] }]
        }
        throw new Error(`no ${path}`)
      },
      post: (_path, body) => ({
        reviewers: (body as { reviewer_ids: number[] }).reviewer_ids.map(id => ({
          id,
          username: byId.get(id),
        })),
      }),
    })
  }

  it('asks by keeping those already asked and adding each one looked up by username', async () => {
    const client = gitlab([{ id: 1, username: 'ana' }])
    expect(await gitlabRequester(client, REPO).request(7, ['bob', 'cy'], true)).toEqual(['ana', 'bob', 'cy'])
    expect(client.calls).toEqual([
      { kind: 'api', path: mr },
      { kind: 'api', path: 'users', params: { username: 'bob' } },
      { kind: 'api', path: 'users', params: { username: 'cy' } },
      { kind: 'post', path: mr, body: { reviewer_ids: [1, 2, 3] }, method: 'PUT' },
    ])
  })

  it('asks someone already asked once', async () => {
    const client = gitlab([{ id: 2, username: 'bob' }])
    expect(await gitlabRequester(client, REPO).request(7, ['bob'], true)).toEqual(['bob'])
    expect(client.calls.at(-1)?.body).toEqual({ reviewer_ids: [2] })
  })

  it('stops asking those named, in any case, and keeps the rest without looking anyone up', async () => {
    const client = gitlab([
      { id: 1, username: 'ana' },
      { id: 2, username: 'Bob' },
    ])
    expect(await gitlabRequester(client, REPO).request(7, ['bob'], false)).toEqual(['ana'])
    expect(client.calls).toEqual([
      { kind: 'api', path: mr },
      { kind: 'post', path: mr, body: { reviewer_ids: [1] }, method: 'PUT' },
    ])
  })

  it('reads a merge request with no reviewers as asking no one', async () => {
    const client = fakeClient({
      api: path => (path === mr ? {} : [{ id: 3, username: 'cy' }]),
      post: () => ({}),
    })
    expect(await gitlabRequester(client, REPO).request(7, ['cy'], true)).toEqual([])
    expect(client.calls.at(-1)?.body).toEqual({ reviewer_ids: [3] })
  })

  it('refuses a username GitLab does not know, and sets nothing', async () => {
    const client = gitlab([])
    await expect(gitlabRequester(client, REPO).request(7, ['eve'], true)).rejects.toThrow(
      'no GitLab user eve'
    )
    expect(client.calls.some(c => c.kind === 'post')).toBe(false)
  })
})
