// @ts-check
// What the Your PRs page shows, apart from the DOM: the state, review and status filters, and the
// review label.
import { healthRank } from './health.js'
import { matchesIntegrations, sectionValues } from './integrations.js'
import { pickedLabel, STATUS_ORDER } from './queue.js'
import { sortAccept } from './sorting.js'
import { acceptWhere } from './filter-builder.js'
import { acceptSearch } from './filters.js'
import { TEXTS } from './texts.js'
export * from './states.js'
/** @typedef {import('./states.js').PrState} PrState */
/** @typedef {import('./states.js').StateFilter} StateFilter */
import { acceptStates, emptyBy, OPEN_STATES, readyCompare, STATES, stateOf, upgradeState } from './states.js'

/** @typedef {{ number: number, title: string, url: string, isDraft: boolean, createdAt: string, updatedAt: string, headRefName: string, baseRefName: string, reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null, author: string, reviewers: import('./reviewers.js').Reviewer[], labels?: string[], additions?: number, deletions?: number, readyAt?: string, queuedAt?: string | null }} Pull */

/**
 * The Reviews filter's states: a PR has one of them (see `reviewState`), and the ticked choices
 * keep the PRs with any of them. Every one starts ticked.
 */
export const REVIEW_STATES = /** @type {const} */ ([
  ['approved', 'Approved'],
  ['changesRequested', 'Changes requested'],
  ['commented', 'Commented'],
  ['none', 'No review'],
])
export const REVIEW_STATE_KEYS = REVIEW_STATES.map(([key]) => key)

/** The Review queue's choices beside the states: whether a PR asks you by name for your review. */
export const REQUEST_CHOICES = /** @type {const} */ ([
  ['requested', 'Awaiting your review'],
  ['notRequested', 'Not awaiting your review'],
])

/**
 * The Reviews filter's choices on a page, in two groups: the states, then on the queue
 * `REQUEST_CHOICES` (see `keepsReviews`).
 * @param {boolean} [queue] the Review queue, which adds `REQUEST_CHOICES`
 * @returns {readonly (readonly [string, string])[]}
 */
export const reviewChoices = (queue = false) =>
  queue ? [...REVIEW_STATES, ...REQUEST_CHOICES] : REVIEW_STATES

/**
 * The Reviews filter's other boxes, under "Only PRs with": checked, each must hold as well. Pending
 * work: the PR has comments, threads, reviews or requests waiting on you (the Pending column; the
 * Review queue's left number); on the queue, Work waiting on others: some waiting on the author or
 * other reviewers (its right number). Then attention points still open for the author, or for the
 * reviewer, in its canvas (the Attention points cell's two numbers). Each has its words in the
 * popup, then on the button. Canvas and bot reviews are the Integrations filter's.
 */
const PENDING_FLAG = /** @type {const} */ (['pending', 'Pending work', 'Pending work'])
const POINT_FLAGS = /** @type {const} */ ([
  ['authorPoints', 'Author attention points', 'Author points'],
  ['reviewerPoints', 'Reviewer attention points', 'Reviewer points'],
])
export const REVIEW_FLAGS = /** @type {const} */ ([PENDING_FLAG, ...POINT_FLAGS])
export const QUEUE_REVIEW_FLAGS = /** @type {const} */ ([
  PENDING_FLAG,
  ['waiting', 'Work waiting on others', 'Waiting on others'],
  ...POINT_FLAGS,
])
/** @typedef {(typeof QUEUE_REVIEW_FLAGS)[number][0]} ReviewFlag */

/**
 * The Reviews filter's boxes on a page: the Review queue's, with Work waiting on others, or Your PRs'.
 * @param {boolean} [queue]
 * @returns {readonly (readonly [ReviewFlag, string, string])[]}
 */
export const reviewFlags = (queue = false) => (queue ? QUEUE_REVIEW_FLAGS : REVIEW_FLAGS)

/** The Reviewers filter's choice for a PR nobody has reviewed. */
export const NO_REVIEWER = ':none'

/** The columns Your PRs sorts by. */
export const PULL_SORTS = /** @type {const} */ ([
  'pr',
  'status',
  'pending',
  'points',
  'review',
  'reviewed',
  'ready',
  'labels',
  'canvas',
  'codeRabbit',
])

/** The Review column's order, ascending: what needs you first. */
const REVIEW_ORDER = ['Changes requested', 'Review required', 'No review yet', 'Approved']

/**
 * Each column's ascending order for Your PRs' rows, given each PR's health and statuses by number.
 * @param {Readonly<Record<number, import('./health.js').Health>>} health
 * @param {Readonly<Record<number, { canvas: string, codeRabbit: string }>>} statuses
 * @param {Readonly<Record<number, number>>} [pending] each PR's pending items, by number
 * @param {Readonly<Record<number, { author: number, reviewer: number }>>} [points] each PR's open
 *   attention points, by number
 * @returns {Record<(typeof PULL_SORTS)[number], (a: Pull, b: Pull) => number>}
 */
export function pullCompare(health, statuses, pending = {}, points = {}) {
  const status = (/** @type {string | undefined} */ s) => {
    const at = STATUS_ORDER.indexOf(s ?? '')
    return at === -1 ? STATUS_ORDER.length : at
  }
  return {
    pr: (a, b) => a.number - b.number,
    status: (a, b) => healthRank(health[a.number]) - healthRank(health[b.number]),
    pending: (a, b) => (pending[a.number] ?? -1) - (pending[b.number] ?? -1),
    // A PR whose canvas is not here sorts before one with no open point.
    points: (a, b) => openTotal(points[a.number]) - openTotal(points[b.number]),
    review: (a, b) => REVIEW_ORDER.indexOf(reviewLabel(a).text) - REVIEW_ORDER.indexOf(reviewLabel(b).text),
    reviewed: (a, b) => reviewedBy(a).length - reviewedBy(b).length,
    ready: readyCompare,
    labels: (a, b) =>
      (a.labels ?? []).join(', ').localeCompare((b.labels ?? []).join(', '), 'en', { sensitivity: 'base' }),
    canvas: (a, b) => status(statuses[a.number]?.canvas) - status(statuses[b.number]?.canvas),
    codeRabbit: (a, b) => status(statuses[a.number]?.codeRabbit) - status(statuses[b.number]?.codeRabbit),
  }
}

/** A list of choices, ticked ones only; `null` ticks all of them. */
const ALL = /** @type {string[] | null} */ (null)

/**
 * A PR's open attention points in all, for sorting: one with no canvas counts below zero.
 * @param {{ author: number, reviewer: number } | undefined} points
 */
export const openTotal = points => (points === undefined ? -1 : points.author + points.reviewer)

export const PULLS_DEFAULTS = {
  state: OPEN_STATES,
  /** State's "Only PRs that": checked, only the PRs that need a restack or an update stay. */
  needsUpdate: false,
  /** The review states that keep a PR (see `REVIEW_STATES`). */
  reviews: ALL,
  pending: false,
  authorPoints: false,
  reviewerPoints: false,
  /** Logins whose reviews keep a PR, and `NO_REVIEWER` for a PR nobody reviewed. */
  reviewers: ALL,
  /** The base branches whose PRs stay (see bases.js). */
  bases: ALL,
  /** The one stack whose PRs stay (see stack-pick.js); '' keeps every PR. */
  stack: '',
  /** The columns the rows sort by, first deciding first (see sorting.js); none keeps their order. */
  sort: /** @type {string[]} */ ([]),
  /** The Integrations filter's sections (see integrations.js). */
  codeRabbit: ALL,
  vercel: ALL,
  github: ALL,
  canvas: ALL,
  /** Whether the filter builder's blocks filter the page, in place of the bar (filter-builder.js). */
  builder: false,
  /** The filter builder's blocks, as JSON text; '' for none. */
  where: '',
  /** The search box's words (search.js); in the address and saved filters, never remembered. */
  q: '',
}

const isBool = (/** @type {unknown} */ value) => typeof value === 'boolean'
const isStrings = (/** @type {unknown} */ value) =>
  Array.isArray(value) && value.every(v => typeof v === 'string')
/** @param {readonly string[]} allowed */
const within = allowed => (/** @type {unknown} */ value) =>
  Array.isArray(value) && value.every(v => typeof v === 'string' && allowed.includes(v))

/** @type {{ [K in keyof typeof PULLS_DEFAULTS]: (value: unknown) => boolean }} */
export const PULLS_ACCEPT = {
  state: acceptStates,
  needsUpdate: isBool,
  reviews: within(REVIEW_STATE_KEYS),
  pending: isBool,
  authorPoints: isBool,
  reviewerPoints: isBool,
  reviewers: isStrings,
  bases: isStrings,
  stack: v => typeof v === 'string',
  sort: sortAccept(PULL_SORTS),
  codeRabbit: within(sectionValues('codeRabbit')),
  vercel: within(sectionValues('vercel')),
  github: within(sectionValues('github')),
  canvas: within(sectionValues('canvas')),
  builder: isBool,
  where: acceptWhere,
  q: acceptSearch,
}

/**
 * Your PRs' filters as saved before the review states were one list: Approved, Changes requested
 * and Commented each a box, none checked keeping every PR.
 * @param {Record<string, unknown>} old
 */
export function upgradePulls(old) {
  const { approved, changesRequested, commented, ...rest } = old
  const checked = Object.entries({ approved, changesRequested, commented }).filter(([, on]) => on === true)
  const out = { ...rest, ...('state' in rest ? { state: upgradeState(rest['state']) } : {}) }
  return checked.length === 0 ? out : { ...out, reviews: checked.map(([key]) => key) }
}

/**
 * A PR's review state as one, so the states never overlap: a change request its reviewer has not
 * approved since, else an approval, else a comment, else none.
 * @param {Pick<Pull, 'reviewers'>} pull
 * @returns {(typeof REVIEW_STATE_KEYS)[number]}
 */
export function reviewState(pull) {
  const people = pull.reviewers.filter(r => (r.kind ?? 'person') === 'person')
  if (people.some(r => r.changesRequested > 0 && (r.lastChangeRequestAt ?? '') >= (r.lastApprovalAt ?? '')))
    return 'changesRequested'
  if (people.some(r => r.approvals > 0)) return 'approved'
  return people.some(r => r.comments > 0) ? 'commented' : 'none'
}

/**
 * The Reviews filter's part of a page's filters: the choices ticked, and the flags.
 * @typedef {{ reviews: string[] | null, pending: boolean, waiting?: boolean, authorPoints: boolean,
 *   reviewerPoints: boolean }} ReviewsPicked
 */

/**
 * The review flags that are checked.
 * @param {ReviewsPicked} filters
 * @param {boolean} [queue] the Review queue
 */
export function checkedFlags(filters, queue = false) {
  return reviewFlags(queue)
    .map(([key]) => key)
    .filter(key => filters[key] === true)
}

/**
 * Whether the Reviews filter keeps a PR. Its choices are two groups: the review states, and on the
 * Review queue whether a PR asks you by name for your review. The ticked choices of a group keep a
 * PR with any of them, and each group with some ticked must hold; a group with none ticked is left
 * out, and with none ticked in either, nothing passes. Then "Pending work", checked, must hold
 * too: the PR has pending items; on the queue so must "Work waiting on others": items waiting on
 * someone else. And "Author attention points", checked,
 * must hold too: its canvas has points still open for the author; and so must "Reviewer attention
 * points": points still open for the reviewer.
 * @param {Pick<Pull, 'reviewers'> & { requested?: boolean }} pr
 * @param {ReviewsPicked} f
 * @param {{ pending?: number, waiting?: number, points?: { author: number, reviewer: number } | undefined,
 *   queue?: boolean }} opts the PR's pending items, its items waiting on others, and its open
 *   attention points, none with no canvas
 */
export function keepsReviews(pr, f, opts) {
  const flags =
    (!f.pending || (opts.pending ?? 0) > 0) &&
    (f.waiting !== true || (opts.waiting ?? 0) > 0) &&
    (!f.authorPoints || (opts.points?.author ?? 0) > 0) &&
    (!f.reviewerPoints || (opts.points?.reviewer ?? 0) > 0)
  const picked = f.reviews
  if (picked === null) return flags
  /** Whether a group keeps the PR, given the PR's choice in it. @param {readonly string[]} group @param {string} its */
  const holds = (group, its) => !group.some(v => picked.includes(v)) || picked.includes(its)
  const asks = opts.queue === true ? REQUEST_CHOICES.map(([key]) => key) : []
  const any = [...REVIEW_STATE_KEYS, ...asks].some(v => picked.includes(v))
  return (
    any &&
    holds(REVIEW_STATE_KEYS, reviewState(pr)) &&
    holds(asks, pr.requested === true ? 'requested' : 'notRequested') &&
    flags
  )
}

/**
 * @param {readonly Pull[]} pulls
 * @param {typeof PULLS_DEFAULTS} filters
 * @param {Readonly<Record<number, import('./health.js').Health>>} [health] each PR's, by number
 * @param {Readonly<Record<number, { canvas: string, codeRabbit: string }>>} [statuses] each PR's
 *   canvas and CodeRabbit statuses, by number
 * @param {import('./integrations.js').On} [on] which integrations the repo uses; without the
 *   canvas, the Canvas choices keep every PR
 * @param {Readonly<Record<number, { author: number, reviewer: number }>>} [points] each PR's open
 *   attention points, by number
 * @param {Readonly<Record<number, number>>} [pending] each PR's pending items, by number
 */
export function filterPulls(
  pulls,
  filters,
  health = {},
  statuses = {},
  on = { codeRabbit: true, vercel: true },
  points = {},
  pending = {}
) {
  return pulls.filter(
    p =>
      filters.state.includes(stateOf(p)) &&
      keepsReviews(p, filters, { pending: pending[p.number] ?? 0, points: points[p.number] }) &&
      keepsReviewers(p, filters.reviewers) &&
      matchesIntegrations(
        {
          health: health[p.number] ?? null,
          canvas: statuses[p.number]?.canvas ?? null,
          codeRabbit: statuses[p.number]?.codeRabbit ?? null,
        },
        filters,
        on
      )
  )
}

/**
 * The people who reviewed a PR: its Reviewed by entries but Bots and Canvas, which are groups.
 * @param {Pull} pull
 */
export function reviewedBy(pull) {
  return pull.reviewers.filter(r => (r.kind ?? 'person') === 'person').map(r => r.login)
}

/**
 * Who reviewed a PR, one login each: its people, then the bots its Bots entry stands for.
 * @param {Pull} pull
 */
export function reviewerLogins(pull) {
  return [
    ...reviewedBy(pull).map(login => ({ login, bot: false })),
    ...pull.reviewers
      .filter(r => r.kind === 'bots')
      .flatMap(r => (r.members ?? []).map(login => ({ login, bot: true }))),
  ]
}

/**
 * Whether the Reviewers filter keeps a PR: one of its reviewers ticked, or for a PR nobody
 * reviewed, "No reviewers".
 * @param {Pull} pull
 * @param {readonly string[] | null} picked
 */
function keepsReviewers(pull, picked) {
  if (picked === null) return true
  const logins = reviewerLogins(pull)
  return logins.length === 0 ? picked.includes(NO_REVIEWER) : logins.some(r => picked.includes(r.login))
}

/**
 * The Reviewers picker's choices: "No reviewers" with the PRs nobody reviewed, then everyone who
 * reviewed any of these PRs with how many, people first, then bots, each most first.
 * @param {readonly Pull[]} pulls
 * @param {readonly string[]} [people] the project's people, offered too having reviewed none
 */
export function reviewerCounts(pulls, people = []) {
  /** @type {Map<string, { count: number, bot: boolean }>} */
  const counts = new Map()
  for (const p of pulls)
    for (const { login, bot } of reviewerLogins(p))
      counts.set(login, { count: (counts.get(login)?.count ?? 0) + 1, bot })
  return [
    {
      login: NO_REVIEWER,
      text: 'No reviewers',
      count: pulls.filter(p => reviewerLogins(p).length === 0).length,
    },
    ...[...counts]
      .sort(([a, x], [b, y]) => Number(x.bot) - Number(y.bot) || y.count - x.count || a.localeCompare(b))
      .map(([login, { count, bot }]) => ({ login, count, group: bot ? 'Bots' : 'People' })),
    // The project's other people, who reviewed none of these, after the bots' heading is fine:
    // the picker lists each group under its heading, so they join the People.
    ...people.filter(login => !counts.has(login)).map(login => ({ login, count: 0, group: 'People' })),
  ]
}

/**
 * The review filter button's words: its choices, then any flag checked.
 * @param {ReviewsPicked} filters
 * @param {boolean} [queue] the Review queue, which also asks whether a PR awaits your review
 */
export function reviewFilterLabel(filters, queue = false) {
  const choices = reviewChoices(queue)
  const states = pickedLabel(
    filters.reviews?.map(key => choices.find(([k]) => k === key)?.[1] ?? key) ?? null,
    choices.length
  )
  const flags = checkedFlags(filters, queue).map(
    key => reviewFlags(queue).find(([k]) => k === key)?.[2] ?? key
  )
  if (flags.length === 0) return states
  return `${states} · ${flags.length === 1 ? flags[0] : `${flags.length} more`}`
}

/**
 * How many are in each state, as the State filter counts them.
 * @param {readonly Pick<Pull, 'isDraft' | 'queuedAt'>[]} pulls
 * @returns {Record<PrState, number>}
 */
export function countPulls(pulls) {
  return /** @type {Record<PrState, number>} */ (
    Object.fromEntries(STATES.map(s => [s, pulls.filter(p => stateOf(p) === s).length]))
  )
}

/**
 * The review column: GitHub's review decision, a draft's too (its Draft pill sits on its branch
 * line, as on the Review queue). A repo without required reviews has no decision, which reads as
 * "No review yet".
 * @param {Pick<Pull, 'reviewDecision'>} pull
 * @returns {{ text: string, tone: 'ok' | 'bad' | 'warn' | 'muted' }}
 */
export function reviewLabel(pull) {
  switch (pull.reviewDecision) {
    case 'APPROVED':
      return { text: 'Approved', tone: 'ok' }
    case 'CHANGES_REQUESTED':
      return { text: 'Changes requested', tone: 'bad' }
    case 'REVIEW_REQUIRED':
      return { text: 'Review required', tone: 'warn' }
    default:
      return { text: 'No review yet', tone: 'muted' }
  }
}

/**
 * Splits PRs by their base: those that target one of the repo's main development branches, and
 * the rest, which target another PR's branch and so are part of a stack.
 * @template {{ baseRefName: string }} T
 * @param {readonly T[]} pulls
 * @param {readonly import('./branches.js').MainBranch[]} branches
 */
export function splitByBase(pulls, branches) {
  const names = new Set(branches.map(b => b.name))
  return {
    onMain: pulls.filter(p => names.has(p.baseRefName)),
    stacked: pulls.filter(p => !names.has(p.baseRefName)),
  }
}

/**
 * The main branches in words: "develop", "develop or hotfix", "develop, hotfix or release".
 * @param {readonly import('./branches.js').MainBranch[]} branches
 */
export function branchNames(branches) {
  const names = branches.map(b => b.name)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`
}

/**
 * What the empty list says, by filter.
 * @param {StateFilter} state
 * @param {string} slug
 * @param {boolean} [filtered] whether any filter but the state is off its default
 */
export function emptyText(state, slug, filtered = false) {
  if (filtered) return TEXTS.lists.empty.noPrs
  return emptyBy(state, {
    open: TEXTS.lists.empty.pullsOpen,
    draft: TEXTS.lists.empty.pullsDraft,
    queued: TEXTS.lists.empty.pullsQueued,
    all: TEXTS.lists.empty.pullsNone(slug),
  })
}
