// @ts-check
import {
  eventWhat,
  filterEvents,
  INBOX_ACCEPT,
  INBOX_DEFAULTS,
  inboxEmptyText,
  inboxUsers,
  sourceLabel,
  toneOf,
  typeLabel,
  upgradeInbox,
} from './events.js'

/** Every label an event can carry, as the server names them. */
const LABELS = [
  'Comment',
  'Review',
  'Changes requested',
  'Approved',
  'Review dismissed',
  'Canvas',
  'Canvas posted',
  'You',
  'CI failing',
  'CI passing',
  'CI stuck',
  'Conflict',
  'Review requested',
  'Re-review',
  'Ready for review',
]

/** @param {Partial<import('./events.js').InboxEvent>} o @returns {import('./events.js').InboxEvent} */
const event = o => ({
  id: 'comment:C1',
  pr: 1,
  at: '2026-10-22T10:00:00Z',
  label: 'Comment',
  category: 'review',
  source: 'human',
  icon: 'comment',
  who: 'alice',
  meta: '',
  url: 'https://github.com/acme/widgets/pull/1',
  items: ['comment:C1'],
  read: false,
  title: 'Synthetic change',
  isDraft: false,
  dismissed: false,
  muted: false,
  ...o,
})

describe('event words', () => {
  it('colors each label and says what happened', () => {
    expect(toneOf('Changes requested')).toBe('bad')
    expect(toneOf('Something new')).toBe('muted')
    expect(eventWhat(event({ label: 'Review', meta: '12 inline comments' }))).toBe(
      'reviewed · 12 inline comments'
    )
    expect(eventWhat(event({ label: 'You' }))).toBe('commented')
    expect(eventWhat(event({ label: 'You', id: 'review:R1' }))).toBe('reviewed')
    expect(eventWhat(event({ label: 'Conflict', meta: 'conflicts with develop' }))).toBe(
      'conflicts with develop'
    )
  })

  it('has words for every label, so no row is a bare name', () => {
    // A conflict's words are its meta, "conflicts with develop".
    for (const label of LABELS.filter(l => l !== 'Conflict'))
      expect([label, eventWhat(event({ label, meta: '' }))]).not.toEqual([label, ''])
    expect(eventWhat(event({ label: 'Ready for review', meta: '' }))).toBe('marked it ready for review')
  })
})

describe('the Inbox filters', () => {
  const events = [
    event({ id: 'a' }),
    event({ id: 'b', isDraft: true, category: 'ci', source: 'bot' }),
    event({ id: 'c', source: 'canvas', category: 'canvas' }),
    event({ id: 'd', source: 'you' }),
    event({ id: 'e', dismissed: true }),
    event({ id: 'f', role: 'reviewer' }),
  ]
  const ids = (/** @type {typeof INBOX_DEFAULTS} */ f) => filterEvents(events, f).map(e => e.id)

  it('shows everything but dismissed events by default', () => {
    expect(ids(INBOX_DEFAULTS)).toEqual(['a', 'b', 'c', 'd', 'f'])
    expect(ids({ ...INBOX_DEFAULTS, dismissed: true })).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('filters by PR state, source, type and author, a canvas event counting as a human one', () => {
    expect(ids({ ...INBOX_DEFAULTS, state: ['draft'] })).toEqual(['b'])
    expect(ids({ ...INBOX_DEFAULTS, state: ['open', 'queued'] })).toEqual(['a', 'c', 'd', 'f'])
    expect(ids({ ...INBOX_DEFAULTS, sources: ['you', 'human'] })).toEqual(['a', 'c', 'd', 'f'])
    // By author: the events of the picked people only.
    const byWho = [event({ id: 'g', who: 'alice' }), event({ id: 'h', who: 'bob' })]
    expect(filterEvents(byWho, { ...INBOX_DEFAULTS, authors: ['bob'] }).map(e => e.id)).toEqual(['h'])
    expect(ids({ ...INBOX_DEFAULTS, sources: ['you', 'bot'] })).toEqual(['b', 'd'])
    expect(ids({ ...INBOX_DEFAULTS, sources: ['human', 'bot'] })).toEqual(['a', 'b', 'c', 'f'])
    // None ticked keeps nothing.
    expect(ids({ ...INBOX_DEFAULTS, sources: [] })).toEqual([])
    // Notifying only: the events Settings' rules let through.
    const notifying = [
      event({ id: 'g', notifies: true }),
      event({ id: 'h', notifies: false }),
      event({ id: 'i' }),
    ]
    expect(filterEvents(notifying, { ...INBOX_DEFAULTS, notifying: true }).map(e => e.id)).toEqual(['g'])
    // By type: only the ticked labels' events, any of them; none ticked keeps nothing.
    expect(ids({ ...INBOX_DEFAULTS, types: ['Approved'] })).toEqual([])
    const typed = [
      event({ id: 'g', label: 'Approved' }),
      event({ id: 'h', label: 'CI failing' }),
      event({ id: 'i', label: 'Comment', source: 'bot' }),
    ]
    const typedIds = (/** @type {Partial<typeof INBOX_DEFAULTS>} */ f) =>
      filterEvents(typed, { ...INBOX_DEFAULTS, ...f }).map(e => e.id)
    expect(typedIds({ types: ['Approved', 'Comment'] })).toEqual(['g', 'i'])
    expect(typedIds({ types: [] })).toEqual([])
    // Source and Type each must hold.
    expect(typedIds({ types: ['Approved', 'Comment'], sources: ['bot'] })).toEqual(['i'])
  })

  it("shows bots' status notes unless they are unticked", () => {
    const bots = [
      event({ id: 'n', source: 'bot', who: 'coderabbitai[bot]', chatter: true }),
      event({ id: 'r', source: 'bot', who: 'coderabbitai[bot]' }),
    ]
    expect(filterEvents(bots, INBOX_DEFAULTS).map(e => e.id)).toEqual(['n', 'r'])
    expect(filterEvents(bots, { ...INBOX_DEFAULTS, chatter: false }).map(e => e.id)).toEqual(['r'])
    expect(typeLabel({ ...INBOX_DEFAULTS, chatter: false }, 15)).toBe('All · No status notes')
    expect(INBOX_ACCEPT.chatter(false)).toBe(true)
  })

  it('labels the Source and Type buttons by what is ticked, and checks saved values', () => {
    expect(sourceLabel(INBOX_DEFAULTS)).toBe('All')
    expect(sourceLabel({ ...INBOX_DEFAULTS, sources: ['bot'] })).toBe('Bots')
    expect(sourceLabel({ ...INBOX_DEFAULTS, sources: ['you', 'bot'] })).toBe('2 of 3')
    expect(sourceLabel({ ...INBOX_DEFAULTS, sources: [] })).toBe('None')
    expect(sourceLabel({ ...INBOX_DEFAULTS, sources: ['nope'] })).toBe('nope')
    expect(typeLabel(INBOX_DEFAULTS, 15)).toBe('All')
    expect(typeLabel({ ...INBOX_DEFAULTS, types: ['Comment', 'CI passing'] }, 15)).toBe('2 of 15')
    expect(typeLabel({ ...INBOX_DEFAULTS, types: ['Comment'], dismissed: true }, 15)).toBe(
      'Comment · Dismissed'
    )
    expect(typeLabel({ ...INBOX_DEFAULTS, dismissed: true, chatter: false }, 15)).toBe('All · 2 more')
    expect(INBOX_ACCEPT.state(['open'])).toBe(true)
    expect(INBOX_ACCEPT.state(['open', 'open'])).toBe(false)
    expect(INBOX_ACCEPT.state([])).toBe(false)
    expect(INBOX_ACCEPT.state(['merged'])).toBe(false)
    expect(INBOX_ACCEPT.state('open')).toBe(false)
    expect(INBOX_ACCEPT.sources(['bot'])).toBe(true)
    expect(INBOX_ACCEPT.sources(['robots'])).toBe(false)
    expect(INBOX_ACCEPT.types('Comment')).toBe(false)
  })

  it('reads a save from before Source and Type held what is ticked', () => {
    const labels = ['Comment', 'Approved', 'CI failing']
    expect(upgradeInbox({ you: true, human: false, bot: true, state: 'open' }, labels)).toEqual({
      sources: ['you', 'bot'],
      // Open, saved before Queued came, keeps the queued PRs it showed.
      state: ['open', 'queued'],
    })
    // Every switch on, or none saved, is all of them.
    expect(upgradeInbox({ you: true, human: true, bot: true }, labels)).toEqual({})
    expect(upgradeInbox({ bot: false }, labels)).toEqual({ sources: ['you', 'human'] })
    expect(upgradeInbox({ hiddenTypes: ['Approved'] }, labels)).toEqual({ types: ['Comment', 'CI failing'] })
    expect(upgradeInbox({ hiddenTypes: [] }, labels)).toEqual({})
    // A save made since is left as it is.
    expect(upgradeInbox({ sources: ['bot'], types: null }, labels)).toEqual({ sources: ['bot'], types: null })
  })

  it('says why the list is empty', () => {
    expect(inboxEmptyText(0)).toMatch(/^Nothing yet/)
    expect(inboxEmptyText(3)).toBe('No events match these filters.')
  })
})

describe('the Inbox’s users', () => {
  it('puts someone with both kinds of event under the later heading, and sorts each by count, then name', () => {
    expect(
      inboxUsers([
        { who: 'cat', source: 'human', category: 'review' },
        { who: 'bob', source: 'human', category: 'review' },
        { who: 'ann', source: 'human', category: 'review' },
        { who: 'ann', source: 'you', category: 'canvas' },
        { who: 'ci', source: 'bot', category: 'review' },
        { who: 'ci', source: 'bot', category: 'ci' },
        { who: 'rabbit', source: 'bot', category: 'review' },
      ])
    ).toEqual([
      { login: 'ann', count: 2, group: 'People' },
      { login: 'bob', count: 1, group: 'People' },
      { login: 'cat', count: 1, group: 'People' },
      { login: 'rabbit', count: 1, group: 'Bots' },
      { login: 'ci', count: 2, group: 'Checks & conflicts' },
    ])
  })
})
