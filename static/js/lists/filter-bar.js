// @ts-check
// The filter bar's two parts of its own on Your PRs, the Review queue and the Inbox: Filters, a button that
// shows or hides the row of filters under the search and the saved filters, saying how many are on
// while they are hidden; and State, a box each for Open, Draft and Queued that names what is
// ticked, all of them being All, which the Inbox has too. Whether Filters is open is this
// browser's convenience, per page.
import { wireFilterPanel } from './dom.js'
import { ALL_STATES, inOrder, stateLabel } from './pulls.js'
import { TEXTS } from './texts.js'

/** @typedef {import('./pulls.js').StateFilter} StateFilter */
/** @typedef {import('./pulls.js').PrState} PrState */

/** @param {'pulls' | 'queue' | 'inbox'} page */
const openKey = page => `pr-greenlight:filters-open:v1:${page}`

/**
 * Wires State's popup: each box ticks or unticks its state, and All ticks every one. The only box
 * ticked cannot be unticked, since none would show nothing. On a PR page, "Only PRs that" holds
 * Need a restack or an update, checked through `needs` and `setNeeds`. `render` sets the boxes and
 * names what is ticked, the flag after the states.
 * @param {Document} doc
 * @param {{ picked: () => StateFilter, pick: (state: StateFilter) => void,
 *   needs?: () => boolean, setNeeds?: (on: boolean) => void }} opts
 * @returns {{ render: () => void }}
 */
export function wireStateFilter(doc, opts) {
  const button = doc.getElementById('state-button')
  const panel = doc.getElementById('state-panel')
  const label = doc.getElementById('state-label')
  if (button === null || panel === null) return { render: () => {} }
  const boxes = /** @type {[HTMLInputElement, PrState][]} */ (
    [...panel.querySelectorAll('input[data-state]')].map(box => [box, box.getAttribute('data-state')])
  )
  wireFilterPanel(doc, button, panel)
  for (const [box] of boxes) {
    box.addEventListener('change', () => {
      const next = inOrder(boxes.filter(([b]) => b.checked).map(([, name]) => name))
      if (next.length === 0) box.checked = true
      else opts.pick(next)
    })
  }
  doc.getElementById('state-all')?.addEventListener('click', () => opts.pick(ALL_STATES))
  const needs = /** @type {HTMLInputElement | null} */ (
    panel.querySelector('input[data-state-flag="needsUpdate"]')
  )
  needs?.addEventListener('change', () => opts.setNeeds?.(needs.checked))
  return {
    render() {
      const state = opts.picked()
      const only = state.length === 1 ? state[0] : null
      for (const [box, name] of boxes) {
        box.checked = state.includes(name)
        // The only box ticked stays ticked; its row's title says why.
        box.disabled = only === name
        const row = box.closest('label')
        if (row !== null) row.title = only === name ? TEXTS.lists.filterBar.stateKept : ''
      }
      const flagged = opts.needs?.() === true
      if (needs !== null) needs.checked = flagged
      if (label !== null)
        label.textContent = flagged ? `${stateLabel(state)} · Needs update` : stateLabel(state)
    },
  }
}

/**
 * Marks each filter's button whose filters are off their defaults, so its value (the words after
 * its name) shows in the palette's primary color, bolder. `groups` names, per button id, the filters it sets.
 * @param {Document} doc
 * @param {Readonly<Record<string, readonly string[]>>} groups
 * @param {Readonly<Record<string, unknown>>} filters
 * @param {Readonly<Record<string, unknown>>} defaults
 */
export function markChanged(doc, groups, filters, defaults) {
  for (const [id, names] of Object.entries(groups)) {
    const changed = names.some(name => JSON.stringify(filters[name]) !== JSON.stringify(defaults[name]))
    doc.getElementById(id)?.toggleAttribute('data-changed', changed)
  }
}

/** Your PRs' filter buttons and the filters each sets. */
export const PULLS_GROUPS = {
  'state-button': ['state', 'needsUpdate'],
  'review-filter-button': ['reviews', 'pending'],
  'bases-button': ['bases'],
  'integrations-button': ['codeRabbit', 'vercel', 'github', 'canvas'],
  'reviewers-authors-button': ['reviewers'],
  'stack-button': ['stack'],
}

/** The Review queue's filter buttons and the filters each sets. */
export const QUEUE_GROUPS = {
  'state-button': ['state', 'needsUpdate'],
  'authors-button': ['authors'],
  'labels-button': ['labels'],
  'review-filter-button': ['reviews', 'pending', 'waiting'],
  'bases-button': ['bases'],
  'integrations-button': ['codeRabbit', 'vercel', 'github', 'canvas'],
  'stack-button': ['stack'],
}

/** The Inbox's filter buttons and the filters each sets; Notifying only shows itself pressed. */
export const INBOX_GROUPS = {
  'state-button': ['state'],
  'source-filter-button': ['sources'],
  'type-filter-button': ['types', 'dismissed', 'chatter'],
  'authors-button': ['authors'],
}

/**
 * Wires Filters: its button shows or hides the row of filters, open as this browser left it on
 * the page. `render` puts how many filters are on in its badge.
 * @param {Document} doc
 * @param {'pulls' | 'queue' | 'inbox'} page
 * @returns {{ render: (on: number) => void }}
 */
export function wireMoreFilters(doc, page) {
  const toggle = doc.getElementById('filters-toggle')
  const row = doc.getElementById('more-filters')
  const count = doc.getElementById('filters-count')
  if (toggle === null || row === null || count === null) return { render: () => {} }
  const show = (/** @type {boolean} */ open) => {
    row.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
  }
  let stored = null
  try {
    stored = doc.defaultView?.localStorage.getItem(openKey(page)) ?? null
  } catch {
    stored = null
  }
  show(stored === '1')
  toggle.addEventListener('click', () => {
    const open = row.hidden
    show(open)
    try {
      doc.defaultView?.localStorage.setItem(openKey(page), open ? '1' : '0')
    } catch {
      // Storage refused it: Filters opens closed next time.
    }
  })
  return {
    render(on) {
      count.hidden = on === 0
      count.textContent = on === 0 ? '' : String(on)
      toggle.title = on === 0 ? TEXTS.lists.filterBar.showFilters : TEXTS.lists.filterBar.filtersOn(on)
    },
  }
}

/**
 * How many of a page's filters are off their defaults, as Filters counts them: the sort and the
 * search are not filters here, and Builder in use counts as one.
 * @param {Record<string, unknown>} filters
 * @param {Record<string, unknown>} defaults
 */
export function filtersOn(filters, defaults) {
  if (filters['builder'] === true) return 1
  const skip = ['sort', 'q', 'builder', 'where']
  return Object.keys(defaults).filter(
    name => !skip.includes(name) && JSON.stringify(filters[name]) !== JSON.stringify(defaults[name])
  ).length
}
