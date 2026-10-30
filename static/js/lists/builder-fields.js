// @ts-check
// What the filter builder (filter-builder.js) offers on each page: the fields of Your PRs, the
// Review queue and the Inbox, with the same choices as their filter bars, and the bar's filters
// written out as blocks, which is where Builder starts the first time it is turned on.
import { OTHER_BASE, placeOf } from './bases.js'
import { INBOX_SOURCES, inboxUsers } from './events.js'
import { emptyBlock, oneOf, seedBlock, stateField, stateValues, yesNo } from './filter-builder.js'
import { hasIntegration, INTEGRATION_SECTIONS, sectionValues } from './integrations.js'
import {
  NO_REVIEWER,
  REQUEST_CHOICES,
  REVIEW_STATE_KEYS,
  REVIEW_STATES,
  reviewerCounts,
  reviewerLogins,
  reviewState,
} from './pulls.js'
import { labelChoices, NO_LABEL, queueAuthors } from './queue.js'
import { stackNames } from './stack-pick.js'

/** @template T @typedef {import('./filter-builder.js').Field<T>} Field */
/** @typedef {import('./filter-builder.js').Block} Block */
/** @typedef {import('./branches.js').MainBranch} MainBranch */
/** @typedef {import('./integrations.js').On} On */
/** @typedef {import('./integrations.js').Subject} Subject */

/** The sections of the Integrations filter the repo uses, as on the filter bar. @param {On} on */
const sectionsOn = on =>
  INTEGRATION_SECTIONS.filter(
    s =>
      (s.key !== 'codeRabbit' || on.codeRabbit) &&
      (s.key !== 'vercel' || on.vercel) &&
      (s.key !== 'canvas' || on.canvas !== false)
  )

/**
 * A field per integration the repo uses; GitHub's a PR can have several of (CI failing and a
 * merge conflict).
 * @template T
 * @param {On} on
 * @param {(row: T) => Subject} subject
 * @returns {Field<T>[]}
 */
const integrationFields = (on, subject) =>
  sectionsOn(on).map(s => ({
    key: s.key,
    label: s.title,
    multi: s.key === 'github',
    options: () => s.choices,
    values: row => sectionValues(s.key).filter(v => hasIntegration(subject(row), s.key, v)),
  }))

/**
 * The Integrations filter as a block: one popup, so its sections are ORed, a section left at all
 * standing for every one of its choices.
 * @param {Record<'codeRabbit' | 'vercel' | 'github' | 'canvas', string[] | null>} f
 * @param {On} on
 * @returns {Block}
 */
const integrationsBlock = (f, on) => {
  const sections = sectionsOn(on)
  if (sections.every(s => f[s.key] === null)) return emptyBlock('or')
  return {
    op: 'or',
    // A section with none ticked adds nothing to an OR, and left empty it would be left out.
    items: sections
      .map(s => ({
        field: s.key,
        is: /** @type {const} */ ('any'),
        values: f[s.key] ?? sectionValues(s.key),
      }))
      .filter(c => c.values.length > 0),
  }
}

/**
 * The Base field while the repo has more than one base branch: the branch a PR targets itself,
 * one of them or Other branches. Unlike the Base filter, it has no Stacked branches: a PR into
 * another PR's branch is on Other branches.
 * @template {{ baseRefName: string }} T
 * @param {readonly MainBranch[]} branches
 * @returns {Field<T>[]}
 */
const baseField = branches =>
  branches.length < 2
    ? []
    : [
        {
          key: 'base',
          label: 'Base',
          options: () => [
            ...branches.map(b => /** @type {const} */ ([b.name, b.name])),
            [OTHER_BASE, 'Other branches'],
          ],
          values: row => [placeOf({ baseRefName: row.baseRefName }, branches)],
        },
      ]

/**
 * The Search field, first: words typed as in the search box, AND and OR included, which a row
 * matches by its PR's title, branches, number or Jira keys (search.js). None where the page gives
 * no way to match.
 * @template T
 * @param {((row: T, words: string) => boolean) | undefined} test
 * @returns {Field<T>[]}
 */
const searchField = test =>
  test === undefined
    ? []
    : [{ key: 'search', label: 'Search', options: () => [], values: () => [], text: test }]

/**
 * The Stack field, as the Stack filter: the stack a PR is in, among the stacks of the rows there
 * are; a PR in none, or alone in its stack, has no value.
 * @template T
 * @param {(row: T) => import('./stack-pick.js').Stacked['stack']} stackOf
 * @returns {Field<T>}
 */
const stackField = stackOf => ({
  key: 'stack',
  label: 'Stack',
  options: rows => stackNames(rows.map(r => ({ stack: stackOf(r) }))).map(n => /** @type {const} */ ([n, n])),
  values: row => {
    const stack = stackOf(row)
    return stack !== undefined && stack.total > 1 ? [stack.name] : []
  },
})

/** The Stack filter as a condition: the one stack picked, or none. @param {string} stack */
const stackPart = stack => /** @type {[string, string[] | null]} */ (['stack', stack === '' ? null : [stack]])

/** The Reviews filter as conditions: the states, and on the queue whether it awaits you, ANDed. */
const reviewParts = (/** @type {string[] | null} */ reviews, queue = false) => {
  if (reviews === null) return []
  const states = reviews.filter(v => /** @type {readonly string[]} */ (REVIEW_STATE_KEYS).includes(v))
  const asks = reviews.filter(v => REQUEST_CHOICES.some(([k]) => k === v))
  return /** @type {[string, string[] | null][]} */ ([
    ['review', states.length === 0 ? null : states],
    ...(queue
      ? [/** @type {[string, string[] | null]} */ (['requested', asks.length === 0 ? null : asks])]
      : []),
  ])
}

/**
 * The Reviews filter's flags as blocks: pending work, on the queue work waiting on others, then
 * the attention points.
 * @param {{ pending: boolean, waiting?: boolean, authorPoints: boolean, reviewerPoints: boolean }} f
 * @returns {[string, string[] | null][]}
 */
const pointsParts = f => [
  ['pending', f.pending ? ['yes'] : null],
  ...('waiting' in f
    ? [/** @type {[string, string[] | null]} */ (['waiting', f.waiting ? ['yes'] : null])]
    : []),
  ['authorPoints', f.authorPoints ? ['yes'] : null],
  ['reviewerPoints', f.reviewerPoints ? ['yes'] : null],
]

/**
 * The attention point fields: open points for the author, and for the reviewer.
 * @template T
 * @param {(row: T) => { author: number, reviewer: number } | undefined} points
 */
const pointsFields = points => [
  yesNo(
    'authorPoints',
    'Author attention points',
    'Has author attention points',
    'No author attention points',
    /** @param {T} row */ row => (points(row)?.author ?? 0) > 0
  ),
  yesNo(
    'reviewerPoints',
    'Reviewer attention points',
    'Has reviewer attention points',
    'No reviewer attention points',
    /** @param {T} row */ row => (points(row)?.reviewer ?? 0) > 0
  ),
]

/**
 * The Review queue's fields.
 * @param {{ on: On, branches: readonly MainBranch[], people?: readonly string[],
 *   search?: (row: import("./queue.js").QueueRow, words: string) => boolean }} ctx
 * @returns {Field<import('./queue.js').QueueRow>[]}
 */
export function queueFields({ on, branches, people = [], search }) {
  return [
    ...searchField(search),
    stateField(),
    {
      key: 'author',
      label: 'Author',
      // Under People and Bots, as on the Authors picker.
      options: rows =>
        queueAuthors(rows, people).map(p => /** @type {const} */ ([p.login, p.login, p.group])),
      values: row => [row.author],
    },
    {
      key: 'label',
      label: 'Label',
      multi: true,
      // Labels match whatever their case, as on the filter bar.
      options: rows =>
        labelChoices(rows, null).map(c => /** @type {const} */ ([
          c.value === NO_LABEL ? NO_LABEL : c.value.toLowerCase(),
          c.text,
        ])),
      values: row => (row.labels.length === 0 ? [NO_LABEL] : row.labels.map(l => l.toLowerCase())),
    },
    oneOf('review', 'Review', REVIEW_STATES, reviewState),
    oneOf('requested', 'Your review', REQUEST_CHOICES, row => (row.requested ? 'requested' : 'notRequested')),
    yesNo('pending', 'Pending work', 'Has pending work', 'Nothing pending', row => (row.pending ?? 0) > 0),
    yesNo(
      'waiting',
      'Waiting on others',
      'Has work waiting on others',
      'Nothing waiting on others',
      row => (row.waiting ?? 0) > 0
    ),
    ...pointsFields(/** @param {import('./queue.js').QueueRow} row */ row => row.points),
    ...baseField(branches),
    stackField(row => row.stack),
    ...integrationFields(on, row => row),
  ]
}

/**
 * The Review queue's filter bar as blocks.
 * @param {typeof import('./queue.js').QUEUE_DEFAULTS} f
 * @param {{ on: On, bases: string[] | null, stack: string }} ctx `bases` as the repo still has
 *   them, `stack` as the PRs still have it
 */
export function queueSeed(f, { on, bases, stack }) {
  return seedBlock([
    ['state', stateValues(f.state)],
    ['author', f.authors],
    ['label', f.labels?.map(l => (l === NO_LABEL ? l : l.toLowerCase())) ?? null],
    ...reviewParts(f.reviews, true),
    ...pointsParts(f),
    ['base', bases],
    stackPart(stack),
    integrationsBlock(f, on),
  ])
}

/**
 * Your PRs' fields; each PR's health, statuses, open attention points and stack come by its number.
 * @param {{ on: On, branches: readonly MainBranch[],
 *   stacks: Readonly<Record<number, import('./stack-pick.js').Stacked['stack']>>,
 *   health: Readonly<Record<number, import('./health.js').Health>>,
 *   statuses: Readonly<Record<number, { canvas: string, codeRabbit: string }>>,
 *   pending: Readonly<Record<number, number>>,
 *   points: Readonly<Record<number, { author: number, reviewer: number }>>, people?: readonly string[],
 *   search?: (pull: import("./pulls.js").Pull, words: string) => boolean }} ctx
 * @returns {Field<import('./pulls.js').Pull>[]}
 */
export function pullFields({ on, branches, stacks, health, statuses, pending, points, people = [], search }) {
  return [
    ...searchField(search),
    stateField(),
    oneOf('review', 'Review', REVIEW_STATES, reviewState),
    yesNo(
      'pending',
      'Pending work',
      'Has pending work',
      'Nothing pending',
      p => (pending[p.number] ?? 0) > 0
    ),
    ...pointsFields(/** @param {import('./pulls.js').Pull} p */ p => points[p.number]),
    {
      key: 'reviewer',
      label: 'Reviewer',
      multi: true,
      options: pulls =>
        reviewerCounts(pulls, people).map(r =>
          'text' in r
            ? /** @type {const} */ ([r.login, r.text])
            : /** @type {const} */ ([r.login, r.login, r.group])
        ),
      values: p => {
        const logins = reviewerLogins(p).map(r => r.login)
        return logins.length === 0 ? [NO_REVIEWER] : logins
      },
    },
    {
      key: 'label',
      label: 'Label',
      multi: true,
      options: pulls =>
        labelChoices(
          pulls.map(p => ({ labels: p.labels ?? [] })),
          null
        ).map(c => /** @type {const} */ ([c.value === NO_LABEL ? NO_LABEL : c.value.toLowerCase(), c.text])),
      values: p => ((p.labels ?? []).length === 0 ? [NO_LABEL] : (p.labels ?? []).map(l => l.toLowerCase())),
    },
    ...baseField(branches),
    stackField(p => stacks[p.number]),
    ...integrationFields(on, p => ({ health: health[p.number] ?? null, ...statuses[p.number] })),
  ]
}

/**
 * Your PRs' filter bar as blocks.
 * @param {typeof import('./pulls.js').PULLS_DEFAULTS} f
 * @param {{ on: On, bases: string[] | null, stack: string }} ctx
 */
export function pullsSeed(f, { on, bases, stack }) {
  return seedBlock([
    ['state', stateValues(f.state)],
    ...reviewParts(f.reviews),
    ...pointsParts(f),
    ['reviewer', f.reviewers],
    ['base', bases],
    stackPart(stack),
    integrationsBlock(f, on),
  ])
}

/**
 * The Inbox's fields. `labels` is every type the Type filter offers.
 * @param {{ labels: readonly string[], search?: (event: import("./events.js").InboxEvent, words: string) => boolean }} ctx
 * @returns {Field<import('./events.js').InboxEvent>[]}
 */
export function inboxFields({ labels, search }) {
  return [
    ...searchField(search),
    stateField(),
    // A canvas event is a human's: a person posted it.
    oneOf('source', 'Source', INBOX_SOURCES, e => (e.source === 'canvas' ? 'human' : e.source)),
    oneOf(
      'type',
      'Type',
      labels.map(l => /** @type {const} */ ([l, l])),
      e => e.label
    ),
    {
      key: 'user',
      label: 'User',
      // Under People, Bots, and Checks & conflicts, as on the Users picker.
      options: events => inboxUsers(events).map(p => /** @type {const} */ ([p.login, p.login, p.group])),
      values: e => [e.who],
    },
    yesNo('read', 'Read', 'Read', 'Unread', e => e.read),
    yesNo('dismissed', 'Dismissed', 'Dismissed', 'Not dismissed', e => e.dismissed),
    yesNo('chatter', 'Bot status note', 'Status note', 'Not a status note', e => e.chatter === true),
    yesNo('notifying', 'Notifies', 'Notifies', 'Does not notify', e => e.notifies === true),
  ]
}

/**
 * The Inbox's filter bar as blocks. Dismissed events and bots' status notes are its "Also show"
 * boxes: unchecked, they are left out.
 * @param {typeof import('./events.js').INBOX_DEFAULTS} f
 */
export function inboxSeed(f) {
  return seedBlock([
    ['state', stateValues(f.state)],
    ['source', f.sources],
    ['type', f.types],
    ['user', f.authors],
    ['dismissed', f.dismissed ? null : ['no']],
    ['chatter', f.chatter ? null : ['no']],
    ['notifying', f.notifying ? ['yes'] : null],
  ])
}
