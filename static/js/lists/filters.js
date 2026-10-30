// @ts-check
// Saved filters (US-51), per repo and page, and the saved author searches. The server keeps them
// in the repo's clone, so they outlive a refresh, a closed tab, another browser and a restart:
// each page arrives with them in a `saved-filters` script element, and every change goes back
// with one PUT. A copy also goes to localStorage, which an older save may still be in; storage can
// be missing or throw (a private window, blocked site data), and filters then work for the visit.
// The filters also live in the page's address, so a copied URL opens the same view: a link that
// carries any of them shows exactly those (the rest at their defaults) without touching the saved
// ones, until a filter is changed on the page.
// A filter of choices holds the ones ticked, or `null` for all of them: every filter starts with
// everything ticked, ticking the last one goes back to all, and none ticked keeps nothing.
import { projectBase } from './api.js'
import { queryParams, setQuery } from './url-state.js'

/** @typedef {{ name: string, logins: string[] }} AuthorSearch */

/**
 * @param {{ owner: string, name: string }} repo
 * @param {string} page
 */
export function filterKey(repo, page) {
  return `pr-greenlight:filters:v1:${repo.owner}/${repo.name}:${page}`
}

/** @returns {Storage | null} */
function storage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** The filters the page arrived with, by page, read once; null when it brought none. */
/** @type {Record<string, unknown> | null | undefined} */
let fromServer
/** @returns {Record<string, unknown> | null} */
function serverFilters() {
  if (fromServer !== undefined) return fromServer
  fromServer = null
  try {
    const text = globalThis.document?.getElementById('saved-filters')?.textContent
    const parsed = text === undefined || text === null ? null : JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) fromServer = parsed
  } catch {
    fromServer = null
  }
  return fromServer ?? null
}

/** Forgets what the page arrived with; tests load one page after another. */
export function resetSavedFilters() {
  fromServer = undefined
}

/** The repo and page a filter key names. @param {string} key */
function keyParts(key) {
  const [, , , slug = '', page = ''] = key.split(':')
  const [owner = '', name = ''] = slug.split('/')
  return { owner, name, page }
}

/**
 * Sends one page's filters to the server, or `null` to forget them. A failed send leaves the
 * filters working for this visit.
 * @param {{ owner: string, name: string, page: string }} where
 * @param {unknown} value
 */
function sendToServer(where, value) {
  const saved = serverFilters()
  if (saved !== null) {
    if (value === null) delete saved[where.page]
    else saved[where.page] = value
  }
  if (where.owner === '' || typeof globalThis.fetch !== 'function') return
  const path = savePath(where)
  pending.set(path, value)
  // Until the server says it has it, the save is noted here: a reload that beats it keeps it.
  try {
    storage()?.setItem(unsentKey(path), JSON.stringify({ value }))
  } catch {
    // Storage refused; the save still goes.
  }
  if (!listening) {
    listening = true
    // Leaving the page sends what is still waiting; keepalive lets it finish after the page goes.
    globalThis.addEventListener?.('pagehide', flushSavedFilters)
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (globalThis.document.visibilityState === 'hidden') flushSavedFilters()
    })
  }
  clearTimeout(timer)
  timer = setTimeout(flushSavedFilters, SAVE_DELAY_MS)
}

/** How long a change waits for the next before it is sent: a burst of clicks is one PUT. */
const SAVE_DELAY_MS = 1000
/** Saves waiting to go, by URL, each the page's latest. @type {Map<string, unknown>} */
const pending = new Map()
/** @type {ReturnType<typeof setTimeout> | undefined} */
let timer
let listening = false

/** Sends every save still waiting, now. */
export function flushSavedFilters() {
  clearTimeout(timer)
  timer = undefined
  for (const [path, value] of pending) {
    globalThis
      .fetch(path, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value }),
        keepalive: true,
      })
      .then(res => {
        if (res.ok) storage()?.removeItem(unsentKey(path))
        return res
      })
      .catch(() => undefined)
  }
  pending.clear()
}

/** @param {{ owner: string, name: string, page: string }} where */
const savePath = where => `${projectBase()}api/lists-filters/${where.page}`

/** @param {string} path */
const unsentKey = path => `pr-greenlight:filters-unsent:${path}`

/**
 * A save the server has not confirmed yet, newer than what the page arrived with; it goes again.
 * @param {{ owner: string, name: string, page: string }} where
 * @returns {{ value: unknown } | null}
 */
function unsent(where) {
  try {
    const raw = storage()?.getItem(unsentKey(savePath(where)))
    const parsed = raw === null || raw === undefined ? null : JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || !('value' in parsed)) return null
    sendToServer(where, parsed.value)
    return parsed
  } catch {
    return null
  }
}

/**
 * Saves made since a list of choices holds what is ticked carry this as `v`. Before, an empty list
 * kept everything, as `null` does now.
 */
const TICKED = 2

/**
 * Whether the defaults hold a filter of choices, which a save then marks with `v`.
 * @param {Record<string, unknown>} defaults
 */
const hasChoices = defaults => Object.values(defaults).some(v => v === null)

/**
 * A save from before `v` with each emptied list of choices back to all, then any save through
 * `upgrade`, which a page gives when it renamed a filter: a filter can be renamed after `v` came,
 * so `upgrade` reads the old names in a save of either age and leaves the rest alone.
 * @param {unknown} saved
 * @param {Record<string, unknown>} defaults
 * @param {(old: Record<string, unknown>) => Record<string, unknown>} [upgrade]
 * @returns {unknown}
 */
export function upgradeSaved(saved, defaults, upgrade = old => old) {
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return saved
  const record = /** @type {Record<string, unknown>} */ (saved)
  if (!hasChoices(defaults) || record['v'] === TICKED) return upgrade({ ...record })
  const out = { ...record }
  for (const name of Object.keys(defaults)) {
    const value = out[name]
    if (defaults[name] === null && Array.isArray(value) && value.length === 0) delete out[name]
  }
  return upgrade(out)
}

/**
 * The filters as a save keeps them: marked with `v` where the page has filters of choices.
 * @template {Record<string, unknown>} T
 * @param {T} filters
 * @param {T} defaults
 * @returns {Record<string, unknown>}
 */
export function toSaved(filters, defaults) {
  return hasChoices(defaults) ? { ...filters, v: TICKED } : filters
}

/**
 * A filter of choices after one is ticked or unticked: `null` once every one in `all` is ticked.
 * @param {readonly string[] | null} picked the ticked ones; `null` is all
 * @param {string} value
 * @param {boolean} on
 * @param {readonly string[]} all every choice the filter offers
 * @returns {string[] | null}
 */
export function tick(picked, value, on, all) {
  const now = picked ?? all
  const next = on ? [...now.filter(v => v !== value), value] : now.filter(v => v !== value)
  return all.every(v => next.includes(v)) ? null : next
}

/**
 * Whether a filter of choices keeps a value: all of them, or the ones ticked.
 * @param {readonly string[] | null} picked
 * @param {string} value
 */
export const ticked = (picked, value) => picked === null || picked.includes(value)

/**
 * Saved values over the defaults, each checked by `accept`: a value it refuses falls back to that
 * filter's default, and the others still apply. Anything but an object gives the defaults.
 * @template {Record<string, unknown>} T
 * @param {unknown} saved
 * @param {T} defaults
 * @param {{ [K in keyof T]: (value: unknown) => boolean }} accept
 * @returns {T}
 */
export function acceptFilters(saved, defaults, accept) {
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return { ...defaults }
  const out = { ...defaults }
  const record = /** @type {Record<string, unknown>} */ (saved)
  for (const name of /** @type {(keyof T & string)[]} */ (Object.keys(defaults))) {
    const value = record[name]
    // A filter of choices may always be all of them.
    if (name in record && ((defaults[name] === null && value === null) || accept[name](value)))
      out[name] = /** @type {T[typeof name]} */ (value)
  }
  return out
}

/**
 * The filters a page opens with: the ones its address carries, else the saved ones (the server's,
 * else this browser's). An entry that does not parse is ignored. The address then shows them.
 * @template {Record<string, unknown>} T
 * @param {string} key
 * @param {T} defaults
 * @param {{ [K in keyof T]: (value: unknown) => boolean }} accept
 * @param {(old: Record<string, unknown>) => Record<string, unknown>} [upgrade] see `upgradeSaved`
 * @returns {T}
 */
export function loadFilters(key, defaults, accept, upgrade) {
  const params = queryParams()
  const linked = fromQuery(params, defaults, accept, upgrade)
  const saved = savedFilters(key, defaults, accept, upgrade)
  // A link with only a search or a stack in it, such as Back to a page left mid-search or a PR's
  // stack on its page, keeps the saved filters around it.
  const passing = [...FLEETING, ...PAGE_ONLY]
  const onlyFleeting = Object.keys(defaults)
    .filter(name => params.has(name))
    .every(name => passing.includes(name))
  const shown =
    linked === null
      ? saved
      : onlyFleeting
        ? { ...saved, ...Object.fromEntries(passing.filter(n => n in linked).map(n => [n, linked[n]])) }
        : linked
  setQuery(toQuery(shown, defaults))
  return shown
}

/**
 * Filters that go in the address and in saved filters, but that a page never remembers on its
 * own: the search box's `q`. A page opened from the nav starts without them.
 */
export const FLEETING = ['q']

/**
 * Filters only the open page keeps: never saved, in a saved filter or in the address, so a reload
 * goes without them. A link may still carry one, which the page reads once and drops from the
 * address: the Stack filter, which a PR's place in its stack sets.
 */
export const PAGE_ONLY = ['stack']

/** The longest search kept, in the box, the address and a saved filter (search.js). */
export const MAX_SEARCH = 300

/** Whether a saved or linked search is one. @param {unknown} v */
export const acceptSearch = v => typeof v === 'string' && v.length <= MAX_SEARCH

/**
 * The filters as a page remembers them: the fleeting and page-only ones at their defaults.
 * @template {Record<string, unknown>} T
 * @param {T} filters
 * @param {T} defaults
 * @returns {T}
 */
const remembered = (filters, defaults) => {
  const out = { ...filters }
  for (const name of [...FLEETING, ...PAGE_ONLY])
    if (name in defaults) /** @type {Record<string, unknown>} */ (out)[name] = defaults[name]
  return out
}

/**
 * The saved filters for a page: the server's, else this browser's.
 * @template {Record<string, unknown>} T
 * @param {string} key
 * @param {T} defaults
 * @param {{ [K in keyof T]: (value: unknown) => boolean }} accept
 * @param {(old: Record<string, unknown>) => Record<string, unknown>} [upgrade]
 * @returns {T}
 */
function savedFilters(key, defaults, accept, upgrade) {
  const server = serverFilters()
  const where = keyParts(key)
  const waiting = unsent(where)
  /** @param {unknown} saved */
  const read = saved =>
    remembered(acceptFilters(upgradeSaved(saved, defaults, upgrade), defaults, accept), defaults)
  if (waiting !== null) return read(waiting.value)
  if (server !== null && where.page in server) return read(server[where.page])
  let saved
  try {
    saved = JSON.parse(storage()?.getItem(key) ?? 'null')
  } catch {
    return { ...defaults }
  }
  return read(saved)
}

/**
 * The filters a link carries, read by the type of each default: `1` or `0` for a switch, one
 * parameter per item for a list. A filter of choices with none ticked is one empty parameter.
 * Null when it carries none of them. They go through `upgrade` as a save does, so an older link
 * still reads.
 * @template {Record<string, unknown>} T
 * @param {URLSearchParams} params
 * @param {T} defaults
 * @param {{ [K in keyof T]: (value: unknown) => boolean }} accept
 * @param {(old: Record<string, unknown>) => Record<string, unknown>} [upgrade] see `upgradeSaved`
 * @returns {T | null}
 */
export function fromQuery(params, defaults, accept, upgrade = old => old) {
  const names = Object.keys(defaults).filter(name => params.has(name))
  if (names.length === 0) return null
  /** @type {Record<string, unknown>} */
  const read = {}
  for (const name of names) {
    const fallback = defaults[name]
    const text = params.get(name) ?? ''
    if (Array.isArray(fallback) || fallback === null) read[name] = params.getAll(name).filter(v => v !== '')
    else if (typeof fallback === 'boolean') read[name] = text === '1' ? true : text === '0' ? false : text
    else if (typeof fallback === 'number')
      read[name] = Number.isFinite(Number(text)) && text !== '' ? Number(text) : text
    else read[name] = text
  }
  return acceptFilters(upgrade(read), defaults, accept)
}

/**
 * The query parameters for the filters: the ones off their defaults, and a removal for the rest.
 * @template {Record<string, unknown>} T
 * @param {T} filters
 * @param {T} defaults
 * @returns {Record<string, string | string[] | null>}
 */
export function toQuery(filters, defaults) {
  /** @type {Record<string, string | string[] | null>} */
  const out = {}
  for (const name of Object.keys(defaults)) {
    const value = filters[name]
    if (same(value, defaults[name]) || PAGE_ONLY.includes(name)) out[name] = null
    // A filter of choices with none ticked still shows, as one empty parameter.
    else if (Array.isArray(value) && value.length === 0 && defaults[name] === null) out[name] = ''
    else if (Array.isArray(value)) out[name] = value.map(String)
    else if (typeof value === 'boolean') out[name] = value ? '1' : '0'
    else out[name] = String(value)
  }
  return out
}

/**
 * Saves the filters, or forgets them when they are all at their defaults.
 * @template {Record<string, unknown>} T
 * @param {string} key
 * @param {T} filters
 * @param {T} defaults
 */
export function saveFilters(key, filters, defaults) {
  // The search goes in the address alone (see `FLEETING`).
  const kept = remembered(filters, defaults)
  const atDefaults = isDefault(kept, defaults)
  try {
    if (atDefaults) storage()?.removeItem(key)
    else storage()?.setItem(key, JSON.stringify(toSaved(kept, defaults)))
  } catch {
    // Storage refused the write; the server still keeps them.
  }
  sendToServer(keyParts(key), atDefaults ? null : toSaved(kept, defaults))
  setQuery(toQuery(filters, defaults))
}

/** @param {{ owner: string, name: string }} repo */
function searchesKey(repo) {
  return `pr-greenlight:author-searches:v1:${repo.owner}/${repo.name}`
}

/** @param {unknown} saved @returns {AuthorSearch[]} */
function searchesOf(saved) {
  if (!Array.isArray(saved)) return []
  return saved.filter(
    s =>
      s !== null &&
      typeof s === 'object' &&
      typeof s.name === 'string' &&
      Array.isArray(s.logins) &&
      s.logins.every((/** @type {unknown} */ l) => typeof l === 'string')
  )
}

/**
 * The repo's saved author searches, which the Inbox and the Review queue share: the server's, else
 * this browser's, or none when what is there is something else.
 * @param {{ owner: string, name: string }} repo
 * @returns {AuthorSearch[]}
 */
export function loadSearches(repo) {
  const server = serverFilters()
  const waiting = unsent({ owner: repo.owner, name: repo.name, page: 'searches' })
  if (waiting !== null) return searchesOf(waiting.value)
  if (server !== null && 'searches' in server) return searchesOf(server['searches'])
  try {
    return searchesOf(JSON.parse(storage()?.getItem(searchesKey(repo)) ?? '[]'))
  } catch {
    return []
  }
}

/**
 * @param {{ owner: string, name: string }} repo
 * @param {readonly AuthorSearch[]} searches
 */
export function saveSearches(repo, searches) {
  try {
    storage()?.setItem(searchesKey(repo), JSON.stringify(searches))
  } catch {
    // Storage refused the write; the server still keeps them.
  }
  sendToServer(
    { owner: repo.owner, name: repo.name, page: 'searches' },
    searches.length === 0 ? null : searches
  )
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} filters
 * @param {T} defaults
 */
export function isDefault(filters, defaults) {
  return Object.keys(defaults).every(name => same(filters[name], defaults[name]))
}

/** Equal values; lists, such as picked authors or labels, by their items. */
const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b

/**
 * What is kept per table, by page, beside the filters: the columns the Columns picker hides, the
 * tables and sections folded shut, and the saved filters.
 * @typedef {'columns' | 'folds' | 'presets'} TableSlot
 */

/** @param {{ owner: string, name: string }} repo @param {TableSlot} slot */
function slotKey(repo, slot) {
  return `pr-greenlight:${slot}:v1:${repo.owner}/${repo.name}`
}

/**
 * Each table's list, by page, from what was saved, when `accept` takes every item; anything else
 * is an empty list.
 * @template T
 * @param {unknown} saved
 * @param {(item: unknown) => item is T} accept
 * @returns {Record<string, T[]>}
 */
function listsOf(saved, accept) {
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return {}
  return Object.fromEntries(Object.entries(saved).filter(([, v]) => Array.isArray(v) && v.every(accept)))
}

/** @param {unknown} v @returns {v is string} */
const isString = v => typeof v === 'string'

/**
 * @template T
 * @param {{ owner: string, name: string }} repo
 * @param {TableSlot} slot
 * @param {(item: unknown) => item is T} accept
 */
function savedLists(repo, slot, accept) {
  const server = serverFilters()
  const waiting = unsent({ owner: repo.owner, name: repo.name, page: slot })
  if (waiting !== null) return listsOf(waiting.value, accept)
  if (server !== null && slot in server) return listsOf(server[slot], accept)
  try {
    return listsOf(JSON.parse(storage()?.getItem(slotKey(repo, slot)) ?? 'null'), accept)
  } catch {
    return {}
  }
}

/**
 * @template T
 * @param {{ owner: string, name: string }} repo
 * @param {TableSlot} slot
 * @param {'pulls' | 'queue' | 'inbox' | 'pull' | 'settings'} page
 * @param {readonly T[]} list
 * @param {(item: unknown) => item is T} accept
 */
function saveList(repo, slot, page, list, accept) {
  const all = { ...savedLists(repo, slot, accept), [page]: [...list] }
  if (list.length === 0) delete all[page]
  const empty = Object.keys(all).length === 0
  try {
    if (empty) storage()?.removeItem(slotKey(repo, slot))
    else storage()?.setItem(slotKey(repo, slot), JSON.stringify(all))
  } catch {
    // Storage refused the write; the server still keeps them.
  }
  sendToServer({ owner: repo.owner, name: repo.name, page: slot }, empty ? null : all)
}

/**
 * The columns a table hides, as the Columns picker saved them for the repo: the server's, else
 * this browser's. They are not filters, so they stay out of the address and never show Reset.
 * @param {{ owner: string, name: string }} repo
 * @param {'pulls' | 'queue' | 'inbox'} page
 * @returns {string[]}
 */
export function loadColumns(repo, page) {
  return savedLists(repo, 'columns', isString)[page] ?? []
}

/**
 * @param {{ owner: string, name: string }} repo
 * @param {'pulls' | 'queue' | 'inbox'} page
 * @param {readonly string[]} hidden
 */
export function saveColumns(repo, page, hidden) {
  saveList(repo, 'columns', page, hidden, isString)
}

/**
 * The tables and sections folded shut on a page, as folds.js names them, kept like the columns;
 * on a PR's page (`pull`), whether All activity is.
 * @param {{ owner: string, name: string }} repo
 * @param {'pulls' | 'queue' | 'inbox' | 'pull' | 'settings'} page
 * @returns {string[]}
 */
export function loadFolds(repo, page) {
  return savedLists(repo, 'folds', isString)[page] ?? []
}

/**
 * @param {{ owner: string, name: string }} repo
 * @param {'pulls' | 'queue' | 'inbox' | 'pull' | 'settings'} page
 * @param {readonly string[]} folded
 */
export function saveFolds(repo, page, folded) {
  saveList(repo, 'folds', page, folded, isString)
}

/** A page's filters saved under a name, to put back with one click. @typedef {{ name: string, filters: Record<string, unknown> }} Preset */

/** @param {unknown} v @returns {v is Preset} */
const isPreset = v =>
  v !== null &&
  typeof v === 'object' &&
  typeof (/** @type {Preset} */ (v).name) === 'string' &&
  /** @type {Preset} */ (v).filters !== null &&
  typeof (/** @type {Preset} */ (v).filters) === 'object' &&
  !Array.isArray(/** @type {Preset} */ (v).filters)

/**
 * The filters saved by name on a page, kept like the columns: each page its own, since their
 * filters differ. Each preset's values are checked when it is applied.
 * @param {{ owner: string, name: string }} repo
 * @param {'pulls' | 'queue' | 'inbox'} page
 * @returns {Preset[]}
 */
export function loadPresets(repo, page) {
  return savedLists(repo, 'presets', isPreset)[page] ?? []
}

/**
 * @param {{ owner: string, name: string }} repo
 * @param {'pulls' | 'queue' | 'inbox'} page
 * @param {readonly Preset[]} presets
 */
export function savePresets(repo, page, presets) {
  saveList(repo, 'presets', page, presets, isPreset)
}
