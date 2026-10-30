// The GitHub lists: one search a page at a time, each hit checked against the repo and the side
// of the viewer it belongs on, and its activity read into counts.
import { createFakeGh } from '../testing/fakes.js'
import {
  activityOf,
  checkOf,
  latestRuns,
  fetchGithubList,
  fetchGithubPeople,
  fetchGithubPull,
  githubLists,
  isBotAccount,
  LIST_QUERY,
  MAX_PAGES,
  PEOPLE_QUERY,
  pullOf,
  PULL_QUERY,
} from './github.js'

const REPO = { owner: 'acme', name: 'widgets' }
const MARKER = '<!-- pr-review-canvas:v1 -->'

type Node = Parameters<typeof pullOf>[0]

const user = (login: string, kind = 'User') => ({ login, kind })

function node(over: Partial<Node> = {}): Node {
  return {
    number: 7,
    title: 'Add widgets',
    url: 'https://github.com/acme/widgets/pull/7',
    isDraft: false,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
    headRefName: 'feature',
    baseRefName: 'main',
    headRefOid: 'b'.repeat(40),
    additions: 5,
    deletions: 1,
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    repository: { nameWithOwner: 'acme/widgets' },
    author: user('octo'),
    mergeQueueEntry: null,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    readyEvents: { nodes: [] },
    comments: { nodes: [] },
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    commits: { nodes: [] },
    ...over,
  }
}

const page = (
  nodes: unknown[],
  over: { hasNextPage?: boolean; endCursor?: string | null; viewer?: string } = {}
) => ({
  viewer: { login: over.viewer ?? 'me' },
  search: {
    pageInfo: { hasNextPage: over.hasNextPage ?? false, endCursor: over.endCursor ?? null },
    nodes,
  },
})

describe('isBotAccount', () => {
  it('knows a bot by its type or its [bot] suffix', () => {
    expect(isBotAccount({ login: 'renovate', kind: 'Bot' })).toBe(true)
    expect(isBotAccount({ login: 'dependabot[bot]' })).toBe(true)
    expect(isBotAccount({ login: 'ana', kind: 'User' })).toBe(false)
  })
})

describe('latestRuns', () => {
  const run = (name: string, conclusion: string, suite: string, workflow?: string) => ({
    kind: 'CheckRun' as const,
    name,
    status: 'COMPLETED',
    conclusion,
    startedAt: null,
    checkSuite: {
      createdAt: suite,
      workflowRun: workflow === undefined ? null : { workflow: { name: workflow } },
    },
  })

  it('keeps only the newest run of a workflow started twice on the commit', () => {
    const cancelled = run('Semgrep Scan', 'CANCELLED', '2026-10-30T17:22:42Z', 'SAST')
    const rerun = run('Semgrep Scan', 'SUCCESS', '2026-10-30T17:22:43Z', 'SAST')
    const skipped = run('E2E', 'SKIPPED', '2026-10-30T17:22:42Z', 'E2E')
    expect(latestRuns([cancelled, skipped, rerun])).toEqual([skipped, rerun])
    expect(latestRuns([rerun, cancelled])).toEqual([rerun])
  })

  it('keeps checks of the same name from other workflows, apps and commit statuses', () => {
    const tests = run('build', 'SUCCESS', '2026-10-30T17:22:43Z', 'Tests')
    const docs = run('build', 'FAILURE', '2026-10-30T17:22:42Z', 'Docs')
    const app = run('build', 'SUCCESS', '2026-10-30T17:22:41Z')
    const legacy = { kind: 'StatusContext' as const, context: 'build', state: 'SUCCESS' }
    expect(latestRuns([tests, docs, app, legacy])).toEqual([tests, docs, app, legacy])
  })

  it('keeps the later of two runs in one suite, and one with no suite', () => {
    const first = { ...run('lint', 'CANCELLED', '2026-10-30T17:00:00Z'), checkSuite: null }
    const second = { ...first, conclusion: 'SUCCESS' }
    expect(latestRuns([first, second])).toEqual([second])
  })
})

describe('checkOf', () => {
  const run = (
    status: string,
    conclusion: string | null,
    startedAt: string | null = null,
    suite?: string
  ) => ({
    kind: 'CheckRun' as const,
    name: 'build',
    status,
    conclusion,
    startedAt,
    checkSuite: suite === undefined ? null : { createdAt: suite },
  })

  it('reads a check run by its status and conclusion', () => {
    expect(checkOf(run('IN_PROGRESS', null)).status).toBe('pending')
    expect(checkOf(run('QUEUED', null)).status).toBe('queued')
    expect(checkOf(run('COMPLETED', null)).status).toBe('pending')
    expect(checkOf(run('COMPLETED', 'FAILURE')).status).toBe('fail')
    expect(checkOf(run('COMPLETED', 'TIMED_OUT')).status).toBe('fail')
    expect(checkOf(run('COMPLETED', 'SKIPPED')).status).toBe('skip')
    expect(checkOf(run('COMPLETED', 'NEUTRAL')).status).toBe('skip')
    expect(checkOf(run('COMPLETED', 'SUCCESS')).status).toBe('pass')
  })

  it('dates a run by the later of its start and its suite', () => {
    expect(checkOf(run('QUEUED', null)).since).toBeNull()
    expect(checkOf(run('QUEUED', null, '2026-10-01T10:00:00Z')).since).toBe('2026-10-01T10:00:00Z')
    expect(checkOf(run('QUEUED', null, null, '2026-10-02T10:00:00Z')).since).toBe('2026-10-02T10:00:00Z')
    expect(checkOf(run('QUEUED', null, '2026-10-03T10:00:00Z', '2026-10-02T10:00:00Z')).since).toBe(
      '2026-10-03T10:00:00Z'
    )
    expect(checkOf(run('QUEUED', null, '2026-10-01T10:00:00Z', '2026-10-02T10:00:00Z')).since).toBe(
      '2026-10-02T10:00:00Z'
    )
  })

  it('reads a commit status by its state', () => {
    const status = (state: string) => checkOf({ kind: 'StatusContext', context: 'ci/legacy', state })
    expect(status('SUCCESS')).toEqual({ name: 'ci/legacy', status: 'pass', since: null })
    expect(status('FAILURE').status).toBe('fail')
    expect(status('ERROR').status).toBe('fail')
    expect(status('EXPECTED').status).toBe('expected')
    expect(status('PENDING').status).toBe('pending')
  })
})

describe('activityOf', () => {
  it('keeps submitted reviews, names a deleted account ghost, and reads threads', () => {
    const activity = activityOf(
      node({
        comments: { nodes: [{ createdAt: 'T1', body: 'hi', author: null }] },
        reviews: {
          nodes: [
            {
              state: 'PENDING',
              submittedAt: null,
              body: '',
              author: user('ana'),
              comments: { totalCount: 0 },
            },
            { state: 'WEIRD', submittedAt: 'T2', body: '', author: user('ana'), comments: { totalCount: 0 } },
            {
              state: 'APPROVED',
              submittedAt: 'T3',
              body: 'ok',
              author: user('ci', 'Bot'),
              comments: { totalCount: 2 },
            },
          ],
        },
        reviewThreads: {
          nodes: [
            { isResolved: true, comments: { nodes: [{ createdAt: 'T4', body: 'x', author: user('bob') }] } },
          ],
        },
      })
    )
    expect(activity.comments).toEqual([{ author: 'ghost', bot: false, createdAt: 'T1', body: 'hi' }])
    expect(activity.reviews).toEqual([
      { author: 'ci', bot: true, state: 'APPROVED', submittedAt: 'T3', inline: 2, body: 'ok' },
    ])
    expect(activity.threads).toEqual([
      { resolved: true, comments: [{ author: 'bob', bot: false, createdAt: 'T4', body: 'x' }] },
    ])
  })
})

describe('pullOf', () => {
  it('leaves out another repo’s PR and one on the other side of the viewer', () => {
    expect(pullOf(node({ repository: { nameWithOwner: 'acme/other' } }), REPO, 'octo', 'pulls')).toBeNull()
    expect(pullOf(node(), REPO, 'octo', 'queue')).toBeNull()
    expect(pullOf(node(), REPO, 'me', 'pulls')).toBeNull()
    // The repo name is matched ignoring case.
    expect(
      pullOf(node({ repository: { nameWithOwner: 'ACME/Widgets' } }), REPO, 'octo', 'pulls')
    ).not.toBeNull()
  })

  it('makes a row of your own PR with what waits on you', () => {
    const pull = pullOf(
      node({
        author: user('me'),
        mergeable: 'CONFLICTING',
        mergeQueueEntry: { enqueuedAt: 'Q' },
        labels: { nodes: [{ name: 'bug' }] },
        readyEvents: { nodes: [{}, { createdAt: 'READY' }] },
        comments: {
          nodes: [
            { createdAt: 'T1', body: 'please fix', author: user('ana') },
            {
              createdAt: 'T2',
              body: `${MARKER}\nPR Review Canvas for commit abcdef1\n**For the reviewer:** 2 attention points to judge (2 check).\n**Not yet resolved by the author:** 1.`,
              author: user('ana'),
            },
          ],
        },
        commits: {
          nodes: [
            {
              commit: {
                committedDate: 'C',
                statusCheckRollup: {
                  contexts: { nodes: [{ kind: 'StatusContext', context: 'ci', state: 'SUCCESS' }] },
                },
              },
            },
          ],
        },
      }),
      REPO,
      'me',
      'pulls'
    )
    expect(pull).toMatchObject({
      author: 'me',
      authorBot: false,
      readyAt: 'READY',
      queuedAt: 'Q',
      labels: ['bug'],
      mergeable: 'CONFLICTING',
      headSha: 'b'.repeat(40),
      headCommittedAt: 'C',
      checks: [{ name: 'ci', status: 'pass', since: null }],
      canvasShas: ['abcdef1'],
      canvasOpen: { author: 1, reviewer: 2 },
      pending: 1,
      waiting: 0,
      requested: false,
    })
    expect(pull?.reviewers.map(r => r.login)).toEqual(['ana', 'Canvas'])
  })

  it('makes a row of a queued PR with what names you and what waits on others', () => {
    const pull = pullOf(
      node({
        author: user('renovate', 'Bot'),
        mergeable: 'WHATEVER',
        reviewRequests: { nodes: [{ requestedReviewer: null }, { requestedReviewer: { login: 'me' } }] },
        reviewThreads: {
          nodes: [
            {
              isResolved: false,
              comments: { nodes: [{ createdAt: 'T1', body: '@me look', author: user('ana') }] },
            },
            {
              isResolved: false,
              comments: { nodes: [{ createdAt: 'T1', body: 'hmm', author: user('ana') }] },
            },
          ],
        },
        commits: { nodes: [{ commit: { committedDate: null, statusCheckRollup: null } }] },
      }),
      REPO,
      'me',
      'queue'
    )
    expect(pull).toMatchObject({
      author: 'renovate',
      authorBot: true,
      readyAt: '2026-10-01T10:00:00Z',
      queuedAt: null,
      mergeable: 'UNKNOWN',
      requested: true,
      checks: [],
      headCommittedAt: null,
      pending: 1,
      waiting: 1,
    })
  })

  it('names a deleted author ghost', () => {
    expect(pullOf(node({ author: null }), REPO, 'me', 'queue')).toMatchObject({
      author: 'ghost',
      authorBot: false,
    })
  })
})

describe('fetchGithubList', () => {
  it('reads every page, skipping non-PR hits, other repos and the other side', async () => {
    const gh = createFakeGh({
      graphql: [
        page([node({ number: 1, author: user('me') }), {}, node({ number: 2, author: user('ana') })], {
          hasNextPage: true,
          endCursor: 'c1',
        }),
        page([node({ number: 3, author: user('me'), repository: { nameWithOwner: 'other/repo' } })], {
          hasNextPage: true,
          endCursor: 'c2',
        }),
        page([node({ number: 4, author: user('me') })], { hasNextPage: true, endCursor: null }),
      ],
    })
    const list = await fetchGithubList(gh, REPO, 'pulls')
    // The default branch is not read: the list is the viewer and the PRs.
    expect(Object.keys(list).sort()).toEqual(['pulls', 'viewer'])
    expect(list.viewer).toBe('me')
    expect(list.pulls.map(p => p.number)).toEqual([1, 4])
    expect(gh.calls.map(c => c.params)).toEqual([
      { q: 'repo:acme/widgets is:pr is:open author:@me sort:created-desc' },
      { q: 'repo:acme/widgets is:pr is:open author:@me sort:created-desc', cursor: 'c1' },
      { q: 'repo:acme/widgets is:pr is:open author:@me sort:created-desc', cursor: 'c2' },
    ])
  })

  it('searches everyone else’s oldest first for the queue', async () => {
    const gh = createFakeGh({ graphql: [page([node({ number: 2, author: user('ana') })])] })
    const list = await fetchGithubList(gh, REPO, 'queue')
    expect(list).toEqual({ viewer: 'me', pulls: list.pulls })
    expect(LIST_QUERY).not.toContain('defaultBranchRef')
    expect(LIST_QUERY).not.toContain('$owner')
    expect(list.pulls.map(p => p.number)).toEqual([2])
    expect(gh.calls[0]?.params['q']).toBe('repo:acme/widgets is:pr is:open -author:@me sort:created-asc')
  })

  it('stops after the most pages it reads', async () => {
    const pages = Array.from({ length: MAX_PAGES + 1 }, (_, i) =>
      page([], { hasNextPage: true, endCursor: `c${i}` })
    )
    const gh = createFakeGh({ graphql: pages })
    await fetchGithubList(gh, REPO, 'pulls')
    expect(gh.calls).toHaveLength(MAX_PAGES)
  })

  it('refuses an answer or a pull request of an unexpected shape', async () => {
    await expect(fetchGithubList(createFakeGh({ graphql: [{ nope: true }] }), REPO, 'pulls')).rejects.toThrow(
      'unexpected answer to the pull request search for acme/widgets'
    )
    await expect(
      fetchGithubList(createFakeGh({ graphql: [page([{ number: 'x' }])] }), REPO, 'pulls')
    ).rejects.toThrow('unexpected pull request in the search for acme/widgets')
  })

  it('is what githubLists fetches with', async () => {
    const gh = createFakeGh({ graphql: [page([node({ author: user('ana') })])] })
    const list = await githubLists(gh, REPO).fetch('queue')
    expect(list.pulls).toHaveLength(1)
    expect(gh.calls[0]?.path).toBe(LIST_QUERY.slice(0, 20))
  })
})

describe('fetchGithubPull', () => {
  const one = (pullRequest: unknown, viewer = 'me') => ({
    viewer: { login: viewer },
    repository: { pullRequest },
  })
  const open = (over: Partial<Node> = {}) => ({ state: 'OPEN', ...node(over) })

  it('reads one open PR of the repo by its number, as a row of its side', async () => {
    const gh = createFakeGh({ graphql: [one(open({ author: user('me') }))] })
    const answer = await fetchGithubPull(gh, REPO, 'pulls', 7)
    expect(answer.viewer).toBe('me')
    expect(answer.pull).toMatchObject({ number: 7, author: 'me' })
    expect(gh.calls).toEqual([
      {
        kind: 'graphql',
        path: PULL_QUERY.slice(0, 20),
        params: { owner: 'acme', name: 'widgets', number: 7 },
      },
    ])
  })

  it('answers no PR for one on the other side, of another repo, not open, or not there', async () => {
    const read = async (answer: unknown, kind: 'pulls' | 'queue' = 'queue') =>
      fetchGithubPull(createFakeGh({ graphql: [answer] }), REPO, kind, 7)
    expect(await read(one(open({ author: user('me') })))).toEqual({ viewer: 'me', pull: null })
    expect(await read(one(open({ repository: { nameWithOwner: 'acme/other' } })))).toEqual({
      viewer: 'me',
      pull: null,
    })
    expect(await read(one({ ...open(), state: 'MERGED' }))).toEqual({ viewer: 'me', pull: null })
    expect(await read(one({ ...open(), state: 'CLOSED' }, 'ana'))).toEqual({ viewer: 'ana', pull: null })
    expect(await read(one(null))).toEqual({ viewer: 'me', pull: null })
    expect(await read({ viewer: { login: 'me' }, repository: null })).toEqual({ viewer: 'me', pull: null })
    // A queued PR of someone else is the queue's.
    expect((await read(one(open())))?.pull).toMatchObject({ number: 7, author: 'octo' })
  })

  it('refuses an answer or a pull request of an unexpected shape', async () => {
    await expect(
      fetchGithubPull(createFakeGh({ graphql: [{ nope: true }] }), REPO, 'pulls', 7)
    ).rejects.toThrow('unexpected answer for #7 in acme/widgets')
    await expect(
      fetchGithubPull(createFakeGh({ graphql: [one({ state: 'OPEN', number: 'x' })] }), REPO, 'pulls', 7)
    ).rejects.toThrow('unexpected pull request #7 in acme/widgets')
  })

  it('is what githubLists reads one PR with', async () => {
    const gh = createFakeGh({ graphql: [one(open({ number: 12 }))] })
    expect((await githubLists(gh, REPO).fetchOne('queue', 12)).pull?.number).toBe(12)
    expect(gh.calls[0]?.params).toEqual({ owner: 'acme', name: 'widgets', number: 12 })
  })
})

describe('fetchGithubPeople', () => {
  const people = (logins: string[], hasNextPage = false, endCursor: string | null = null) => ({
    repository: {
      assignableUsers: { pageInfo: { hasNextPage, endCursor }, nodes: logins.map(login => ({ login })) },
    },
  })

  it('reads every page of the people a PR can be assigned to', async () => {
    const gh = createFakeGh({
      graphql: [people(['ana', 'bob'], true, 'c1'), people(['cy'], true, null), people(['never'])],
    })
    expect(await fetchGithubPeople(gh, REPO)).toEqual(['ana', 'bob', 'cy'])
    expect(gh.calls.map(c => [c.path, c.params])).toEqual([
      [PEOPLE_QUERY.slice(0, 20), { owner: 'acme', name: 'widgets' }],
      [PEOPLE_QUERY.slice(0, 20), { owner: 'acme', name: 'widgets', cursor: 'c1' }],
    ])
  })

  it('stops after the most pages it reads', async () => {
    const pages = Array.from({ length: MAX_PAGES + 1 }, (_, i) => people([`u${i}`], true, `c${i}`))
    const gh = createFakeGh({ graphql: pages })
    expect(await fetchGithubPeople(gh, REPO)).toHaveLength(MAX_PAGES)
    expect(gh.calls).toHaveLength(MAX_PAGES)
  })

  it('refuses an answer of an unexpected shape or with no repository', async () => {
    for (const answer of [{ nope: true }, { repository: null }]) {
      await expect(fetchGithubPeople(createFakeGh({ graphql: [answer] }), REPO)).rejects.toThrow(
        'unexpected answer to the people of acme/widgets'
      )
    }
  })

  it('is what githubLists reads the people with', async () => {
    const gh = createFakeGh({ graphql: [people(['ana'])] })
    expect(await githubLists(gh, REPO).fetchPeople()).toEqual(['ana'])
  })
})
