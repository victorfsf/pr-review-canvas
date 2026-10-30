// @ts-check
// Inbox events and pending-work items as the pages show them, apart from the DOM: their tag
// colors, their words, and the Inbox filters.
import { acceptSearch, ticked } from './filters.js'
import { ALL_STATES, acceptStates, stateOf, upgradeState } from './states.js'
import { pickedLabel } from './queue.js'
import { acceptWhere } from './filter-builder.js'
import { TEXTS } from './texts.js'

/**
 * @typedef {{ id: string, pr: number, at: string, label: string, category: 'review' | 'canvas' | 'ci' | 'conflict',
 *   source: 'you' | 'human' | 'bot' | 'canvas', icon: 'pr' | 'comment', who: string, meta: string, url: string,
 *   items: string[], read: boolean, title: string, isDraft: boolean, queued?: boolean, dismissed: boolean, muted: boolean, ids?: string[],
 *   role?: 'author' | 'reviewer', chatter?: boolean, notifies?: boolean }} InboxEvent
 * `notifies`: whether it passes Settings' notification rules, so the bell counts it while unread.
 */

/**
 * @typedef {{ id: string, kind: 'thread' | 'changes' | 'check' | 'stuck' | 'conflict' | 'comment' | 'review',
 *   label: string, source: string, who: string, where: string, url: string, at: string, text: string | null,
 *   code: { n: number, text: string }[], replies: { who: string, at: string, text: string | null, mine?: boolean, subject?: string }[],
 *   dismissed: boolean, own: boolean, waitingOn?: 'you' | 'others', matched?: string, answered?: boolean,
 *   answer?: { who: string, at: string, text: string | null, url: string }, dismissedOnGitHub?: boolean,
 *   outdated?: boolean, subject?: string }} PendingItem
 * `answered`: the one it waits on answered it (you, or on what waits on others, someone else) and
 * nobody has asked since; `answer` is the comment answering one that is not a thread (a thread's
 * are among its replies, yours `mine`). `subject` is a thread's first comment's GitHub id, and a
 * reply's its own, for their reactions.
 */

/** The groups people are listed under in an Authors or Users picker, in order. */
export const WRITER_GROUPS = /** @type {const} */ (['People', 'Bots', 'Checks & conflicts'])

/**
 * Everyone with an event here, with how many are theirs, for the Inbox's Users picker and the
 * builder's User field: people first, then bots, then the checks and the merge conflict, which
 * nobody wrote; in each, most first, then by name.
 * @param {readonly Pick<InboxEvent, 'who' | 'source' | 'category'>[]} events
 * @returns {{ login: string, count: number, group: string }[]}
 */
export function inboxUsers(events) {
  /** @type {Map<string, { group: number, count: number }>} */
  const rows = new Map()
  for (const e of events) {
    const group = e.category === 'ci' || e.category === 'conflict' ? 2 : e.source === 'bot' ? 1 : 0
    const row = rows.get(e.who)
    rows.set(e.who, { group: Math.max(row?.group ?? 0, group), count: (row?.count ?? 0) + 1 })
  }
  return [...rows]
    .sort(([a, x], [b, y]) => x.group - y.group || y.count - x.count || a.localeCompare(b))
    .map(([login, { group, count }]) => ({ login, count, group: WRITER_GROUPS[group] ?? '' }))
}

/** The colored tag of each event label and pending item label. */
const TONES = /** @type {Record<string, string>} */ ({
  Comment: 'acc',
  Thread: 'acc',
  Review: 'acc',
  'Changes requested': 'bad',
  Approved: 'ok',
  'Review dismissed': 'muted',
  Canvas: 'done',
  'Canvas posted': 'done',
  You: 'muted',
  Bot: 'acc',
  'CI failing': 'bad',
  'CI passing': 'ok',
  'CI stuck': 'warn',
  Conflict: 'warn',
  'Review requested': 'acc',
  'Re-review': 'acc',
  'Ready for review': 'ok',
})

/** @param {string} label */
export function toneOf(label) {
  return TONES[label] ?? 'muted'
}

/** The words after the author's name, as the PR's All activity tab reads. */
const WHAT = /** @type {Record<string, string>} */ ({
  Comment: 'commented',
  Review: 'reviewed',
  'Changes requested': 'requested changes',
  Approved: 'approved',
  'Review dismissed': 'had a review dismissed',
  Canvas: 'reviewed from Canvas',
  'Canvas posted': 'posted a canvas',
  'CI failing': 'failing',
  'CI passing': 'passing again',
  'CI stuck': 'not running',
  Conflict: '',
  'Review requested': 'asked you to review',
  'Re-review': 'asked you to review again',
  'Ready for review': 'marked it ready for review',
})

/**
 * "alice requested changes · 2 inline comments", without the name.
 * @param {InboxEvent} event
 */
export function eventWhat(event) {
  const what =
    event.label === 'You' ? (event.id.startsWith('comment:') ? 'commented' : 'reviewed') : WHAT[event.label]
  return [what, event.meta].filter(Boolean).join(' · ')
}

/** The accessible name of an event's icon. */
export const ICON_NAMES = { pr: 'PR event', comment: 'Comment' }

/** The Source filter's choices: who an event is from. */
export const INBOX_SOURCES = /** @type {const} */ ([
  ['you', 'You'],
  ['human', 'Humans'],
  ['bot', 'Bots'],
])

/**
 * The Type filter's "Also show" boxes: each checked adds those events back, and the button names
 * the ones off their default (`[key, label, when changed]`).
 */
export const INBOX_FLAGS = /** @type {const} */ ([
  ['dismissed', 'Dismissed', 'Dismissed'],
  ['chatter', 'Bot status notes', 'No status notes'],
])

export const INBOX_DEFAULTS = {
  /** The states of the events' PRs shown; every one to start. */
  state: ALL_STATES,
  /** The sources ticked (`INBOX_SOURCES`); `null` ticks all. */
  sources: /** @type {string[] | null} */ (null),
  /** The event types (their labels) ticked; `null` ticks all. */
  types: /** @type {string[] | null} */ (null),
  dismissed: false,
  /** Bots' status notes and summaries (see `src/github/chatter.ts`). */
  chatter: true,
  /** Only events that pass Settings' notification rules: what the bell counts. */
  notifying: false,
  /** The logins whose events show; `null` ticks everyone. */
  authors: /** @type {string[] | null} */ (null),
  /** Whether the filter builder's blocks filter the page, in place of the bar (filter-builder.js). */
  builder: false,
  /** The filter builder's blocks, as JSON text; '' for none. */
  where: '',
  /** The search box's words (search.js); in the address and saved filters, never remembered. */
  q: '',
}

const isBool = (/** @type {unknown} */ v) => typeof v === 'boolean'
const isStrings = (/** @type {unknown} */ v) => Array.isArray(v) && v.every(s => typeof s === 'string')

/** @type {{ [K in keyof typeof INBOX_DEFAULTS]: (value: unknown) => boolean }} */
export const INBOX_ACCEPT = {
  state: acceptStates,
  sources: value =>
    isStrings(value) && /** @type {string[]} */ (value).every(v => INBOX_SOURCES.some(([k]) => k === v)),
  types: isStrings,
  dismissed: isBool,
  chatter: isBool,
  notifying: isBool,
  authors: isStrings,
  builder: isBool,
  where: acceptWhere,
  q: acceptSearch,
}

/**
 * A save from before Source and Type held what is ticked: the You, Humans and Bots switches
 * become `sources`, and the unticked `hiddenTypes` become the ticked `types`, out of `labels`.
 * A save made since comes back as it is.
 * @param {Record<string, unknown>} old
 * @param {readonly string[]} labels every type the Type filter offers
 */
export function upgradeInbox(old, labels) {
  const { you, human, bot, hiddenTypes, ...rest } = old
  /** @type {Record<string, unknown>} */
  const out = 'state' in rest ? { ...rest, state: upgradeState(rest['state']) } : rest
  const switches = { you, human, bot }
  if (Object.values(switches).some(v => v !== undefined)) {
    const on = Object.entries(switches)
      .filter(([, v]) => v !== false)
      .map(([k]) => k)
    if (on.length < INBOX_SOURCES.length) out['sources'] = on
  }
  if (Array.isArray(hiddenTypes) && hiddenTypes.length > 0)
    out['types'] = labels.filter(l => !hiddenTypes.includes(l))
  return out
}

/**
 * The events the filters let through: each filter must hold, and inside Source and Type an event
 * passes with any choice ticked. A canvas event counts as a human's: a person posted it. A bot's
 * status note shows unless "Bot status notes" is unticked.
 * @param {readonly InboxEvent[]} events
 * @param {typeof INBOX_DEFAULTS} f
 */
export function filterEvents(events, f) {
  return events.filter(e => {
    if (!f.state.includes(stateOf(e))) return false
    if (f.notifying && e.notifies !== true) return false
    if (!ticked(f.types, e.label)) return false
    if (!ticked(f.authors, e.who)) return false
    if (!ticked(f.sources, e.source === 'canvas' ? 'human' : e.source)) return false
    if (!f.chatter && e.chatter === true) return false
    return f.dismissed || !e.dismissed
  })
}

/**
 * The Source button's words: "All", "None", the one ticked, or how many.
 * @param {typeof INBOX_DEFAULTS} f
 */
export function sourceLabel(f) {
  const names = f.sources?.map(key => INBOX_SOURCES.find(([k]) => k === key)?.[1] ?? key) ?? null
  return pickedLabel(names, INBOX_SOURCES.length)
}

/**
 * The Type button's words: its types, then any "Also show" box off its default.
 * @param {typeof INBOX_DEFAULTS} f
 * @param {number} total how many types it offers
 */
export function typeLabel(f, total) {
  const types = pickedLabel(f.types, total)
  const flags = INBOX_FLAGS.filter(([key]) => f[key] !== INBOX_DEFAULTS[key]).map(([, , changed]) => changed)
  if (flags.length === 0) return types
  return `${types} · ${flags.length === 1 ? flags[0] : `${flags.length} more`}`
}

/**
 * What the empty Inbox says.
 * @param {number} total events before filtering
 */
export function inboxEmptyText(total) {
  return total === 0 ? TEXTS.lists.empty.inboxNothingYet : TEXTS.lists.empty.noEvents
}
