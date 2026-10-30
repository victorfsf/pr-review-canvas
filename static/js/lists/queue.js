// @ts-check
import { healthRank } from './health.js'
import { acceptSearch, ticked } from './filters.js'
import { matchesIntegrations, sectionValues } from './integrations.js'
// pulls.js imports this file too, so its names are only read once the pages run.
import { keepsReviews, openTotal, reviewChoices } from './pulls.js'
import {
  acceptStates,
  emptyBy,
  OPEN_STATES,
  readyCompare,
  sameStates,
  stateOf,
  upgradeState,
} from './states.js'
import { sortAccept, sortBy } from './sorting.js'
import { acceptWhere } from './filter-builder.js'
import { TEXTS } from './texts.js'
// What the Review queue shows, apart from the DOM: its filters and sorts, and the two status
// columns' colors. The PR page's side panel uses the same colors.

/**
 * @typedef {{
 *   number: number, title: string, url: string, author: string, authorBot?: boolean, readyAt: string, isDraft: boolean,
 *   queuedAt?: string | null,
 *   headRefName: string, baseRefName: string, labels: string[], additions: number, deletions: number,
 *   requested: boolean, reviewers: import('./reviewers.js').Reviewer[],
 *   canvas: 'Ready' | 'Stale' | 'Pending', codeRabbit: 'Ready' | 'Outdated' | 'Pending' | 'Skipped',
 *   stack?: { name: string, position: number, total: number, base?: string }, restack?: boolean,
 *   update?: { conflict: boolean }, health?: import('./health.js').Health,
 *   pending?: number, waiting?: number, points?: import('./canvas-cell.js').OpenPoints, generation?: import('./canvas-cell.js').RowGeneration
 * }} QueueRow
 */

/** Each status's color. */
export const STATUS_TONE = /** @type {const} */ ({
  Ready: 'ok',
  Stale: 'warn',
  Outdated: 'warn',
  Pending: 'muted',
  Skipped: 'done',
})

/** The order a status column sorts in: the ones to review first come first. */
export const STATUS_ORDER = ['Ready', 'Stale', 'Outdated', 'Pending', 'Skipped']

export const CANVAS_STATUSES = /** @type {const} */ (['Ready', 'Stale', 'Pending'])
export const CODERABBIT_STATUSES = /** @type {const} */ (['Ready', 'Outdated', 'Pending', 'Skipped'])

/** The columns a section sorts by, and how each compares two rows. */
export const SORTS = /** @type {const} */ ([
  'pr',
  'status',
  'pending',
  'points',
  'author',
  'ready',
  'labels',
  'canvas',
  'codeRabbit',
])
/** @typedef {(typeof SORTS)[number]} SortKey */

/** A list of choices, ticked ones only; `null` ticks all of them. */
const ALL = /** @type {string[] | null} */ (null)

/** The Labels filter's choice for a PR without labels. */
export const NO_LABEL = ':none'

export const QUEUE_DEFAULTS = {
  /** The states shown, as on Your PRs; drafts wait for nobody yet, so Open and Queued start. */
  state: OPEN_STATES,
  /** State's "Only PRs that": checked, only the PRs that need a restack or an update stay. */
  needsUpdate: false,
  /** The authors whose PRs show. */
  authors: ALL,
  /** The labels whose PRs show, and `NO_LABEL` for PRs without one. */
  labels: ALL,
  /** The Reviews filter's choices, review states and whether a PR awaits you, then its flags. */
  reviews: ALL,
  pending: false,
  waiting: false,
  authorPoints: false,
  reviewerPoints: false,
  /** The base branches whose PRs stay (see bases.js). */
  bases: ALL,
  /** The one stack whose PRs stay (see stack-pick.js); '' keeps every PR. */
  stack: '',
  /** The Integrations filter's sections (see integrations.js). */
  codeRabbit: ALL,
  vercel: ALL,
  github: ALL,
  canvas: ALL,
  /** The columns the rows sort by, first deciding first (see sorting.js); none keeps the queue's order. */
  sort: /** @type {string[]} */ ([]),
  /** Whether the filter builder's blocks filter the page, in place of the bar (filter-builder.js). */
  builder: false,
  /** The filter builder's blocks, as JSON text; '' for none. */
  where: '',
  /** The search box's words (search.js); in the address and saved filters, never remembered. */
  q: '',
}

const isBool = (/** @type {unknown} */ v) => typeof v === 'boolean'
const isStrings = (/** @type {unknown} */ v) => Array.isArray(v) && v.every(x => typeof x === 'string')
/** @param {readonly string[]} allowed */
const within = allowed => (/** @type {unknown} */ v) =>
  isStrings(v) && /** @type {string[]} */ (v).every(x => allowed.includes(x))

/** @type {{ [K in keyof typeof QUEUE_DEFAULTS]: (value: unknown) => boolean }} */
export const QUEUE_ACCEPT = {
  state: acceptStates,
  needsUpdate: isBool,
  authors: isStrings,
  labels: isStrings,
  reviews: v => within(reviewChoices(true).map(([key]) => key))(v),
  pending: isBool,
  waiting: isBool,
  authorPoints: isBool,
  reviewerPoints: isBool,
  bases: isStrings,
  stack: v => typeof v === 'string',
  codeRabbit: within(CODERABBIT_STATUSES),
  vercel: within(sectionValues('vercel')),
  github: within(sectionValues('github')),
  canvas: within(CANVAS_STATUSES),
  sort: sortAccept(SORTS),
  builder: isBool,
  where: acceptWhere,
  q: acceptSearch,
}

/**
 * The Review queue's filters as saved when "Awaiting your review" was one of the Status (later
 * GitHub) choices, all of which a PR had to have: it moves to Reviews, alone there.
 * @param {Record<string, unknown>} old
 */
export function upgradeQueue(old) {
  const stated = 'state' in old ? { ...old, state: upgradeState(old['state']) } : old
  const github = stated['github']
  if (!Array.isArray(github) || !github.includes('requested')) return stated
  const rest = github.filter(v => v !== 'requested')
  return { ...stated, github: rest.length === 0 ? null : rest, reviews: ['requested'] }
}

/**
 * Whether the filters differ from their defaults; the sort is not a filter, so it never shows Reset.
 * @param {typeof QUEUE_DEFAULTS} f
 */
export function isFiltered(f) {
  return (
    !sameStates(f.state, OPEN_STATES) ||
    f.authors !== null ||
    f.labels !== null ||
    f.reviews !== null ||
    f.pending ||
    f.waiting ||
    f.authorPoints ||
    f.reviewerPoints ||
    f.needsUpdate ||
    f.bases !== null ||
    f.stack !== '' ||
    f.codeRabbit !== null ||
    f.vercel !== null ||
    f.github !== null ||
    f.canvas !== null
  )
}

/**
 * The rows the filters keep. Each filter keeps the rows with a ticked choice. With CodeRabbit or
 * Vercel off in the repo, its section of the Integrations filter is ignored.
 * @param {readonly QueueRow[]} rows
 * @param {typeof QUEUE_DEFAULTS} f
 * @param {boolean} codeRabbit whether the repo uses CodeRabbit
 * @param {boolean} [vercel] whether the repo shows its Vercel previews
 * @param {boolean} [canvas] whether the repo uses PR Review Canvas
 */
export function filterQueue(rows, f, codeRabbit, vercel = true, canvas = true) {
  const labels = f.labels === null ? null : new Set(f.labels.map(l => l.toLowerCase()))
  return rows.filter(
    r =>
      f.state.includes(stateOf(r)) &&
      ticked(f.authors, r.author) &&
      (labels === null ||
        (r.labels.length === 0 ? labels.has(NO_LABEL) : r.labels.some(l => labels.has(l.toLowerCase())))) &&
      keepsReviews(r, f, {
        pending: r.pending ?? 0,
        waiting: r.waiting ?? 0,
        points: r.points,
        queue: true,
      }) &&
      (!f.needsUpdate || r.restack === true || r.update !== undefined) &&
      matchesIntegrations(r, f, { codeRabbit, vercel, canvas })
  )
}

const text = (/** @type {string} */ a, /** @type {string} */ b) =>
  a.localeCompare(b, 'en', { sensitivity: 'base' })

/** @type {Record<SortKey, (a: QueueRow, b: QueueRow) => number>} */
const COMPARE = {
  pr: (a, b) => a.number - b.number,
  status: (a, b) => healthRank(a.health) - healthRank(b.health),
  // A row whose activity no fetch has read yet sorts before one with nothing pending.
  pending: (a, b) => (a.pending ?? -1) - (b.pending ?? -1),
  // A row whose canvas is not here sorts before one with no open point.
  points: (a, b) => openTotal(a.points) - openTotal(b.points),
  author: (a, b) => text(a.author, b.author),
  // Ascending is oldest ready first: the longest wait at the top.
  ready: readyCompare,
  labels: (a, b) => text(a.labels.join(', '), b.labels.join(', ')),
  canvas: (a, b) => STATUS_ORDER.indexOf(a.canvas) - STATUS_ORDER.indexOf(b.canvas),
  codeRabbit: (a, b) => STATUS_ORDER.indexOf(a.codeRabbit) - STATUS_ORDER.indexOf(b.codeRabbit),
}

/**
 * Rows in the sort's order (see sorting.js); ties, and no sort at all, keep the queue's order.
 * @param {readonly QueueRow[]} rows
 * @param {readonly string[]} sort the columns, first deciding first; empty keeps their order
 */
export function sortQueue(rows, sort) {
  return sortBy(rows, sort, COMPARE)
}

/**
 * The Review queue's authors for its picker, under People, then Bots, each as `authorCounts`
 * orders them. A queue stored before authors were told apart knows a bot by its `[bot]` suffix.
 * @param {readonly { author: string, authorBot?: boolean }[]} rows
 * @param {readonly string[]} [people] the project's people, offered too with no PR here
 */
export function queueAuthors(rows, people = []) {
  const bots = new Set(
    rows.filter(r => r.authorBot === true || r.author.endsWith('[bot]')).map(r => r.author)
  )
  const counts = authorCounts(rows)
  // The project's other people, with no PR here, follow those with some.
  const others = people
    .filter(login => !counts.some(p => p.login === login))
    .map(login => ({ login, count: 0 }))
  return [
    ...[...counts.filter(p => !bots.has(p.login)), ...others].map(p => ({ ...p, group: 'People' })),
    ...counts.filter(p => bots.has(p.login)).map(p => ({ ...p, group: 'Bots' })),
  ]
}

/**
 * Everyone with a PR in the queue (or an event in the Inbox), with how many each has, most first
 * then by name.
 * @param {readonly { author: string }[]} rows
 */
export function authorCounts(rows) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const r of rows) counts.set(r.author, (counts.get(r.author) ?? 0) + 1)
  return [...counts]
    .map(([login, count]) => ({ login, count }))
    .sort((a, b) => b.count - a.count || text(a.login, b.login))
}

/**
 * Every label on the queue's PRs, with how many carry each, most first then by name. Case is kept
 * as GitHub has it; labels differing only in case count together under the first spelling seen.
 * @param {readonly { labels: readonly string[] }[]} rows
 */
export function labelCounts(rows) {
  /** @type {Map<string, { name: string, count: number }>} */
  const counts = new Map()
  for (const r of rows) {
    /** @type {Set<string>} */
    const seen = new Set()
    for (const name of r.labels) {
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const found = counts.get(key)
      if (found === undefined) counts.set(key, { name, count: 1 })
      else found.count++
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || text(a.name, b.name))
}

/**
 * The Labels filter's choices: "No labels" with the PRs that have none, then every label as
 * `labelCounts` has it, then any ticked label no PR carries now, so it can be unticked.
 * @param {readonly { labels: readonly string[] }[]} rows
 * @param {readonly string[] | null} picked
 */
export function labelChoices(rows, picked) {
  const counts = labelCounts(rows)
  const known = new Set(counts.map(l => l.name.toLowerCase()))
  return [
    { value: NO_LABEL, text: 'No labels', count: rows.filter(r => r.labels.length === 0).length },
    ...counts.map(l => ({ value: l.name, text: l.name, count: l.count })),
    ...(picked ?? [])
      .filter(v => v !== NO_LABEL && !known.has(v.toLowerCase()))
      .map(v => ({ value: v, text: v, count: 0 })),
  ]
}

/**
 * What the empty queue says: the other filters keep nothing, or nobody has a PR in this state.
 * @param {typeof QUEUE_DEFAULTS} f
 * @param {string} slug
 */
export function queueEmptyText(f, slug) {
  if (isFiltered({ ...f, state: OPEN_STATES })) return TEXTS.lists.empty.noPrs
  return emptyBy(f.state, {
    open: TEXTS.lists.empty.queueOpen(slug),
    draft: TEXTS.lists.empty.queueDraft(slug),
    queued: TEXTS.lists.empty.queueQueued(slug),
    all: TEXTS.lists.empty.queueNone(slug),
  })
}

/**
 * What a picker button says: "All", "None", the one ticked, or how many of `total`.
 * @param {readonly string[] | null} chosen the ticked ones, as the button names them; `null` is all
 * @param {number} [total] how many choices there are
 */
export function pickedLabel(chosen, total) {
  if (chosen === null || chosen.length === total) return 'All'
  if (chosen.length === 0) return 'None'
  if (chosen.length === 1) return /** @type {string} */ (chosen[0])
  return total === undefined ? `${chosen.length} chosen` : `${chosen.length} of ${total}`
}

/** @typedef {{ name: string, logins: string[] }} AuthorSearch */

/**
 * The Authors button's words: everyone, nobody, a saved search's name, or how many people.
 * @param {readonly string[] | null} authors the ticked ones; `null` is everyone
 * @param {readonly AuthorSearch[]} saved
 * @param {(login: string) => string} [name] how the picker names a choice
 */
export function authorsLabel(authors, saved, name = login => login) {
  if (authors === null) return 'Everyone'
  if (authors.length === 0) return 'Nobody'
  const same = (/** @type {readonly string[]} */ a) =>
    a.length === authors.length && a.every(login => authors.includes(login))
  const named = saved.find(s => same(s.logins))
  const people = authors.length === 1 ? name(authors[0] ?? '') : `${authors.length} people`
  return named === undefined
    ? people
    : `${named.name} · ${authors.length === 1 ? '1 person' : `${authors.length} people`}`
}
