// The lists' parts as one project builds them: the forge's reads by host kind or the one given,
// one-shot calls with the chat's agent, and Highest priority kept in the store.
import type { GenerationJob } from '../contract/generation.js'
import { gitlabHost } from '../host/host.js'
import { createFakeRunner } from '../testing/fake-runner.js'
import { createFakeGh, ghJson, ghPost, makeTestContext, type TestContext } from '../testing/fakes.js'
import { createListsSet } from './set.js'
import type { ReviewerRequester } from './review-requests.js'
import { makeListPull } from './testing.js'

let t: TestContext

afterEach(async () => {
  await t.cleanup()
})

const githubPage = {
  viewer: { login: 'me' },
  search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
}

const gitlabPage = {
  currentUser: { username: 'me' },
  project: {
    mergeRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
  },
}

describe('createListsSet', () => {
  it('reads GitHub through the pull request search', async () => {
    const gh = createFakeGh({ graphql: [githubPage] })
    t = await makeTestContext({ gh })
    await t.ctx.lists.manager.sync('pulls')
    expect(gh.calls[0]?.params).toEqual({ q: 'repo:acme/widgets is:pr is:open author:@me sort:created-desc' })
    expect(await t.ctx.lists.store.readSnapshot('pulls')).toMatchObject({ viewer: 'me', pulls: [] })
  })

  it('reads GitLab through the merge request list', async () => {
    const gh = createFakeGh({ graphql: [gitlabPage] })
    t = await makeTestContext({ gh, host: gitlabHost('gitlab.com') })
    await t.ctx.lists.manager.sync('queue')
    expect(gh.calls[0]?.params).toEqual({ path: 'acme/widgets' })
    expect(await t.ctx.lists.store.readSnapshot('queue')).toMatchObject({ viewer: 'me', pulls: [] })
  })

  it('reads through the fetcher it is given', async () => {
    const gh = createFakeGh()
    t = await makeTestContext({
      gh,
      listsFetcher: {
        fetch: async () => ({ viewer: 'given', pulls: [] }),
        fetchOne: async () => ({ viewer: 'given', pull: null }),
        fetchPeople: async () => [],
      },
    })
    expect((await t.ctx.lists.manager.view('pulls')).viewer).toBe('given')
    expect(gh.calls).toEqual([])
  })

  it('calls the chat’s agent in a folder of its own, and keeps Highest priority in the store', async () => {
    const runner = createFakeRunner({ exec: { ok: true, text: 'fine' } })
    t = await makeTestContext({ runner })
    expect(await t.ctx.lists.oneShot('builder', 'hello')).toEqual({ ok: true, text: 'fine' })
    expect(runner.execs).toEqual([
      { agent: (await t.ctx.chat.effectiveSettings()).chatAgent, prompt: 'hello' },
    ])

    const settings = (await t.ctx.lists.store.readSettings()).priority
    const result = await t.ctx.lists.priority.sync([], settings)
    expect(await t.ctx.lists.store.readPriorityResult()).toEqual(result)
  })

  it('shows and stops the project’s canvas generations in the rows', async () => {
    t = await makeTestContext({
      listsFetcher: {
        fetch: async () => ({
          viewer: 'me',
          pulls: [makeListPull({ number: 1 }), makeListPull({ number: 2 })],
        }),
        fetchOne: async () => ({ viewer: 'me', pull: null }),
        fetchPeople: async () => [],
      },
    })
    const lists = t.ctx.lists
    const running: GenerationJob = {
      key: 1,
      force: false,
      agent: 'claude',
      model: null,
      skill: { source: 'default', version: '0.0.0-test' },
      phase: 'generating',
      round: 1,
      maxRounds: 4,
      startedAt: '2026-10-22T12:00:00.000Z',
      activity: [],
    }
    vi.spyOn(t.ctx.generation, 'status').mockImplementation(key => (key === 1 ? running : null))
    const cancel = vi.spyOn(t.ctx.generation, 'cancel').mockResolvedValue(true)
    const rows = (await lists.manager.view('pulls')).rows
    expect(rows.map(r => r.generation)).toEqual([
      { state: 'running', phase: 'generating', startedAt: '2026-10-22T12:00:00.000Z' },
      undefined,
    ])
    expect(await lists.generations.stop(1)).toBe(true)
    expect(cancel).toHaveBeenCalledWith(1)
  })

  it('asks GitHub for reviews through the pull request’s requested reviewers', async () => {
    const gh = createFakeGh({
      postRoutes: {
        'repos/acme/widgets/pulls/5/requested_reviewers': ghPost(() => ({
          requested_reviewers: [{ login: 'ana' }],
        })),
      },
    })
    t = await makeTestContext({ gh })
    expect(await t.ctx.lists.reviewers.request(5, ['ana'], true)).toEqual(['ana'])
    expect(gh.calls).toEqual([
      expect.objectContaining({
        kind: 'post',
        path: 'repos/acme/widgets/pulls/5/requested_reviewers',
        body: { reviewers: ['ana'] },
      }),
    ])
  })

  it('asks GitLab for reviews through the merge request’s reviewers', async () => {
    const mr = 'projects/acme%2Fwidgets/merge_requests/5'
    const gh = createFakeGh({
      routes: { [mr]: ghJson({ reviewers: [{ id: 4, username: 'ana' }] }) },
      postRoutes: { [mr]: ghPost(() => ({ reviewers: [] })) },
    })
    t = await makeTestContext({ gh, host: gitlabHost('gitlab.com') })
    expect(await t.ctx.lists.reviewers.request(5, ['ana'], false)).toEqual([])
    expect(gh.calls.map(c => [c.kind, c.path, c.body])).toEqual([
      ['api', mr, undefined],
      ['post', mr, { reviewer_ids: [] }],
    ])
  })

  it('asks for reviews through the requester it is given', async () => {
    t = await makeTestContext()
    const given: ReviewerRequester = { request: async () => ['given'] }
    const lists = createListsSet({
      config: t.ctx.config,
      gh: t.ctx.gh,
      runner: createFakeRunner(),
      chatSettings: () => t.ctx.chat.effectiveSettings(),
      canvasFacts: async () => ({ status: 'Pending', points: null }),
      generation: () => t.ctx.generation,
      now: t.ctx.now,
      log: () => undefined,
      reviewers: given,
    })
    expect(lists.reviewers).toBe(given)
  })
})
