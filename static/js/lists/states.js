// @ts-check
// A PR's state for the State filter (open, a draft, or in GitHub's merge queue) and the Ready
// column's times. It imports nothing, so every list's filters and the server can read it.

/**
 * A PR's states, in the State filter's order: open (ready, not queued), a draft, or in GitHub's
 * merge queue.
 */
export const STATES = /** @type {const} */ (['open', 'draft', 'queued'])
/** @typedef {(typeof STATES)[number]} PrState */
/** The states the State filter keeps, in `STATES` order, at least one. @typedef {PrState[]} StateFilter */

/** Every state: State at All. */
export const ALL_STATES = /** @type {StateFilter} */ ([...STATES])
/** Open and queued: what Your PRs and the Review queue show to start, as before queues were read. */
export const OPEN_STATES = /** @type {StateFilter} */ (['open', 'queued'])

/**
 * A PR's state: a draft, else in the merge queue, else open. An event says `queued` of its PR.
 * @param {{ isDraft: boolean, queuedAt?: string | null, queued?: boolean }} pr
 * @returns {PrState}
 */
export const stateOf = pr =>
  pr.isDraft ? 'draft' : (pr.queuedAt ?? null) !== null || pr.queued === true ? 'queued' : 'open'

/** Whether a saved or linked State is one: states it knows, each once, at least one. */
export const acceptStates = (/** @type {unknown} */ value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(v => /** @type {readonly unknown[]} */ (STATES).includes(v)) &&
  new Set(value).size === value.length

/**
 * A State saved or linked before Queued came, as one word, in today's terms: Open keeps the queued
 * PRs it always showed, and Both is every state. Anything else comes back as it was.
 * @param {unknown} old
 * @returns {unknown}
 */
export const upgradeState = old => {
  // A link reads its state as a list: Both alone in it is every state.
  const word = Array.isArray(old) && old.length === 1 && old[0] === 'both' ? 'both' : old
  return word === 'open' ? OPEN_STATES : word === 'draft' ? ['draft'] : word === 'both' ? ALL_STATES : old
}

/**
 * When a PR became ready for review: when it last left draft, else when it opened.
 * @param {{ readyAt?: string, createdAt?: string }} pr
 */
export const readySince = pr =>
  pr.readyAt === undefined || pr.readyAt === '' ? (pr.createdAt ?? '') : pr.readyAt

/**
 * The Ready column's order, ascending: the longest in the merge queue first, then the longest ready.
 * @param {{ readyAt?: string, createdAt?: string, queuedAt?: string | null }} a
 * @param {{ readyAt?: string, createdAt?: string, queuedAt?: string | null }} b
 */
export function readyCompare(a, b) {
  const queued = (/** @type {typeof a} */ p) => p.queuedAt !== undefined && p.queuedAt !== null
  if (queued(a) !== queued(b)) return queued(a) ? -1 : 1
  const at = (/** @type {typeof a} */ p) =>
    Date.parse(queued(p) ? /** @type {string} */ (p.queuedAt) : readySince(p))
  return at(a) - at(b)
}

/** Each state's mark on a table's row: its icon and its tone. */
export const STATE_LOOK = /** @type {Record<PrState, { icon: string, tone: string }>} */ ({
  open: { icon: 'pull', tone: 'ok' },
  draft: { icon: 'pullDraft', tone: 'muted' },
  queued: { icon: 'gitMergeQueue', tone: 'warn' },
})

/**
 * GitHub's page of the merge queue a PR waits in: its repo's queue for its base branch, on the
 * same host as the PR.
 * @param {{ url: string, baseRefName: string }} pr
 */
export const mergeQueueUrl = pr =>
  `${pr.url.replace(/\/pull\/\d+\/?$/, '')}/queue/${encodeURIComponent(pr.baseRefName)}`

/** What the State filter calls each state. */
export const STATE_WORDS = /** @type {Record<string, string>} */ ({
  open: 'Open',
  draft: 'Draft',
  queued: 'Queued',
})

/**
 * What State's button says: All, or the states ticked, in their order.
 * @param {readonly string[]} state
 */
export const stateLabel = state =>
  state.length === STATES.length ? 'All' : state.map(s => STATE_WORDS[s] ?? s).join(', ')

/** Whether two State filters keep the same states. @param {readonly string[]} a @param {readonly string[]} b */
export const sameStates = (a, b) => a.length === b.length && a.every(s => b.includes(s))

/** The states ticked, in `STATES` order. @param {Iterable<PrState>} states @returns {StateFilter} */
export const inOrder = states => {
  const ticked = new Set(states)
  return STATES.filter(s => ticked.has(s))
}

/**
 * Which empty line a State gives: drafts alone, queued alone, open (with or without queued), or
 * drafts among others, which is every open PR.
 * @param {StateFilter} state
 * @param {{ open: string, draft: string, queued: string, all: string }} lines
 */
export function emptyBy(state, lines) {
  if (state.includes('draft')) return state.length === 1 ? lines.draft : lines.all
  return state.length === 1 && state[0] === 'queued' ? lines.queued : lines.open
}
