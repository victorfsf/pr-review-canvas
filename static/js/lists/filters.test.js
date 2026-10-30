// @ts-check
// @vitest-environment happy-dom
import {
  flushSavedFilters,
  fromQuery,
  loadColumns,
  loadFilters,
  loadPresets,
  resetSavedFilters,
  saveColumns,
  saveFilters,
  savePresets,
  toQuery,
  upgradeSaved,
} from './filters.js'

const DEFAULTS = { days: 90, chart: 'line' }
/** @type {{ [K in keyof typeof DEFAULTS]: (value: unknown) => boolean }} */
const ACCEPT = { days: v => typeof v === 'number', chart: v => v === 'line' || v === 'bars' }
const KEY = 'pr-greenlight:filters:v1:acme/widgets:stats'
const UNSENT = 'pr-greenlight:filters-unsent:/r/acme/widgets/api/lists-filters/stats'

/** @type {Map<string, string>} */
let store
/** @type {{ url: string, value: unknown }[]} */
let sent

beforeEach(() => {
  store = new Map()
  sent = []
  resetSavedFilters()
  document.body.innerHTML = ''
  vi.stubGlobal('localStorage', {
    getItem: (/** @type {string} */ k) => store.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => store.set(k, v),
    removeItem: (/** @type {string} */ k) => store.delete(k),
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
      sent.push({ url, value: JSON.parse(String(init.body)).value })
      return Response.json({ ok: true })
    })
  )
})

afterEach(() => {
  flushSavedFilters()
  vi.unstubAllGlobals()
})

/**
 * The page as the server sends it, with what the server keeps, at an address with `query`.
 * @param {unknown} saved
 */
const arrive = (saved, query = '') => {
  resetSavedFilters()
  history.replaceState(null, '', `/r/acme/widgets/stats${query}`)
  document.body.innerHTML = `<main data-base="/r/acme/widgets/"></main><script type="application/json" id="saved-filters">${JSON.stringify(saved)}</script>`
}

describe('saved filters', () => {
  it("start from what the server keeps, over this browser's copy", () => {
    store.set(KEY, JSON.stringify({ days: 30 }))
    arrive({ stats: { days: 180 } })
    expect(loadFilters(KEY, DEFAULTS, ACCEPT)).toEqual({ days: 180, chart: 'line' })
    arrive({})
    expect(loadFilters(KEY, DEFAULTS, ACCEPT)).toEqual({ days: 30, chart: 'line' })
  })

  it('send a burst of changes as one save, the last, a moment later', () => {
    arrive({})
    saveFilters(KEY, { days: 30, chart: 'line' }, DEFAULTS)
    saveFilters(KEY, { days: 30, chart: 'bars' }, DEFAULTS)
    expect(sent).toEqual([])
    flushSavedFilters()
    expect(sent).toEqual([
      { url: '/r/acme/widgets/api/lists-filters/stats', value: { days: 30, chart: 'bars' } },
    ])
  })

  it('keep a save the server has not confirmed, over what a reloaded page arrives with', async () => {
    arrive({ stats: { days: 30 } })
    saveFilters(KEY, { days: 180, chart: 'line' }, DEFAULTS)
    // The page reloads before the save went: it arrives with the old filters, and the newer one wins.
    arrive({ stats: { days: 30 } })
    expect(loadFilters(KEY, DEFAULTS, ACCEPT)).toEqual({ days: 180, chart: 'line' })
    flushSavedFilters()
    expect(sent.at(-1)?.value).toEqual({ days: 180, chart: 'line' })
    // Once the server has it, the note goes.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(store.has(UNSENT)).toBe(false)
  })

  it('open what a link carries, the rest at their defaults, without saving it', () => {
    arrive({ stats: { days: 180 } }, '?chart=bars&token=t')
    expect(loadFilters(KEY, DEFAULTS, ACCEPT)).toEqual({ days: 90, chart: 'bars' })
    flushSavedFilters()
    expect(sent).toEqual([])
    // A value the page does not take falls back to its default.
    arrive({}, '?days=many&chart=pie')
    expect(loadFilters(KEY, DEFAULTS, ACCEPT)).toEqual(DEFAULTS)
  })

  it('show the saved filters and each change in the address, and nothing at the defaults', () => {
    arrive({ stats: { days: 180 } }, '?token=t')
    loadFilters(KEY, DEFAULTS, ACCEPT)
    expect(location.search).toBe('?token=t&days=180')
    saveFilters(KEY, { days: 180, chart: 'bars' }, DEFAULTS)
    expect(location.search).toBe('?token=t&days=180&chart=bars')
    saveFilters(KEY, DEFAULTS, DEFAULTS)
    expect(location.search).toBe('?token=t')
  })

  it('keep the search in the address alone: never saved, never read back, and a link with only it keeps the saved ones', () => {
    const withSearch = { ...DEFAULTS, q: '' }
    const accept = { ...ACCEPT, q: (/** @type {unknown} */ v) => typeof v === 'string' }
    // A save from elsewhere holding a search does not bring it back.
    arrive({ stats: { days: 180, q: 'old' } }, '?token=t')
    expect(loadFilters(KEY, withSearch, accept)).toEqual({ days: 180, chart: 'line', q: '' })
    // A link with only the search keeps the saved filters around it.
    arrive({ stats: { days: 180 } }, '?q=cache+OR+docs')
    expect(loadFilters(KEY, withSearch, accept)).toEqual({ days: 180, chart: 'line', q: 'cache OR docs' })
    // With other filters it shows exactly those.
    arrive({ stats: { days: 180 } }, '?q=cache&chart=bars')
    expect(loadFilters(KEY, withSearch, accept)).toEqual({ days: 90, chart: 'bars', q: 'cache' })
    // A search alone is no save; with another filter, the save leaves it out.
    saveFilters(KEY, { ...withSearch, q: 'cache' }, withSearch)
    expect(store.get(KEY)).toBeUndefined()
    expect(location.search).toBe('?q=cache')
    saveFilters(KEY, { days: 30, chart: 'line', q: 'cache' }, withSearch)
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({ days: 30, chart: 'line', q: '' })
    flushSavedFilters()
    expect(sent.at(-1)).toEqual({
      url: '/r/acme/widgets/api/lists-filters/stats',
      value: { days: 30, chart: 'line', q: '' },
    })
  })
})

describe('an old save', () => {
  const defaults = { picked: null, on: false }
  const rename = (/** @type {Record<string, unknown>} */ old) => {
    const { old: was, ...rest } = old
    return was === undefined ? rest : { ...rest, picked: was }
  }

  it("goes through the page's upgrade, from before `v` or since", () => {
    // From before `v`: an empty list of choices was all of them.
    expect(upgradeSaved({ picked: [], on: true }, defaults, rename)).toEqual({ on: true })
    // A filter renamed after `v` came is read in a save of either age.
    expect(upgradeSaved({ old: ['a'] }, defaults, rename)).toEqual({ picked: ['a'] })
    expect(upgradeSaved({ old: ['a'], v: 2 }, defaults, rename)).toEqual({ picked: ['a'], v: 2 })
    // Since `v`, an empty list is none ticked.
    expect(upgradeSaved({ picked: [], v: 2 }, defaults, rename)).toEqual({ picked: [], v: 2 })
  })
})

describe('filters in a query', () => {
  const defaults = { on: false, off: true, people: /** @type {string[]} */ ([]), sort: 'ready', days: 90 }
  /** @type {{ [K in keyof typeof defaults]: (value: unknown) => boolean }} */
  const accept = {
    on: v => typeof v === 'boolean',
    off: v => typeof v === 'boolean',
    people: v => Array.isArray(v),
    sort: v => typeof v === 'string',
    days: v => typeof v === 'number',
  }

  it('write switches as 1 or 0 and lists one item per parameter, and read them back', () => {
    const filters = { on: true, off: false, people: ['alice', 'b,ob'], sort: 'author', days: 30 }
    const query = toQuery(filters, defaults)
    expect(query).toEqual({ on: '1', off: '0', people: ['alice', 'b,ob'], sort: 'author', days: '30' })
    const params = new URLSearchParams()
    for (const [name, value] of Object.entries(query)) {
      for (const v of [value ?? []].flat()) params.append(name, v)
    }
    expect(fromQuery(params, defaults, accept)).toEqual(filters)
  })

  it('read nothing from a query without them', () => {
    expect(fromQuery(new URLSearchParams('tab=all'), defaults, accept)).toBeNull()
    expect(toQuery(defaults, defaults)).toEqual({ on: null, off: null, people: null, sort: null, days: null })
  })
})

describe('hidden columns', () => {
  const REPO = { owner: 'acme', name: 'widgets' }
  const LOCAL = 'pr-greenlight:columns:v1:acme/widgets'
  const COLUMNS_UNSENT = 'pr-greenlight:filters-unsent:/r/acme/widgets/api/lists-filters/columns'

  it("come from what the server keeps, over this browser's copy, per table", () => {
    store.set(LOCAL, JSON.stringify({ pulls: ['review'] }))
    arrive({ columns: { pulls: ['labels'], queue: ['author', 7] } })
    expect(loadColumns(REPO, 'pulls')).toEqual(['labels'])
    // A table whose saved value is not a list of names hides nothing.
    expect(loadColumns(REPO, 'queue')).toEqual([])
    arrive({})
    expect(loadColumns(REPO, 'pulls')).toEqual(['review'])
    store.set(LOCAL, 'not json')
    expect(loadColumns(REPO, 'pulls')).toEqual([])
    store.set(LOCAL, '[1]')
    expect(loadColumns(REPO, 'queue')).toEqual([])
  })

  it('save per table, both kept, and forget the entry once none hides', () => {
    arrive({})
    saveColumns(REPO, 'pulls', ['review'])
    saveColumns(REPO, 'queue', ['labels'])
    expect(JSON.parse(store.get(LOCAL) ?? '')).toEqual({ pulls: ['review'], queue: ['labels'] })
    // Until the server confirms it, the save waits in storage and wins over the page's copy.
    expect(JSON.parse(store.get(COLUMNS_UNSENT) ?? '')).toEqual({
      value: { pulls: ['review'], queue: ['labels'] },
    })
    arrive({ columns: { pulls: [] } })
    expect(loadColumns(REPO, 'pulls')).toEqual(['review'])
    flushSavedFilters()
    expect(sent.at(-1)).toEqual({
      url: '/r/acme/widgets/api/lists-filters/columns',
      value: { pulls: ['review'], queue: ['labels'] },
    })
    saveColumns(REPO, 'pulls', [])
    saveColumns(REPO, 'queue', [])
    expect(store.has(LOCAL)).toBe(false)
    flushSavedFilters()
    expect(sent.at(-1)).toEqual({ url: '/r/acme/widgets/api/lists-filters/columns', value: null })
  })

  it('still save to the server when storage refuses', () => {
    arrive({})
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    })
    saveColumns(REPO, 'queue', ['labels'])
    saveColumns(REPO, 'queue', [])
    flushSavedFilters()
    expect(sent.at(-1)).toEqual({ url: '/r/acme/widgets/api/lists-filters/columns', value: null })
  })
})

describe('saved filters by name', () => {
  const REPO = { owner: 'acme', name: 'widgets' }

  it('keep each page its own, ignore a list holding anything but a name and filters, and go to the server', () => {
    arrive({
      presets: {
        queue: [{ name: 'Mine', filters: { state: 'both' } }],
        pulls: [{ name: 'Bad', filters: [] }],
      },
    })
    expect(loadPresets(REPO, 'queue')).toEqual([{ name: 'Mine', filters: { state: 'both' } }])
    expect(loadPresets(REPO, 'pulls')).toEqual([])
    savePresets(REPO, 'pulls', [{ name: 'Drafts', filters: { state: 'draft' } }])
    expect(loadPresets(REPO, 'pulls')).toEqual([{ name: 'Drafts', filters: { state: 'draft' } }])
    flushSavedFilters()
    expect(sent.at(-1)).toEqual({
      url: '/r/acme/widgets/api/lists-filters/presets',
      value: {
        queue: [{ name: 'Mine', filters: { state: 'both' } }],
        pulls: [{ name: 'Drafts', filters: { state: 'draft' } }],
      },
    })
    savePresets(REPO, 'pulls', [])
    savePresets(REPO, 'queue', [])
    flushSavedFilters()
    expect(sent.at(-1)).toEqual({ url: '/r/acme/widgets/api/lists-filters/presets', value: null })
  })
})

describe('sending saved filters', () => {
  it('sends nothing for a page that names no repo, and keeps it in this browser', () => {
    arrive({})
    const key = 'pr-greenlight:filters:v1::stats'
    saveFilters(key, { days: 30, chart: 'line' }, DEFAULTS)
    flushSavedFilters()
    expect(sent).toEqual([])
    expect(JSON.parse(store.get(key) ?? '{}')).toEqual({ days: 30, chart: 'line' })
  })

  it('sends what waits as the tab is hidden, and keeps the note of a save the server refused', async () => {
    arrive({})
    saveFilters(KEY, { days: 30, chart: 'line' }, DEFAULTS)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(sent).toEqual([])
    vi.mocked(fetch).mockImplementationOnce(async (url, init) => {
      sent.push({ url: String(url), value: JSON.parse(String(init?.body)).value })
      return Response.json({ error: { code: 'X', message: 'no' } }, { status: 500 })
    })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(sent).toEqual([
      { url: '/r/acme/widgets/api/lists-filters/stats', value: { days: 30, chart: 'line' } },
    ])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(store.has(UNSENT)).toBe(true)
    vi.restoreAllMocks()
  })
})
