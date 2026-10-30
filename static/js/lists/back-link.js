// @ts-check
// "← Back to Inbox": on the pages below the nav (a PR, its thread review, a chat) and on
// Settings, a link to the page this tab came from, when that was another page of the same repo.
// The server sends no referrer, so each tab keeps its own trail in sessionStorage: the pages it
// went through, each as a path and the first words of its title, nothing else. The trail follows
// the tab's history: a new page goes on top, going back (the browser's button or this link) takes
// the top off, and a reload keeps it. The link goes back through the browser's history when the
// entry before is the page it names, so the page comes back where it was scrolled to; otherwise it
// opens the page.

const KEY = 'pr-greenlight:trail'

/** How many pages the trail keeps. */
const DEPTH = 20

/**
 * A page in the trail; `history` when the tab's history entry before it is the page below it.
 * @typedef {{ path: string, name: string, history?: boolean }} Stop
 */

/**
 * This tab's sessionStorage, or nothing when the browser blocks it.
 * @param {Document} doc
 */
function storageOf(doc) {
  try {
    return doc.defaultView?.sessionStorage ?? null
  } catch {
    return null
  }
}

/**
 * A page's name from its title: "Inbox · acme/widgets · PR Greenlight" is "Inbox", without the unread
 * count the badge puts in front.
 * @param {string} title
 */
export function pageName(title) {
  return (title.replace(/^\(\d+\) /, '').split(' · ')[0] ?? '').trim()
}

/**
 * Where this page is, without the session token a first visit may carry.
 * @param {Location} location
 */
function pathOf(location) {
  const params = new URLSearchParams(location.search)
  params.delete('token')
  const search = params.toString()
  return `${location.pathname}${search === '' ? '' : `?${search}`}`
}

/**
 * This tab's trail, or an empty one when there is none to read.
 * @param {Storage | null} storage
 * @returns {Stop[]}
 */
function readTrail(storage) {
  try {
    const trail = JSON.parse(storage?.getItem(KEY) ?? '[]')
    return Array.isArray(trail) ? trail : []
  } catch {
    return []
  }
}

/**
 * @param {Storage | null} storage
 * @param {Stop[]} trail
 */
function writeTrail(storage, trail) {
  try {
    storage?.setItem(KEY, JSON.stringify(trail.slice(-DEPTH)))
  } catch {
    // Without storage, the next page offers no way back; the browser's own still works.
  }
}

/**
 * How the tab came to this page: through its history (back or forward) or by opening it.
 * @param {Window} view
 */
function cameBack(view) {
  const entry = /** @type {PerformanceNavigationTiming | undefined} */ (
    view.performance?.getEntriesByType?.('navigation')[0]
  )
  return entry?.type === 'back_forward'
}

/**
 * The page before this one in the tab, after recording this one. A reload keeps the one before.
 * @param {Document} doc
 * @param {boolean} [back] that the tab came here through its history
 * @returns {Stop | null} with `history` when going back through the browser's history leads there
 */
export function previousPage(doc, back) {
  const view = doc.defaultView
  if (view === null) return null
  const storage = storageOf(doc)
  const here = { path: pathOf(view.location), name: pageName(doc.title) }
  const trail = readTrail(storage)
  // The same page with another query (its filters in the address) is still this page.
  const at = trail.findLastIndex(stop => pathOnly(stop.path) === pathOnly(here.path))
  const top = trail.at(-1)
  if (top !== undefined && at === trail.length - 1) {
    // A reload, or the page this link went back to: it stays where it was.
    trail[at] = { ...top, ...here }
  } else if (at >= 0 && (back ?? cameBack(view))) {
    // Back through the history: the pages after this one come off.
    trail.splice(at + 1)
    trail[at] = { ...trail[at], ...here }
  } else {
    // Opened from the page on top, which the history goes back to.
    if (at >= 0) trail.splice(at, 1)
    trail.push({ ...here, history: trail.length > 0 && !(back ?? cameBack(view)) })
  }
  writeTrail(storage, trail)
  const below = trail.at(-2)
  return below === undefined ? null : { ...below, history: trail.at(-1)?.history === true }
}

/** @param {string} path */
const pathOnly = path => path.split('?')[0] ?? ''

/**
 * Keeps the trail on this page's address after its query changed, so a way back to it opens the
 * view it was left in.
 * @param {Document} doc
 */
export function notePath(doc) {
  const view = doc.defaultView
  const storage = storageOf(doc)
  if (view === null || storage === null) return
  const trail = readTrail(storage)
  const top = trail.at(-1)
  if (top === undefined || pathOnly(top.path) !== view.location.pathname) return
  trail[trail.length - 1] = { ...top, path: pathOf(view.location) }
  writeTrail(storage, trail)
}

/** @param {Document} doc */
export function wireBackLink(doc) {
  const main = doc.querySelector('main[data-owner]')
  const view = doc.defaultView
  if (!(main instanceof HTMLElement) || view === null) return
  const back = previousPage(doc)
  // A page the browser kept and shows again runs nothing, so its trail is caught up here.
  view.addEventListener('pageshow', event => {
    if (event.persisted) previousPage(doc, true)
  })
  const crumbs = main.querySelector('nav.breadcrumb')
  const settings = main.dataset['page'] === 'settings'
  if (back === null || (crumbs === null && !settings)) return
  const repoBase = `/r/${encodeURIComponent(main.dataset['owner'] ?? '')}/${encodeURIComponent(main.dataset['name'] ?? '')}/`
  const backPath = pathOnly(back.path)
  if (!backPath.startsWith(repoBase) || backPath === view.location.pathname || back.name === '') return
  // The breadcrumb already leads there.
  if ([...(crumbs?.querySelectorAll('a') ?? [])].some(a => a.getAttribute('href') === backPath)) return

  const link = /** @type {HTMLAnchorElement} */ (doc.createElement('a'))
  link.className = 'back-link small'
  link.href = back.path
  link.textContent = `← Back to ${back.name}`
  link.addEventListener('click', event => {
    if (back.history === true && view.history.length > 1) {
      event.preventDefault()
      view.history.back()
      return
    }
    // Opened afresh, the page takes this one's place on top, and the history behind it is this one.
    const storage = storageOf(doc)
    const trail = readTrail(storage).slice(0, -1)
    const below = trail.at(-1)
    if (below === undefined) return
    trail[trail.length - 1] = { ...below, history: false }
    writeTrail(storage, trail)
  })
  if (crumbs !== null) crumbs.before(link)
  else main.prepend(link)
}
