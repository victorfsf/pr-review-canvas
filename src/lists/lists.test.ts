// The lists kept fresh: rows as the tables draw them, and the manager that answers from the last
// fetch and reads a stale or missing list again.
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir } from '../testing/fakes.js'
import {
  createListsManager,
  effectiveBranches,
  type ListsManager,
  PEOPLE_STALE_MS,
  rowsOf,
  STALE_MS,
} from './lists.js'
import type { CanvasFacts } from './canvas-status.js'
import type { RowGeneration } from './generations.js'
import type { ListFetch, ListFetcher, ListKind, ListPull } from './model.js'
import { createListsStore, type ListsStore } from './store.js'
import { makeListPull } from './testing.js'

const NOW = '2026-10-22T12:00:00.000Z'
const NO_CANVASES: ReadonlyMap<number, CanvasFacts> = new Map()

describe('effectiveBranches', () => {
  it('takes the saved branches, else main', () => {
    const saved = [{ name: 'develop', color: 'blue' as const }]
    expect(effectiveBranches(saved)).toBe(saved)
    expect(effectiveBranches(null)).toEqual([{ name: 'main', color: 'green' }])
  })
})

describe('rowsOf', () => {
  const failing = { name: 'ci', status: 'fail' as const, since: null }
  const expected = { name: 'req', status: 'expected' as const, since: null }

  it('keeps internal facts out and adds failing CI, stuck CI and a conflict to your Pending', () => {
    const pulls = [
      makeListPull({ number: 1, pending: 2, checks: [failing, expected], mergeable: 'CONFLICTING' }),
      makeListPull({ number: 2, pending: 0 }),
    ]
    const rows = rowsOf('pulls', pulls, {
      now: NOW,
      canvas: NO_CANVASES,
      branches: ['main'],
      repoHasChecks: true,
    })
    expect(rows.map(r => r.pending)).toEqual([5, 0])
    expect(rows[0]?.health).toMatchObject({ ci: 'failing', conflict: true })
    expect(rows[0]?.canvas).toBe('Pending')
    for (const key of ['headSha', 'checks', 'headCommittedAt', 'mergeable', 'canvasShas', 'canvasOpen']) {
      expect(rows[0]).not.toHaveProperty(key)
    }
  })

  it('takes each PR’s canvas status and open points by number, Pending and no count where none', () => {
    const pulls = [makeListPull({ number: 1 }), makeListPull({ number: 2 }), makeListPull({ number: 3 })]
    const rows = rowsOf('queue', pulls, {
      now: NOW,
      canvas: new Map<number, CanvasFacts>([
        [1, { status: 'Ready', points: { author: 2, reviewer: 1 } }],
        [2, { status: 'Stale', points: null }],
      ]),
      branches: ['main'],
      repoHasChecks: false,
    })
    expect(rows.map(r => [r.canvas, r.points])).toEqual([
      ['Ready', { author: 2, reviewer: 1 }],
      ['Stale', undefined],
      ['Pending', undefined],
    ])
  })

  it('leaves the queue’s Pending as fetched, and places stacked PRs in their stack', () => {
    const pulls = [
      makeListPull({ number: 1, headRefName: 'a', baseRefName: 'main', checks: [failing] }),
      makeListPull({ number: 2, headRefName: 'b', baseRefName: 'a' }),
      makeListPull({ number: 3, headRefName: 'c', baseRefName: 'main' }),
    ]
    const rows = rowsOf('queue', pulls, {
      now: NOW,
      canvas: NO_CANVASES,
      branches: ['main'],
      repoHasChecks: false,
    })
    expect(rows.map(r => r.pending)).toEqual([0, 0, 0])
    expect(rows[0]?.stack).toMatchObject({ position: 1, total: 2 })
    expect(rows[1]?.stack).toMatchObject({ position: 2, total: 2 })
    expect(rows[2]).not.toHaveProperty('stack')
  })

  it('carries each PR’s canvas generation, and leaves it out where there is none', () => {
    const pulls = [makeListPull({ number: 1 }), makeListPull({ number: 2 }), makeListPull({ number: 3 })]
    const states: Record<number, RowGeneration> = {
      1: { state: 'running', phase: 'checkout', startedAt: NOW },
      3: { state: 'failed', message: 'not logged in', endedAt: null },
    }
    const asked: number[] = []
    const rows = rowsOf('queue', pulls, {
      now: NOW,
      canvas: NO_CANVASES,
      branches: ['main'],
      repoHasChecks: false,
      generation: n => {
        asked.push(n)
        return states[n]
      },
    })
    expect(asked).toEqual([1, 2, 3])
    expect(rows[0]?.generation).toEqual({ state: 'running', phase: 'checkout', startedAt: NOW })
    expect(rows[1]).not.toHaveProperty('generation')
    expect(rows[2]?.generation).toEqual({ state: 'failed', message: 'not logged in', endedAt: null })
    expect(
      rowsOf('queue', pulls, { now: NOW, canvas: NO_CANVASES, branches: ['main'], repoHasChecks: false })[0]
    ).not.toHaveProperty('generation')
  })
})

/** A fetch the test lets finish when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** The reads the fakes that never ask for one PR or for the people answer with. */
const QUIET: Omit<ListFetcher, 'fetch'> = {
  fetchOne: async () => ({ viewer: 'me', pull: null }),
  fetchPeople: async () => [],
}

const fetched = (numbers: number[], over: Partial<ListFetch> = {}): ListFetch => ({
  viewer: 'me',
  pulls: numbers.map(number => makeListPull({ number })),
  ...over,
})

describe('createListsManager', () => {
  let dir: string
  let store: ListsStore
  let clock: Date
  let fetches: Array<{ kind: ListKind; answer: ReturnType<typeof deferred<ListFetch>> }>
  let logs: string[]
  let changed: ListKind[]
  let one: { viewer: string; pull: ListPull | null }
  let onesAsked: Array<[ListKind, number]>
  let people: () => Promise<string[]>
  let peopleReads: number
  /** Runs while one PR is read, before the read answers. */
  let duringOne: () => Promise<void>
  let manager: ListsManager

  beforeEach(async () => {
    dir = await makeTempDir()
    store = createListsStore(dir)
    clock = new Date(NOW)
    fetches = []
    logs = []
    changed = []
    one = { viewer: 'me', pull: null }
    onesAsked = []
    people = async () => []
    peopleReads = 0
    duringOne = async () => undefined
    manager = createListsManager({
      fetcher: {
        fetch: kind => {
          const answer = deferred<ListFetch>()
          fetches.push({ kind, answer })
          return answer.promise
        },
        fetchOne: async (kind, number) => {
          onesAsked.push([kind, number])
          await duringOne()
          return one
        },
        fetchPeople: () => {
          peopleReads++
          return people()
        },
      },
      store,
      canvasFacts: async () => ({ status: 'Pending', points: null }),
      now: () => clock,
      log: line => logs.push(line),
      changed: kind => changed.push(kind),
    })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  /** Lets pending promise callbacks run. */
  const settle = () => new Promise(resolve => setTimeout(resolve, 10))

  /** Waits for the people's read a list's read starts behind it, by what it leaves in the store. */
  const peopleRead = (logins: string[], fetchedAt = clock.toISOString()) =>
    vi.waitFor(async () => expect(await store.readPeople()).toEqual({ fetchedAt, logins }))

  it('waits for a list never fetched, and keeps it with when it was read', async () => {
    const view = manager.view('pulls')
    await settle()
    expect(fetches.map(f => f.kind)).toEqual(['pulls'])
    fetches[0]?.answer.resolve(fetched([1, 2]))
    const answer = await view
    expect(answer.rows.map(r => r.number)).toEqual([1, 2])
    expect(answer).toMatchObject({
      viewer: 'me',
      state: { fetchedAt: NOW, error: null, syncing: false },
      branches: [{ name: 'main', color: 'green' }],
      counts: { pulls: 2, queue: 0 },
    })
    expect(answer.sections.length).toBeGreaterThan(0)
    expect(changed).toEqual(['pulls'])
  })

  it('answers a fresh list at once without reading it again', async () => {
    await store.writeSnapshot('queue', { ...fetched([3]), fetchedAt: NOW })
    const view = await manager.view('queue')
    expect(view.rows.map(r => r.number)).toEqual([3])
    expect(fetches).toHaveLength(0)
  })

  it('answers a stale list from the last fetch and reads it again behind the answer', async () => {
    await store.writeSnapshot('pulls', { ...fetched([1]), fetchedAt: NOW })
    clock = new Date(Date.parse(NOW) + STALE_MS + 1)
    const stale = await manager.view('pulls')
    expect(stale.rows.map(r => r.number)).toEqual([1])
    expect(stale.state.syncing).toBe(true)
    expect(fetches).toHaveLength(1)
    // A second look while the read runs joins it.
    await manager.view('pulls')
    expect(fetches).toHaveLength(1)
    fetches[0]?.answer.resolve(fetched([1, 4]))
    await settle()
    const fresh = await manager.view('pulls')
    expect(fresh.rows.map(r => r.number)).toEqual([1, 4])
    expect(fresh.state).toEqual({ fetchedAt: clock.toISOString(), error: null, syncing: false })
  })

  it('joins a sync already running', async () => {
    const first = manager.sync('queue')
    const second = manager.sync('queue')
    expect(fetches).toHaveLength(1)
    fetches[0]?.answer.resolve(fetched([5]))
    await Promise.all([first, second])
    expect((await store.readSnapshot('queue'))?.pulls.map(p => p.number)).toEqual([5])
  })

  it('records a failed read, keeps the list empty, and clears the error once a read succeeds', async () => {
    const view = manager.view('queue')
    await settle()
    fetches[0]?.answer.reject(new Error('gh: rate limited'))
    const failed = await view
    expect(failed).toMatchObject({
      rows: [],
      viewer: '',
      state: { fetchedAt: null, error: 'gh: rate limited' },
    })
    expect(logs).toEqual(['could not read the Review queue list: gh: rate limited'])

    const again = manager.sync('pulls')
    fetches[1]?.answer.reject('plain failure')
    await again
    expect(logs[1]).toBe('could not read the Your PRs list: plain failure')

    const retry = manager.sync('queue')
    fetches[2]?.answer.resolve(fetched([6]))
    await retry
    expect((await manager.view('queue')).state.error).toBeNull()
  })

  it('uses saved base branches over the default branch, and checks on either list mean CI', async () => {
    const checked = makeListPull({ number: 9, checks: [{ name: 'ci', status: 'pass', since: null }] })
    await store.writeSnapshot('queue', {
      ...fetched([]),
      pulls: [checked, makeListPull({ number: 8, isDraft: true })],
      fetchedAt: NOW,
    })
    await store.writeSnapshot('pulls', {
      ...fetched([]),
      pulls: [makeListPull({ number: 1, headCommittedAt: '2026-10-22T10:00:00Z' })],
      fetchedAt: NOW,
    })
    const before = await manager.view('pulls')
    expect(before.branches).toEqual([{ name: 'main', color: 'green' }])
    expect(before.rows[0]?.health.stuck).toBe('no checks started')
    expect(before.counts).toEqual({ pulls: 1, queue: 1 })
    expect((await manager.view('queue')).counts).toEqual({ pulls: 1, queue: 1 })

    await store.writeSettings({ branches: [{ name: 'develop', color: 'blue' }] })
    expect((await manager.view('pulls')).branches).toEqual([{ name: 'develop', color: 'blue' }])
  })

  it('lists every PR of both lists', async () => {
    expect(await manager.all()).toEqual([])
    await store.writeSnapshot('pulls', { ...fetched([1]), fetchedAt: NOW })
    await store.writeSnapshot('queue', { ...fetched([2]), fetchedAt: NOW })
    expect((await manager.all()).map(p => p.number)).toEqual([1, 2])
  })

  it('answers main for the base branches, whatever the lists hold, until some are saved', async () => {
    expect(await manager.branches()).toEqual([{ name: 'main', color: 'green' }])
    await store.writeSnapshot('queue', { ...fetched([2]), fetchedAt: NOW })
    await store.writeSnapshot('pulls', { ...fetched([1]), fetchedAt: NOW })
    expect(await manager.branches()).toEqual([{ name: 'main', color: 'green' }])
    await store.writeSettings({ branches: [{ name: 'release', color: 'red' }] })
    expect(await manager.branches()).toEqual([{ name: 'release', color: 'red' }])
  })

  it('works without a listener for changes', async () => {
    const quiet = createListsManager({
      fetcher: { fetch: async () => fetched([1]), ...QUIET },
      store,
      canvasFacts: async () => ({ status: 'Pending', points: null }),
      now: () => clock,
      log: () => undefined,
    })
    await quiet.sync('pulls')
    expect((await quiet.view('pulls')).rows).toHaveLength(1)
    await quiet.syncOne('pulls', 1)
    expect((await quiet.view('pulls')).rows).toHaveLength(0)
  })

  describe('the project’s people', () => {
    const sync = async (kind: ListKind = 'pulls') => {
      const run = manager.sync(kind)
      fetches.at(-1)?.answer.resolve(fetched([1]))
      await run
    }

    it('reads them after a list, sorted and once each, and answers them with every view', async () => {
      await store.writeSnapshot('queue', { ...fetched([2]), fetchedAt: NOW })
      expect((await manager.view('queue')).people).toEqual([])
      people = async () => ['bob', 'ana', 'bob']
      await sync()
      // The list does not wait for them: they follow in the background.
      await peopleRead(['ana', 'bob'], NOW)
      expect(peopleReads).toBe(1)
      expect((await manager.view('queue')).people).toEqual(['ana', 'bob'])
    })

    it('reads them again only once the last read is older than an hour', async () => {
      await sync()
      await peopleRead([], NOW)
      clock = new Date(Date.parse(NOW) + PEOPLE_STALE_MS)
      await sync('queue')
      await settle()
      expect(peopleReads).toBe(1)
      expect(await store.readPeople()).toEqual({ fetchedAt: NOW, logins: [] })
      people = async () => ['cy']
      clock = new Date(Date.parse(NOW) + PEOPLE_STALE_MS + 1)
      await sync()
      await peopleRead(['cy'])
      expect(peopleReads).toBe(2)
    })

    it('keeps the last read when a read fails, and only logs it', async () => {
      await store.writePeople({ fetchedAt: '2026-01-01T00:00:00.000Z', logins: ['ana'] })
      people = async () => {
        throw new Error('gh: forbidden')
      }
      await sync()
      await vi.waitFor(() => expect(logs).toHaveLength(1))
      people = () => Promise.reject('plain failure')
      await sync()
      await vi.waitFor(() => expect(logs).toHaveLength(2))
      expect(logs).toEqual([
        "could not read the project's people: gh: forbidden",
        "could not read the project's people: plain failure",
      ])
      const view = await manager.view('pulls')
      expect(view.state.error).toBeNull()
      expect(view.people).toEqual(['ana'])
    })

    it('does not read them when the list’s read fails', async () => {
      const run = manager.sync('pulls')
      fetches[0]?.answer.reject(new Error('down'))
      await run
      await settle()
      expect(peopleReads).toBe(0)
    })

    it('logs a store that cannot be read, and the list stands', async () => {
      vi.spyOn(store, 'readPeople').mockRejectedValueOnce(new Error('disk gone'))
      await sync()
      await vi.waitFor(() => expect(logs).toEqual(["could not read the project's people: disk gone"]))
      expect(peopleReads).toBe(0)
      expect((await store.readSnapshot('pulls'))?.pulls.map(p => p.number)).toEqual([1])
    })
  })

  describe('syncOne', () => {
    const OLD = '2026-10-22T11:00:00.000Z'

    beforeEach(async () => {
      await store.writeSnapshot('queue', { ...fetched([1, 2, 3], { viewer: 'then' }), fetchedAt: OLD })
    })

    const numbers = async () => (await store.readSnapshot('queue'))?.pulls.map(p => p.number)

    it('puts the PR read again in its place, keeping when and by whom the list was read', async () => {
      one = { viewer: 'me', pull: makeListPull({ number: 2, title: 'Renamed' }) }
      await manager.syncOne('queue', 2)
      expect(onesAsked).toEqual([['queue', 2]])
      const snapshot = await store.readSnapshot('queue')
      expect(snapshot?.pulls.map(p => [p.number, p.title])).toEqual([
        [1, 'Change 1'],
        [2, 'Renamed'],
        [3, 'Change 3'],
      ])
      expect(snapshot).toMatchObject({ viewer: 'then', fetchedAt: OLD })
      expect(fetches).toHaveLength(0)
      expect(changed).toEqual(['queue'])
    })

    it('adds a PR the list did not have at its end', async () => {
      one = { viewer: 'me', pull: makeListPull({ number: 9 }) }
      await manager.syncOne('queue', 9)
      expect(await numbers()).toEqual([1, 2, 3, 9])
      expect(changed).toEqual(['queue'])
    })

    it('takes out a PR no longer open on that side', async () => {
      await manager.syncOne('queue', 2)
      expect(await numbers()).toEqual([1, 3])
      // One the list never had leaves it as it was.
      await manager.syncOne('queue', 7)
      expect(await numbers()).toEqual([1, 3])
      expect(changed).toEqual(['queue', 'queue'])
    })

    it('reads a list never read whole, without reading the PR alone', async () => {
      one = { viewer: 'me', pull: makeListPull({ number: 4 }) }
      const sync = manager.syncOne('pulls', 4)
      await settle()
      expect(onesAsked).toEqual([])
      expect(fetches.map(f => f.kind)).toEqual(['pulls'])
      fetches[0]?.answer.resolve(fetched([5, 6]))
      await sync
      expect((await store.readSnapshot('pulls'))?.pulls.map(p => p.number)).toEqual([5, 6])
      expect(changed).toEqual(['pulls'])
    })

    it('waits for a full read under way, and puts the PR in the list it wrote', async () => {
      const full = manager.sync('queue')
      one = { viewer: 'me', pull: makeListPull({ number: 2, title: 'Renamed' }) }
      const single = manager.syncOne('queue', 2)
      await settle()
      // Nothing is read alone while the whole list is being read.
      expect(onesAsked).toEqual([])
      clock = new Date(Date.parse(NOW) + 1000)
      fetches[0]?.answer.resolve(fetched([2, 5], { viewer: 'now' }))
      await Promise.all([full, single])
      expect(onesAsked).toEqual([['queue', 2]])
      const snapshot = await store.readSnapshot('queue')
      expect(snapshot?.pulls.map(p => [p.number, p.title])).toEqual([
        [2, 'Renamed'],
        [5, 'Change 5'],
      ])
      expect(snapshot).toMatchObject({ viewer: 'now', fetchedAt: clock.toISOString() })
      expect(changed).toEqual(['queue', 'queue'])
    })

    it('waits for a full read that starts while the PR is read, then puts the PR in its list', async () => {
      let full: Promise<void> | undefined
      duringOne = async () => {
        full = manager.sync('queue')
        fetches[0]?.answer.resolve(fetched([1, 2, 7], { viewer: 'now' }))
      }
      one = { viewer: 'me', pull: makeListPull({ number: 2, title: 'Renamed' }) }
      await manager.syncOne('queue', 2)
      await full
      const snapshot = await store.readSnapshot('queue')
      expect(snapshot?.pulls.map(p => [p.number, p.title])).toEqual([
        [1, 'Change 1'],
        [2, 'Renamed'],
        [7, 'Change 7'],
      ])
      expect(snapshot).toMatchObject({ viewer: 'now', fetchedAt: NOW })
    })

    it('reads the list whole when its snapshot is gone by the time the PR is in', async () => {
      duringOne = () => rm(path.join(dir, 'lists'), { recursive: true, force: true })
      one = { viewer: 'me', pull: makeListPull({ number: 2 }) }
      const sync = manager.syncOne('queue', 2)
      await vi.waitFor(() => expect(fetches.map(f => f.kind)).toEqual(['queue']))
      fetches[0]?.answer.resolve(fetched([8]))
      await sync
      expect(await numbers()).toEqual([8])
    })

    it('leaves the list as it was when the read fails', async () => {
      const failing = createListsManager({
        fetcher: {
          fetch: async () => fetched([]),
          fetchOne: async () => {
            throw new Error('gh: rate limited')
          },
          fetchPeople: QUIET.fetchPeople,
        },
        store,
        canvasFacts: async () => ({ status: 'Pending', points: null }),
        now: () => clock,
        log: () => undefined,
      })
      await expect(failing.syncOne('queue', 2)).rejects.toThrow('gh: rate limited')
      expect(await numbers()).toEqual([1, 2, 3])
    })
  })

  it('answers each row with its canvas status, asked once per PR', async () => {
    const asked: number[] = []
    const withStatus = createListsManager({
      fetcher: { fetch: async () => fetched([1, 2]), ...QUIET },
      store,
      canvasFacts: async pull => {
        asked.push(pull.number)
        return pull.number === 1
          ? { status: 'Ready', points: { author: 0, reviewer: 3 } }
          : { status: 'Stale', points: null }
      },
      now: () => clock,
      log: () => undefined,
    })
    await withStatus.sync('pulls')
    const rows = (await withStatus.view('pulls')).rows
    expect(rows.map(r => [r.canvas, r.points])).toEqual([
      ['Ready', { author: 0, reviewer: 3 }],
      ['Stale', undefined],
    ])
    expect(asked).toEqual([1, 2])
  })

  it('answers rows with where their canvas generation stands', async () => {
    const running: RowGeneration = { state: 'running', phase: 'generating', startedAt: NOW }
    const withGeneration = createListsManager({
      fetcher: { fetch: async () => fetched([1, 2]), ...QUIET },
      store,
      canvasFacts: async () => ({ status: 'Pending', points: null }),
      now: () => clock,
      log: () => undefined,
      generation: n => (n === 2 ? running : undefined),
    })
    await withGeneration.sync('queue')
    const rows = (await withGeneration.view('queue')).rows
    expect(rows[0]).not.toHaveProperty('generation')
    expect(rows[1]?.generation).toEqual(running)
  })
})
