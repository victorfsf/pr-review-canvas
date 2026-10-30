// The GitLab lists: the project's open merge requests a page at a time, split by author, with
// approvals as reviews, resolvable discussions as threads, and pipeline jobs as checks.
import { createFakeGh } from '../testing/fakes.js'
import { MAX_PAGES } from './github.js'
import {
  fetchGitlabList,
  fetchGitlabMembers,
  fetchGitlabMr,
  gitlabLists,
  jobCheck,
  MEMBERS_QUERY,
  MR_QUERY,
  mrActivity,
  mrPull,
} from './gitlab.js'

const REPO = { owner: 'acme', name: 'widgets' }
const MARKER = '<!-- pr-review-canvas:v1 -->'

type Mr = Parameters<typeof mrPull>[0]

const user = (username: string, bot = false) => ({ username, bot })
const note = (author: string | null, createdAt: string, body = 'ok', system = false) => ({
  system,
  body,
  createdAt,
  author: author === null ? null : user(author),
})

function mr(over: Partial<Mr> = {}): Mr {
  return {
    iid: '7',
    title: 'Add widgets',
    webUrl: 'https://gitlab.com/acme/widgets/-/merge_requests/7',
    draft: false,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
    sourceBranch: 'feature',
    targetBranch: 'main',
    diffHeadSha: 'c'.repeat(40),
    conflicts: false,
    author: user('octo'),
    labels: null,
    diffStatsSummary: null,
    approved: null,
    approvedBy: null,
    reviewers: null,
    headPipeline: null,
    discussions: { nodes: [] },
    ...over,
  }
}

const page = (
  nodes: Mr[],
  over: { hasNextPage?: boolean; endCursor?: string | null; user?: string | null } = {}
) => ({
  currentUser: over.user === null ? null : { username: over.user ?? 'me' },
  project: {
    mergeRequests: {
      pageInfo: { hasNextPage: over.hasNextPage ?? false, endCursor: over.endCursor ?? null },
      nodes,
    },
  },
})

describe('jobCheck', () => {
  const job = (status: string | null, over: Partial<Parameters<typeof jobCheck>[0]> = {}) =>
    jobCheck({ name: 'test', status, startedAt: null, createdAt: null, ...over })

  it('reads a job by its status', () => {
    expect(job('SUCCESS').status).toBe('pass')
    expect(job('FAILED').status).toBe('fail')
    expect(job('RUNNING').status).toBe('pending')
    expect(job('PENDING').status).toBe('queued')
    expect(job('MANUAL').status).toBe('skip')
    expect(job('SOMETHING_NEW').status).toBe('pending')
    expect(job(null).status).toBe('pending')
  })

  it('never fails for a job allowed to fail, names a nameless job, and dates it by its start', () => {
    expect(job('FAILED', { allowFailure: true }).status).toBe('skip')
    expect(job('SUCCESS', { allowFailure: true }).status).toBe('pass')
    expect(job('SUCCESS', { name: null }).name).toBe('job')
    expect(job('SUCCESS', { startedAt: 'S', createdAt: 'C' }).since).toBe('S')
    expect(job('SUCCESS', { createdAt: 'C' }).since).toBe('C')
  })
})

describe('mrActivity', () => {
  it('reads resolvable discussions as threads, the rest as comments, approvals as reviews', () => {
    const activity = mrActivity(
      mr({
        approvedBy: { nodes: [user('ana'), null, user('ci', true)] },
        discussions: {
          nodes: [
            { resolvable: true, resolved: false, notes: { nodes: [note('bob', 'T1', '?')] } },
            {
              resolvable: false,
              resolved: false,
              notes: { nodes: [note(null, 'T2'), note('x', 'T3', 'sys', true)] },
            },
            { resolvable: false, resolved: false, notes: { nodes: [note('x', 'T3', 'only system', true)] } },
          ],
        },
      })
    )
    expect(activity.threads).toEqual([
      { resolved: false, comments: [{ author: 'bob', bot: false, createdAt: 'T1', body: '?' }] },
    ])
    expect(activity.comments).toEqual([{ author: 'ghost', bot: false, createdAt: 'T2', body: 'ok' }])
    expect(activity.reviews).toEqual([
      {
        author: 'ana',
        bot: false,
        state: 'APPROVED',
        submittedAt: '2026-10-02T10:00:00Z',
        inline: 0,
        body: '',
      },
      {
        author: 'ci',
        bot: true,
        state: 'APPROVED',
        submittedAt: '2026-10-02T10:00:00Z',
        inline: 0,
        body: '',
      },
    ])
  })
})

describe('mrPull', () => {
  it('leaves out a merge request on the other side of the viewer', () => {
    expect(mrPull(mr(), 'octo', 'queue')).toBeNull()
    expect(mrPull(mr(), 'me', 'pulls')).toBeNull()
  })

  it('makes a row of your own merge request with what waits on you', () => {
    const pull = mrPull(
      mr({
        author: user('me'),
        conflicts: true,
        approved: true,
        labels: { nodes: [{ title: 'bug' }] },
        diffStatsSummary: { additions: 3, deletions: 4 },
        headPipeline: {
          createdAt: 'P',
          jobs: { nodes: [{ name: 'lint', status: 'FAILED', startedAt: 'S', createdAt: 'C' }] },
        },
        discussions: {
          nodes: [
            { resolvable: true, resolved: false, notes: { nodes: [note('ana', 'T1', 'fix')] } },
            {
              resolvable: false,
              resolved: false,
              notes: {
                nodes: [
                  note(
                    'ana',
                    'T2',
                    `${MARKER}\nPR Review Canvas for commit abcdef1\n**For the reviewer:** no open attention points.`
                  ),
                ],
              },
            },
          ],
        },
      }),
      'me',
      'pulls'
    )
    expect(pull).toMatchObject({
      number: 7,
      author: 'me',
      authorBot: false,
      readyAt: '2026-10-01T10:00:00Z',
      labels: ['bug'],
      additions: 3,
      deletions: 4,
      reviewDecision: 'APPROVED',
      checks: [{ name: 'lint', status: 'fail', since: 'S' }],
      headCommittedAt: 'P',
      mergeable: 'CONFLICTING',
      canvasShas: ['abcdef1'],
      canvasOpen: { author: 0, reviewer: 0 },
      pending: 1,
      waiting: 0,
    })
    // Thread comments count toward the reviewers as well as conversation ones.
    expect(pull?.reviewers).toMatchObject([
      { login: 'ana', comments: 1 },
      { login: 'Canvas', comments: 1 },
    ])
  })

  it('makes a row of a queued merge request with what names you and what waits on others', () => {
    const pull = mrPull(
      mr({
        author: user('renovate', true),
        reviewers: { nodes: [null, user('me')] },
        diffHeadSha: null,
        headPipeline: { createdAt: null, jobs: null },
        discussions: {
          nodes: [
            { resolvable: true, resolved: false, notes: { nodes: [note('ana', 'T1', '@me look')] } },
            { resolvable: true, resolved: false, notes: { nodes: [note('ana', 'T1', 'hmm')] } },
          ],
        },
      }),
      'me',
      'queue'
    )
    expect(pull).toMatchObject({
      authorBot: true,
      headSha: '',
      additions: 0,
      labels: [],
      requested: true,
      reviewDecision: 'REVIEW_REQUIRED',
      checks: [],
      headCommittedAt: null,
      mergeable: 'MERGEABLE',
      pending: 1,
      waiting: 1,
    })
  })

  it('has no review decision with no reviewers, and names a deleted author ghost', () => {
    expect(mrPull(mr({ author: null, reviewers: { nodes: [] } }), 'me', 'queue')).toMatchObject({
      author: 'ghost',
      authorBot: false,
      reviewDecision: null,
      requested: false,
    })
  })
})

describe('fetchGitlabList', () => {
  it('reads every page and keeps your merge requests newest first', async () => {
    const gh = createFakeGh({
      graphql: [
        page([mr({ iid: '3', author: user('me') }), mr({ iid: '2', author: user('ana') })], {
          hasNextPage: true,
          endCursor: 'c1',
        }),
        page([mr({ iid: '1', author: user('me') })], { hasNextPage: true, endCursor: null }),
      ],
    })
    const list = await fetchGitlabList(gh, REPO, 'pulls')
    // The default branch is not read: the list is the viewer and the merge requests.
    expect(Object.keys(list).sort()).toEqual(['pulls', 'viewer'])
    expect(list.viewer).toBe('me')
    expect(list.pulls.map(p => p.number)).toEqual([3, 1])
    expect(gh.calls.map(c => c.params)).toEqual([
      { path: 'acme/widgets' },
      { path: 'acme/widgets', cursor: 'c1' },
    ])
  })

  it('keeps everyone else’s oldest first for the queue', async () => {
    const gh = createFakeGh({
      graphql: [
        page([mr({ iid: '3', author: user('ana') }), mr({ iid: '2', author: user('me') }), mr({ iid: '1' })]),
      ],
    })
    const list = await gitlabLists(gh, REPO).fetch('queue')
    expect(list).not.toHaveProperty('defaultBranch')
    expect(list.pulls.map(p => p.number)).toEqual([1, 3])
  })

  it('answers with no viewer when signed out', async () => {
    const gh = createFakeGh({ graphql: [page([mr()], { user: null })] })
    const list = await fetchGitlabList(gh, REPO, 'queue')
    expect(list.viewer).toBe('')
    expect(list.pulls.map(p => p.author)).toEqual(['octo'])
  })

  it('stops after the most pages it reads', async () => {
    const pages = Array.from({ length: MAX_PAGES + 1 }, (_, i) =>
      page([], { hasNextPage: true, endCursor: `c${i}` })
    )
    const gh = createFakeGh({ graphql: pages })
    await fetchGitlabList(gh, REPO, 'pulls')
    expect(gh.calls).toHaveLength(MAX_PAGES)
  })

  it('refuses an answer of an unexpected shape or with no project', async () => {
    await expect(fetchGitlabList(createFakeGh({ graphql: [{ nope: 1 }] }), REPO, 'pulls')).rejects.toThrow(
      'unexpected answer to the merge request list for acme/widgets'
    )
    await expect(
      fetchGitlabList(createFakeGh({ graphql: [{ currentUser: null, project: null }] }), REPO, 'pulls')
    ).rejects.toThrow('unexpected answer to the merge request list for acme/widgets')
  })
})

describe('fetchGitlabMr', () => {
  const one = (mergeRequest: unknown, viewer: string | null = 'me') => ({
    currentUser: viewer === null ? null : { username: viewer },
    project: { mergeRequest },
  })
  const opened = (over: Partial<Mr> = {}) => ({ state: 'opened', ...mr(over) })

  it('reads one open merge request by its iid, as a row of its side', async () => {
    const gh = createFakeGh({ graphql: [one(opened({ author: user('me') }))] })
    const answer = await fetchGitlabMr(gh, REPO, 'pulls', 7)
    expect(answer.viewer).toBe('me')
    expect(answer.pull).toMatchObject({ number: 7, author: 'me' })
    expect(gh.calls).toEqual([
      { kind: 'graphql', path: MR_QUERY.slice(0, 20), params: { path: 'acme/widgets', iid: '7' } },
    ])
  })

  it('answers no merge request for one on the other side, not open, or not there', async () => {
    const read = async (answer: unknown) =>
      fetchGitlabMr(createFakeGh({ graphql: [answer] }), REPO, 'queue', 7)
    expect(await read(one(opened({ author: user('me') })))).toEqual({ viewer: 'me', pull: null })
    expect(await read(one({ ...opened(), state: 'merged' }))).toEqual({ viewer: 'me', pull: null })
    expect(await read(one(null))).toEqual({ viewer: 'me', pull: null })
    // Signed out, there is no viewer, and every merge request is someone else's.
    expect(await read(one(opened(), null))).toMatchObject({ viewer: '', pull: { number: 7 } })
  })

  it('refuses an answer of an unexpected shape, with no project, or with an odd merge request', async () => {
    const read = (answer: unknown) => fetchGitlabMr(createFakeGh({ graphql: [answer] }), REPO, 'pulls', 7)
    await expect(read({ nope: 1 })).rejects.toThrow('unexpected answer for !7 in acme/widgets')
    await expect(read({ currentUser: null, project: null })).rejects.toThrow(
      'unexpected answer for !7 in acme/widgets'
    )
    await expect(read(one({ state: 'opened', iid: 7 }))).rejects.toThrow(
      'unexpected merge request !7 in acme/widgets'
    )
  })

  it('is what gitlabLists reads one merge request with', async () => {
    const gh = createFakeGh({ graphql: [one(opened({ iid: '12' }))] })
    expect((await gitlabLists(gh, REPO).fetchOne('queue', 12)).pull?.number).toBe(12)
    expect(gh.calls[0]?.params).toEqual({ path: 'acme/widgets', iid: '12' })
  })
})

describe('fetchGitlabMembers', () => {
  const members = (
    users: Array<{ username: string; bot?: boolean } | null>,
    hasNextPage = false,
    endCursor: string | null = null
  ) => ({
    project: {
      projectMembers: {
        pageInfo: { hasNextPage, endCursor },
        nodes: users.map(member => ({ user: member })),
      },
    },
  })

  it('reads every page of the members, leaving out bots and users no longer there', async () => {
    const gh = createFakeGh({
      graphql: [
        members([user('ana'), null, user('renovate', true), { username: 'bob' }], true, 'c1'),
        members([user('cy')], true, null),
        members([user('never')]),
      ],
    })
    expect(await fetchGitlabMembers(gh, REPO)).toEqual(['ana', 'bob', 'cy'])
    expect(gh.calls.map(c => [c.path, c.params])).toEqual([
      [MEMBERS_QUERY.slice(0, 20), { path: 'acme/widgets' }],
      [MEMBERS_QUERY.slice(0, 20), { path: 'acme/widgets', cursor: 'c1' }],
    ])
  })

  it('stops after the most pages it reads', async () => {
    const pages = Array.from({ length: MAX_PAGES + 1 }, (_, i) => members([user(`u${i}`)], true, `c${i}`))
    const gh = createFakeGh({ graphql: pages })
    expect(await fetchGitlabMembers(gh, REPO)).toHaveLength(MAX_PAGES)
    expect(gh.calls).toHaveLength(MAX_PAGES)
  })

  it('refuses an answer of an unexpected shape or with no project', async () => {
    for (const answer of [{ nope: 1 }, { project: null }]) {
      await expect(fetchGitlabMembers(createFakeGh({ graphql: [answer] }), REPO)).rejects.toThrow(
        'unexpected answer to the members of acme/widgets'
      )
    }
  })

  it('is what gitlabLists reads the people with', async () => {
    const gh = createFakeGh({ graphql: [members([user('ana')])] })
    expect(await gitlabLists(gh, REPO).fetchPeople()).toEqual(['ana'])
  })
})
