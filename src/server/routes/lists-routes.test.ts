// @vitest-environment node
// The home page tables' routes through the app: the lists, sections, base branches, Highest
// priority, the builder's Ask AI, saved filters and canvas generation, with their refusals.
import type { AgentExecResult } from '../../acpx/acpx.js'
import type { ErrorEnvelope } from '../../contract/api.js'
import type { ListFetch, ListKind, ListPull } from '../../lists/model.js'
import { MAX_FILTER_BYTES } from '../../lists/store.js'
import { makeListPull } from '../../lists/testing.js'
import { createFakeRunner } from '../../testing/fake-runner.js'
import { DEFAULT_PROJECT_CONFIG } from '../../project-config.js'
import { makeTestContext, type TestContext } from '../../testing/fakes.js'
import { createApp } from '../app.js'

const LOCAL = { host: '127.0.0.1:3010' }
const WRITE = { ...LOCAL, origin: 'http://127.0.0.1:3010', 'content-type': 'application/json' }

let t: TestContext
let app: ReturnType<typeof createApp>
let fetches: ListKind[]
let ones: Array<[ListKind, number]>
let oneAnswer: ListPull | null
let agentAnswer: AgentExecResult

const LISTS: Record<ListKind, ListFetch> = {
  pulls: {
    viewer: 'me',
    pulls: [makeListPull({ number: 1, author: 'me', labels: ['bug'] })],
  },
  queue: {
    viewer: 'me',
    pulls: [
      makeListPull({ number: 2, author: 'ana', requestedReviewers: ['cy'] }),
      makeListPull({ number: 3, author: 'bob', isDraft: true }),
    ],
  },
}

beforeEach(async () => {
  fetches = []
  ones = []
  oneAnswer = null
  agentAnswer = { ok: true, text: '{"picks":[{"number":2,"why":"Waited longest."}]}' }
  t = await makeTestContext({
    listsFetcher: {
      fetch: async kind => {
        fetches.push(kind)
        return LISTS[kind]
      },
      fetchOne: async (kind, number) => {
        ones.push([kind, number])
        return { viewer: 'me', pull: oneAnswer }
      },
      fetchPeople: async () => ['ana', 'bob'],
    },
    runner: createFakeRunner({ exec: () => agentAnswer }),
  })
  app = createApp(t.ctx)
})

afterEach(async () => {
  await t.cleanup()
})

const get = (url: string) => app.request(url, { headers: LOCAL })
const send = (method: string, url: string, body?: unknown) =>
  app.request(url, {
    method,
    headers: WRITE,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  })
const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T

describe('lists routes', () => {
  it('answers each list, the queue with Highest priority', async () => {
    expect((await get('/api/lists/pulls')).status).toBe(200)
    // The project's people follow the list's first read in the background.
    await vi.waitFor(async () =>
      expect((await t.ctx.lists.store.readPeople())?.logins).toEqual(['ana', 'bob'])
    )
    const pulls = await get('/api/lists/pulls')
    expect(pulls.status).toBe(200)
    const body = await json(pulls)
    expect(body).toMatchObject({
      viewer: 'me',
      branches: [{ name: 'main', color: 'green' }],
      people: ['ana', 'bob'],
    })
    expect(body).not.toHaveProperty('priority')

    const queue = await json<{
      rows: Array<{ number: number }>
      priority: { picks: unknown[]; syncing: boolean }
    }>(await get('/api/lists/queue'))
    expect(queue.rows.map(r => r.number)).toEqual([2, 3])
    expect(queue.priority).toMatchObject({ picks: [], syncing: false, count: 3 })
  })

  it('reads a list again on sync', async () => {
    await get('/api/lists/pulls')
    const res = await send('POST', '/api/lists/pulls/sync')
    expect(res.status).toBe(200)
    expect(fetches).toEqual(['pulls', 'pulls'])
    expect((await json<{ rows: unknown[] }>(res)).rows).toHaveLength(1)
  })

  it('reads one PR again on its sync, and answers with its list', async () => {
    await get('/api/lists/queue')
    oneAnswer = makeListPull({ number: 2, author: 'ana', title: 'Renamed' })
    const res = await send('POST', '/api/lists/queue/2/sync')
    expect(res.status).toBe(200)
    expect(ones).toEqual([['queue', 2]])
    expect(fetches).toEqual(['queue'])
    const body = await json<{ rows: Array<{ number: number; title: string }> }>(res)
    expect(body.rows.map(r => [r.number, r.title])).toEqual([
      [2, 'Renamed'],
      [3, 'Change 3'],
    ])

    oneAnswer = null
    const gone = await json<{ rows: Array<{ number: number }> }>(
      await send('POST', '/api/lists/queue/3/sync')
    )
    expect(gone.rows.map(r => r.number)).toEqual([2])
  })

  it('refuses a PR sync for a list it does not know or a number that is not a PR', async () => {
    expect((await send('POST', '/api/lists/drafts/2/sync')).status).toBe(404)
    for (const n of ['0', '-1', '1.5', 'x']) {
      const res = await send('POST', `/api/lists/pulls/${n}/sync`)
      expect(res.status).toBe(400)
      expect((await json<ErrorEnvelope>(res)).error).toMatchObject({
        code: 'BAD_REQUEST',
        message: 'not a pull request number',
      })
    }
    expect(ones).toEqual([])
  })

  it('answers 404 for a list it does not know', async () => {
    const res = await get('/api/lists/drafts')
    expect(res.status).toBe(404)
    expect((await json<ErrorEnvelope>(res)).error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'no list named drafts',
      hint: 'use pulls or queue',
    })
    expect((await send('POST', '/api/lists/drafts/sync')).status).toBe(404)
  })

  it('answers and saves the sections', async () => {
    await send('POST', '/api/lists/pulls/sync')
    await send('POST', '/api/lists/queue/sync')
    const before = await json<{ sections: unknown[]; pulls: unknown[] }>(await get('/api/lists-sections'))
    expect(before.sections.length).toBeGreaterThan(0)
    expect(before.pulls).toEqual([
      { number: 1, title: 'Change 1', labels: ['bug'] },
      { number: 2, title: 'Change 2', labels: [] },
      { number: 3, title: 'Change 3', labels: [] },
    ])

    const saved = await send('PUT', '/api/lists-sections', {
      sections: [
        { name: 'Backend', labels: ['api'] },
        { name: 'Other', labels: ['dropped'] },
      ],
    })
    expect(saved.status).toBe(200)
    expect(await json(saved)).toEqual({
      sections: [
        { name: 'Backend', labels: ['api'] },
        { name: 'Other', labels: [] },
      ],
    })
    expect((await send('PUT', '/api/lists-sections', { sections: [] })).status).toBe(400)
    expect((await send('PUT', '/api/lists-sections', 'not json')).status).toBe(400)
  })

  it('answers and saves the base branches, back to main on null', async () => {
    expect(await json(await get('/api/lists-branches'))).toEqual({
      branches: [{ name: 'main', color: 'green' }],
    })
    // A sync reads no default branch: main stays until branches are saved.
    await send('POST', '/api/lists/pulls/sync')
    expect(await json(await get('/api/lists-branches'))).toEqual({
      branches: [{ name: 'main', color: 'green' }],
    })

    const saved = await send('PUT', '/api/lists-branches', { branches: [{ name: 'develop', color: 'blue' }] })
    expect(await json(saved)).toEqual({ branches: [{ name: 'develop', color: 'blue' }] })
    expect(await json(await get('/api/lists-branches'))).toEqual({
      branches: [{ name: 'develop', color: 'blue' }],
    })

    const twice = await send('PUT', '/api/lists-branches', {
      branches: [
        { name: 'main', color: 'green' },
        { name: 'main', color: 'red' },
      ],
    })
    expect(twice.status).toBe(400)
    expect(await json(await send('PUT', '/api/lists-branches', { branches: null }))).toEqual({
      branches: null,
    })
  })

  it('saves Highest priority and goes back to the defaults on null', async () => {
    const saved = await send('PUT', '/api/lists-priority', {
      priority: { prompts: [{ name: 'Mine', prompt: 'Small first' }], active: 'Mine', count: 2 },
    })
    expect(saved.status).toBe(200)
    expect(await json(saved)).toMatchObject({ active: 'Mine', prompt: 'Small first', count: 2 })
    const reset = await json(await send('PUT', '/api/lists-priority', { priority: null }))
    expect(reset).toMatchObject({ active: 'Default', count: 3 })
    expect(
      (await send('PUT', '/api/lists-priority', { priority: { prompts: [], active: 'x', count: 0 } })).status
    ).toBe(400)
  })

  it('syncs Highest priority over the queue as it is', async () => {
    const res = await send('POST', '/api/lists-priority/sync')
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({
      picks: [{ number: 2, why: 'Waited longest.' }],
      error: null,
      syncing: false,
      stale: false,
    })
    expect(
      (await json<{ priority: { picks: unknown[] } }>(await get('/api/lists/queue'))).priority.picks
    ).toHaveLength(1)
  })

  it('answers the builder’s Ask AI with the agent’s blocks, and refuses a bad body', async () => {
    agentAnswer = {
      ok: true,
      text: '{"reply":"Only ana.","blocks":{"op":"and","items":[{"field":"author","is":"any","values":["ana"]}]}}',
    }
    const body = {
      page: 'queue',
      messages: [{ from: 'you', text: 'only ana' }],
      fields: [{ key: 'author', label: 'Author', multi: false, options: [['ana', 'ana']] }],
      current: null,
    }
    const res = await send('POST', '/api/lists-builder/ask', body)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({
      reply: 'Only ana.',
      blocks: { op: 'and', items: [{ field: 'author', is: 'any', values: ['ana'] }] },
    })

    agentAnswer = { ok: false, text: '', message: 'not logged in' }
    expect((await send('POST', '/api/lists-builder/ask', body)).status).toBe(502)
    expect((await send('POST', '/api/lists-builder/ask', { ...body, messages: [] })).status).toBe(400)
  })

  it('saves and forgets one page’s filters', async () => {
    const saved = await send('PUT', '/api/lists-filters/pulls', { value: { state: ['open'] } })
    expect(saved.status).toBe(200)
    expect(await json(saved)).toEqual({ ok: true })
    await send('PUT', '/api/lists-filters/presets', { value: [{ name: 'Mine' }] })
    expect(await t.ctx.lists.store.readFilters()).toEqual({
      pulls: { state: ['open'] },
      presets: [{ name: 'Mine' }],
    })
    await send('PUT', '/api/lists-filters/pulls', { value: null })
    expect(await t.ctx.lists.store.readFilters()).toEqual({ presets: [{ name: 'Mine' }] })
  })

  it('refuses filters for an unknown page, of the wrong shape, or too large', async () => {
    const unknown = await send('PUT', '/api/lists-filters/secrets', { value: {} })
    expect(unknown.status).toBe(404)
    expect((await json<ErrorEnvelope>(unknown)).error.message).toBe('no filters named secrets')
    expect((await send('PUT', '/api/lists-filters/pulls', { value: 'text' })).status).toBe(400)
    const big = await send('PUT', '/api/lists-filters/pulls', {
      value: { text: 'x'.repeat(MAX_FILTER_BYTES) },
    })
    expect(big.status).toBe(400)
    expect((await json<ErrorEnvelope>(big)).error.message).toBe(
      `saved filters are at most ${MAX_FILTER_BYTES} bytes`
    )
    expect(await t.ctx.lists.store.readFilters()).toEqual({})
  })

  describe('canvas generation', () => {
    const HEAD = 'a'.repeat(40)
    const OLD = 'e'.repeat(40)

    /** A context of its own, with agents on or off and acpx installed or not, and the lists read. */
    const generateApp = async (opts: { chat: boolean; acpx: string | null }) => {
      await t.cleanup()
      t = await makeTestContext({
        listsFetcher: {
          fetch: async kind => LISTS[kind],
          fetchOne: async () => ({ viewer: 'me', pull: null }),
          fetchPeople: async () => [],
        },
        runner: createFakeRunner({ acpxVersion: opts.acpx }),
        projectConfig: {
          config: { ...DEFAULT_PROJECT_CONFIG, chat: { enabled: opts.chat } },
          warnings: [],
          source: null,
        },
      })
      app = createApp(t.ctx)
      await send('POST', '/api/lists/pulls/sync')
      await send('POST', '/api/lists/queue/sync')
    }

    /** The canvas the store finds for every PR, read without the PR opened here. */
    const found = (status: 'ready' | 'stale', headSha: string) =>
      vi.spyOn(t.ctx.canvases, 'findForPr').mockResolvedValue({ status, headSha } as never)

    it('answers what the generate dialog shows for a PR with no canvas', async () => {
      await generateApp({ chat: true, acpx: '0.19.4' })
      const res = await get('/api/lists-generate/2/dialog')
      expect(res.status).toBe(200)
      const body = await json(res)
      expect(body).toMatchObject({
        local: false,
        status: 'missing',
        skillCommand: '/pr-review-canvas 2',
        chat: { enabled: true, acpx: true },
        canvasComment: expect.any(Boolean),
      })
      expect(body).not.toHaveProperty('carriedOver')
      const settings = await t.ctx.chat.effectiveSettings()
      expect((body as { chat: Record<string, unknown> }).chat).toEqual({
        enabled: true,
        acpx: true,
        agent: settings.chatAgent,
        model: settings.chatModel,
      })
    })

    it('answers ready with --force for the head’s own canvas, and carried over for an older one', async () => {
      await generateApp({ chat: true, acpx: '0.19.4' })
      found('ready', HEAD)
      const own = await json(await get('/api/lists-generate/1/dialog'))
      expect(own).toMatchObject({ status: 'ready', skillCommand: '/pr-review-canvas 1 --force' })
      expect(own).not.toHaveProperty('carriedOver')

      found('ready', OLD)
      expect(await json(await get('/api/lists-generate/1/dialog'))).toMatchObject({
        status: 'ready',
        carriedOver: { canvasHeadSha: OLD, currentHeadSha: HEAD },
        skillCommand: '/pr-review-canvas 1',
      })
    })

    it('answers stale for a canvas of other commits', async () => {
      await generateApp({ chat: true, acpx: '0.19.4' })
      found('stale', OLD)
      const body = await json(await get('/api/lists-generate/3/dialog'))
      expect(body).toMatchObject({ status: 'stale', skillCommand: '/pr-review-canvas 3' })
      expect(body).not.toHaveProperty('carriedOver')
    })

    it('says chat is off, with no agent, where agents are turned off or acpx is missing', async () => {
      await generateApp({ chat: false, acpx: '0.19.4' })
      expect((await json(await get('/api/lists-generate/1/dialog')))['chat']).toEqual({
        enabled: false,
        acpx: false,
      })
      await generateApp({ chat: true, acpx: null })
      expect((await json(await get('/api/lists-generate/1/dialog')))['chat']).toMatchObject({
        enabled: false,
        acpx: false,
      })
    })

    it('refuses a dialog for what is not a pull request number, or a PR not in the lists', async () => {
      for (const n of ['0', '-2', '1.5', 'abc']) {
        const res = await get(`/api/lists-generate/${n}/dialog`)
        expect(res.status).toBe(400)
        expect((await json<ErrorEnvelope>(res)).error).toMatchObject({
          code: 'BAD_REQUEST',
          message: 'not a pull request number',
        })
      }
      // Lists never read have no PR in them.
      const res = await get('/api/lists-generate/1/dialog')
      expect(res.status).toBe(404)
      expect((await json<ErrorEnvelope>(res)).error).toMatchObject({
        code: 'NOT_FOUND',
        message: '#1 is not in the lists',
        hint: 'sync the list',
      })
      await send('POST', '/api/lists/pulls/sync')
      expect((await get('/api/lists-generate/1/dialog')).status).toBe(200)
      expect((await get('/api/lists-generate/99/dialog')).status).toBe(404)
    })

    it('stops a PR’s generation, and answers whether one ran', async () => {
      const stop = vi.spyOn(t.ctx.lists.generations, 'stop').mockResolvedValue(true)
      const res = await send('DELETE', '/api/lists-generate/12')
      expect(res.status).toBe(200)
      expect(await json(res)).toEqual({ stopped: true })
      expect(stop).toHaveBeenCalledWith(12)
    })

    it('answers stopped false for a PR with nothing running', async () => {
      const res = await send('DELETE', '/api/lists-generate/7')
      expect(res.status).toBe(200)
      expect(await json(res)).toEqual({ stopped: false })
    })

    it('refuses to stop what is not a pull request number', async () => {
      const stop = vi.spyOn(t.ctx.lists.generations, 'stop')
      for (const n of ['0', '-2', '1.5', 'abc']) {
        const res = await send('DELETE', `/api/lists-generate/${n}`)
        expect(res.status).toBe(400)
        expect((await json<ErrorEnvelope>(res)).error).toMatchObject({
          code: 'BAD_REQUEST',
          message: 'not a pull request number',
        })
      }
      expect(stop).not.toHaveBeenCalled()
    })

    it('keeps other sites from stopping', async () => {
      const headers = { ...LOCAL, origin: 'https://evil.example', 'content-type': 'application/json' }
      expect((await app.request('/api/lists-generate/1', { method: 'DELETE', headers })).status).toBe(403)
    })
  })

  describe('review requests', () => {
    let requests: Array<[number, string[], boolean]>
    let forge: (logins: readonly string[], ask: boolean) => string[]

    /** The queue read, the project's people in, and the forge's review requests a fake. */
    beforeEach(async () => {
      await send('POST', '/api/lists/queue/sync')
      await vi.waitFor(async () => expect(await t.ctx.lists.store.readPeople()).not.toBeNull())
      await t.ctx.lists.store.writePeople({
        fetchedAt: t.ctx.now().toISOString(),
        logins: ['ana', 'bob', 'cy', 'dan', 'Bea'],
      })
      requests = []
      forge = (logins, ask) => (ask ? ['cy', ...logins] : [])
      t.ctx.lists.reviewers = {
        request: async (number, logins, ask) => {
          requests.push([number, [...logins], ask])
          return forge(logins, ask)
        },
      }
      oneAnswer = makeListPull({ number: 2, author: 'ana', requestedReviewers: ['cy', 'dan'] })
    })

    it('answers whose PR it is and who it asks, as last read', async () => {
      const res = await get('/api/lists/queue/2/reviewers')
      expect(res.status).toBe(200)
      expect(await json(res)).toEqual({ author: 'ana', requested: ['cy'] })
      expect(await json(await get('/api/lists/queue/3/reviewers'))).toEqual({ author: 'bob', requested: [] })
    })

    it('refuses a number that is not a PR, a PR not in the list, and a list it does not know', async () => {
      for (const n of ['0', '-1', '1.5', 'x']) {
        const res = await get(`/api/lists/queue/${n}/reviewers`)
        expect(res.status).toBe(400)
        expect((await json<ErrorEnvelope>(res)).error.message).toBe('not a pull request number')
      }
      const missing = await get('/api/lists/queue/99/reviewers')
      expect(missing.status).toBe(404)
      expect((await json<ErrorEnvelope>(missing)).error).toMatchObject({
        code: 'NOT_FOUND',
        message: '#99 is not in the list',
        hint: 'sync the list',
      })
      // Your PRs was never read: it holds no PR.
      expect((await get('/api/lists/pulls/1/reviewers')).status).toBe(404)
      expect((await get('/api/lists/drafts/2/reviewers')).status).toBe(404)
      expect((await get('/api/lists/queue/99/reviewers/people')).status).toBe(404)
      expect((await send('POST', '/api/lists/queue/99/reviewers', { add: ['bob'] })).status).toBe(404)
      expect(requests).toEqual([])
    })

    it('offers the project’s people for what was typed, never the author, those on the PR first', async () => {
      expect(await json(await get('/api/lists/queue/2/reviewers/people'))).toEqual({
        people: ['cy', 'Bea', 'bob', 'dan'].map(login => ({ login, name: null })),
        complete: true,
      })
      expect(await json(await get('/api/lists/queue/2/reviewers/people?q=B'))).toEqual({
        people: [
          { login: 'Bea', name: null },
          { login: 'bob', name: null },
        ],
        complete: true,
      })
    })

    it('offers no one before the project’s people are read', async () => {
      vi.spyOn(t.ctx.lists.store, 'readPeople').mockResolvedValueOnce(null)
      expect(await json(await get('/api/lists/queue/2/reviewers/people?q=b'))).toEqual({
        people: [],
        complete: true,
      })
    })

    it('refuses a search longer than any login start', async () => {
      const res = await get(`/api/lists/queue/2/reviewers/people?q=${'a'.repeat(61)}`)
      expect(res.status).toBe(400)
      expect((await json<ErrorEnvelope>(res)).error.message).toBe('q must be the start of a login')
      expect((await get(`/api/lists/queue/2/reviewers/people?q=${'a'.repeat(60)}`)).status).toBe(200)
    })

    it('stops asking, then asks, reads the PR again, and answers who the forge asks now', async () => {
      const res = await send('POST', '/api/lists/queue/2/reviewers', { add: ['dan'], remove: ['cy'] })
      expect(res.status).toBe(200)
      expect(await json(res)).toEqual({ author: 'ana', requested: ['cy', 'dan'] })
      expect(requests).toEqual([
        [2, ['cy'], false],
        [2, ['dan'], true],
      ])
      expect(ones).toEqual([['queue', 2]])
      expect((await t.ctx.lists.store.readSnapshot('queue'))?.pulls[0]?.requestedReviewers).toEqual([
        'cy',
        'dan',
      ])
    })

    it('answers the forge’s word after only stopping asking', async () => {
      const res = await send('POST', '/api/lists/queue/2/reviewers', { remove: ['cy'] })
      expect(await json(res)).toEqual({ author: 'ana', requested: [] })
      expect(requests).toEqual([[2, ['cy'], false]])
      expect(ones).toEqual([['queue', 2]])
    })

    it('sends nothing and reads nothing again for an empty change', async () => {
      const res = await send('POST', '/api/lists/queue/2/reviewers', {})
      expect(res.status).toBe(200)
      expect(await json(res)).toEqual({ author: 'ana', requested: ['cy'] })
      expect(await json(await send('POST', '/api/lists/queue/2/reviewers', { add: [], remove: [] }))).toEqual(
        {
          author: 'ana',
          requested: ['cy'],
        }
      )
      expect(requests).toEqual([])
      expect(ones).toEqual([])
    })

    it('refuses to ask the author, in any case, and sends nothing', async () => {
      const res = await send('POST', '/api/lists/queue/2/reviewers', { add: ['bob', 'ANA'] })
      expect(res.status).toBe(400)
      expect((await json<ErrorEnvelope>(res)).error.message).toBe(
        'a PR’s author cannot be asked to review it'
      )
      expect(requests).toEqual([])
    })

    it('refuses what is not a login, too many at once, and a body that is not JSON', async () => {
      for (const body of [
        { add: ['-bob'] },
        { remove: ['bob b'] },
        { add: 'bob' },
        { add: Array.from({ length: 16 }, (_, i) => `u${i}`) },
        'not json',
      ]) {
        expect((await send('POST', '/api/lists/queue/2/reviewers', body)).status).toBe(400)
      }
      expect(requests).toEqual([])
    })

    it('answers the forge’s word even when the PR cannot be read again, and logs that', async () => {
      const log = vi.spyOn(t.ctx, 'log')
      vi.spyOn(t.ctx.lists.manager, 'syncOne').mockRejectedValueOnce(new Error('gh: rate limited'))
      const res = await send('POST', '/api/lists/queue/2/reviewers', { add: ['bob'] })
      expect(res.status).toBe(200)
      expect(await json(res)).toEqual({ author: 'ana', requested: ['cy', 'bob'] })
      expect(log).toHaveBeenCalledWith('could not read #2 again: Error: gh: rate limited')
    })

    it('passes on what the forge refused, and reads the PR again, a half-done change and all', async () => {
      forge = () => {
        throw new Error('gh: Reviews may only be requested from collaborators')
      }
      const res = await send('POST', '/api/lists/queue/2/reviewers', { add: ['bob'] })
      expect(res.status).toBeGreaterThanOrEqual(400)
      expect(ones).toEqual([['queue', 2]])
    })

    it('keeps other sites from changing who a PR asks', async () => {
      const res = await app.request('/api/lists/queue/2/reviewers', {
        method: 'POST',
        headers: { ...LOCAL, origin: 'https://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({ add: ['bob'] }),
      })
      expect(res.status).toBe(403)
      expect(requests).toEqual([])
    })
  })

  it('keeps other sites from writing', async () => {
    const res = await app.request('/api/lists-filters/pulls', {
      method: 'PUT',
      headers: { ...LOCAL, origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ value: {} }),
    })
    expect(res.status).toBe(403)
  })
})
