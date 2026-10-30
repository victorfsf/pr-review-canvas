// @ts-check
import {
  authorCounts,
  authorsLabel,
  filterQueue,
  isFiltered,
  labelChoices,
  labelCounts,
  NO_LABEL,
  pickedLabel,
  QUEUE_ACCEPT,
  QUEUE_DEFAULTS,
  queueAuthors,
  upgradeQueue,
  sortQueue,
} from './queue.js'
import { DEFAULT_SECTIONS, groupBySection, sectionOf, sectionsMatched, sectionTone } from './sections.js'

/** @param {Partial<import('./queue.js').QueueRow>} o @returns {import('./queue.js').QueueRow} */
const row = o => ({
  number: 1,
  title: 'Their change',
  url: 'https://github.com/acme/widgets/pull/1',
  author: 'alice',
  isDraft: false,
  readyAt: '2026-10-20T00:00:00Z',
  headRefName: 'h',
  baseRefName: 'develop',
  labels: [],
  additions: 1,
  deletions: 1,
  requested: false,
  reviewers: [],
  canvas: 'Pending',
  codeRabbit: 'Pending',
  ...o,
})

describe('sections', () => {
  const sections = [
    { name: 'Critical', labels: ['Critical'] },
    { name: 'Bugs', labels: ['bug', 'regression'] },
    // The catch-all's labels never match.
    { name: 'Tasks', labels: ['chore'] },
  ]

  it('puts a PR in the first section with any of its labels, ignoring case, else the last', () => {
    expect(sectionOf(['BUG', 'critical'], sections)).toBe(0)
    expect(sectionOf(['Regression'], sections)).toBe(1)
    expect(sectionOf(['chore'], sections)).toBe(2)
    expect(sectionOf([], sections)).toBe(2)
    expect(sectionOf(['x'], [{ name: 'All', labels: [] }])).toBe(0)
  })

  it('names every section a PR matches, so the editor can say which wins', () => {
    expect(sectionsMatched(['bug', 'Critical', 'chore'], sections)).toEqual([0, 1])
    expect(sectionsMatched([], sections)).toEqual([])
  })

  it('colors sections in order and the catch-all with the accent', () => {
    expect([0, 1, 2, 3, 4, 5].map(i => sectionTone(i, 6))).toEqual([
      'bad',
      'warn',
      'done',
      'ok',
      'bad',
      'acc',
    ])
    expect(sectionTone(0, 1)).toBe('acc')
  })

  it('colors a section with its own color when it has one, wherever it is', () => {
    expect(sectionTone(0, 3, 'blue')).toBe('info')
    expect(sectionTone(2, 3, 'red')).toBe('bad')
    expect(sectionTone(1, 3, 'gray')).toBe('acc')
    expect(sectionTone(1, 3)).toBe('warn')
  })

  it('groups items', () => {
    const groups = groupBySection([{ labels: ['bug'] }, {}, { labels: ['Critical'] }], DEFAULT_SECTIONS)
    expect(groups.map(g => [g.section.name, g.index, g.items.length])).toEqual([
      ['Critical', 0, 1],
      ['Bugs', 1, 1],
      ['Tasks', 2, 1],
    ])
  })
})

describe('filterQueue', () => {
  const rows = [
    row({
      number: 1,
      author: 'alice',
      labels: ['bug'],
      canvas: 'Ready',
      codeRabbit: 'Ready',
      requested: true,
      health: { ci: 'failing', failing: 1, stuck: null, conflict: false },
    }),
    row({
      number: 2,
      author: 'bob',
      labels: ['Frontend'],
      canvas: 'Ready',
      codeRabbit: 'Outdated',
      health: {
        ci: 'running',
        failing: 0,
        stuck: 'no checks started',
        conflict: true,
        preview: { state: 'ready', url: 'https://bob.example.app' },
      },
    }),
    row({ number: 3, author: 'carol', canvas: 'Stale', codeRabbit: 'Skipped' }),
    row({ number: 4, author: 'dave', isDraft: true }),
  ]
  const shown = (/** @type {Partial<typeof QUEUE_DEFAULTS>} */ f, codeRabbit = true, vercel = true) =>
    filterQueue(rows, { ...QUEUE_DEFAULTS, ...f }, codeRabbit, vercel).map(r => r.number)
  /** The Integrations choices ticked: `picked`'s, none in the other sections. */
  const only = (/** @type {Partial<typeof QUEUE_DEFAULTS>} */ picked) => ({
    codeRabbit: [],
    vercel: [],
    github: [],
    canvas: [],
    ...picked,
  })

  it('keeps every open PR with no filter, and narrows with each one', () => {
    expect(shown({})).toEqual([1, 2, 3])
    expect(shown({ state: ['draft'] })).toEqual([4])
    expect(shown({ state: ['open', 'draft', 'queued'] })).toEqual([1, 2, 3, 4])
    expect(shown({ authors: ['alice', 'carol'] })).toEqual([1, 3])
    // Need a restack or an update: none of these do, so none stay; unchecked, the filter is not there.
    expect(shown({ needsUpdate: true })).toEqual([])
    expect(shown({ needsUpdate: false })).toEqual([1, 2, 3])
    const flagged = rows.map(r =>
      r.number === 2 ? { ...r, restack: true } : r.number === 3 ? { ...r, update: { conflict: false } } : r
    )
    expect(filterQueue(flagged, { ...QUEUE_DEFAULTS, needsUpdate: true }, true).map(r => r.number)).toEqual([
      2, 3,
    ])
    // None ticked keeps none.
    expect(shown({ authors: [] })).toEqual([])
    expect(shown({ labels: [] })).toEqual([])
    expect(shown(only({}))).toEqual([])
    expect(shown({ labels: [NO_LABEL] })).toEqual([3])
    expect(shown({ labels: ['frontend', 'bug'] })).toEqual([1, 2])
    // The Integrations filter keeps a PR with any ticked choice, from any section. A PR no sync has
    // read (#3) has no CI, merge or Vercel state to match.
    expect(shown(only({ github: ['failing', 'stuck'] }))).toEqual([1, 2])
    expect(shown(only({ github: ['stuck'], canvas: ['Stale'] }))).toEqual([2, 3])
    expect(shown(only({ canvas: ['Stale'] }))).toEqual([3])
    expect(shown(only({ codeRabbit: ['Skipped', 'Outdated'] }))).toEqual([2, 3])
    // #2's checks run but are stuck, so it is not CI running.
    expect(shown(only({ github: ['running'] }))).toEqual([])
    expect(shown(only({ github: ['noConflict'] }))).toEqual([1])
    expect(shown(only({ vercel: ['vercelReady'] }))).toEqual([2])
    expect(shown(only({ vercel: ['vercelFailed'] }))).toEqual([])
    // With the rest ticked, every PR still has some ticked choice.
    expect(shown({ github: [] })).toEqual([1, 2, 3])
    // Across filters, each must hold.
    expect(shown({ authors: ['bob'], ...only({ canvas: ['Ready'] }) })).toEqual([2])
  })

  it('keeps by Reviews: a ticked review state and whether it awaits you, each group that has one, and each flag', () => {
    const states = ['approved', 'changesRequested', 'commented', 'none']
    // From everything ticked, unticking Not awaiting your review keeps what awaits you.
    expect(shown({ reviews: [...states, 'requested'] })).toEqual([1])
    expect(shown({ reviews: [...states, 'notRequested'] })).toEqual([2, 3])
    // A group with none ticked is left out; none ticked at all keeps nothing.
    expect(shown({ reviews: ['requested'] })).toEqual([1])
    expect(shown({ reviews: [] })).toEqual([])
    // Nobody reviewed these yet: No review keeps them all, Approved none, whatever awaits you.
    expect(shown({ reviews: ['none'] })).toEqual([1, 2, 3])
    expect(shown({ reviews: ['approved', 'requested'] })).toEqual([])
    expect(shown({ reviews: ['none', 'requested'] })).toEqual([1])
    // A flag must hold as well: none of these has a canvas, so no open attention points.
    expect(shown({ authorPoints: true })).toEqual([])
    expect(shown({ reviewerPoints: true })).toEqual([])
    expect(isFiltered({ ...QUEUE_DEFAULTS, authorPoints: true })).toBe(true)
    expect(isFiltered({ ...QUEUE_DEFAULTS, reviewerPoints: true })).toBe(true)
    expect(isFiltered({ ...QUEUE_DEFAULTS, reviews: ['requested'] })).toBe(true)
  })

  it('keeps by the attention point flags: each one checked needs its count open, both need both', () => {
    const pointed = [
      row({ number: 1, points: { author: 2, reviewer: 0 } }),
      row({ number: 2, points: { author: 0, reviewer: 1 } }),
      row({ number: 3, points: { author: 1, reviewer: 1 } }),
      row({ number: 4, points: { author: 0, reviewer: 0 } }),
      row({ number: 5 }),
    ]
    const kept = (/** @type {Partial<typeof QUEUE_DEFAULTS>} */ f) =>
      filterQueue(pointed, { ...QUEUE_DEFAULTS, ...f }, true, true).map(r => r.number)
    expect(kept({})).toEqual([1, 2, 3, 4, 5])
    expect(kept({ authorPoints: true })).toEqual([1, 3])
    expect(kept({ reviewerPoints: true })).toEqual([2, 3])
    expect(kept({ authorPoints: true, reviewerPoints: true })).toEqual([3])
    expect([QUEUE_ACCEPT.authorPoints(true), QUEUE_ACCEPT.reviewerPoints('yes')]).toEqual([true, false])
  })

  it('moves an old save’s Awaiting your review from the GitHub choices to Reviews', () => {
    expect(upgradeQueue({ github: ['requested', 'failing'] })).toEqual({
      github: ['failing'],
      reviews: ['requested'],
    })
    expect(upgradeQueue({ github: ['requested'] })).toEqual({ github: null, reviews: ['requested'] })
    expect(upgradeQueue({ github: ['failing'] })).toEqual({ github: ['failing'] })
  })

  it('ignores CodeRabbit or Vercel when the repo does not use it', () => {
    expect(shown({ codeRabbit: ['Skipped'] }, false)).toEqual([1, 2, 3])
    expect(shown({ vercel: ['vercelFailed'] }, true, false)).toEqual([1, 2, 3])
  })

  it('tells filters from the sort for Reset', () => {
    expect(isFiltered(QUEUE_DEFAULTS)).toBe(false)
    expect(isFiltered({ ...QUEUE_DEFAULTS, sort: ['labels', '-ready'] })).toBe(false)
    for (const f of [
      { authors: ['a'] },
      { labels: ['x'] },
      { canvas: ['Ready'] },
      { codeRabbit: ['Ready'] },
      { github: ['conflict'] },
      { vercel: ['vercelReady'] },
      { state: /** @type {import('./pulls.js').StateFilter} */ (['open', 'draft', 'queued']) },
    ]) {
      expect(isFiltered({ ...QUEUE_DEFAULTS, ...f })).toBe(true)
    }
  })

  it('accepts only values it knows from storage', () => {
    expect(QUEUE_ACCEPT.canvas(['Ready', 'Skipped'])).toBe(false)
    expect([
      QUEUE_ACCEPT.state(['draft']),
      QUEUE_ACCEPT.state(['merged']),
      QUEUE_ACCEPT.state('draft'),
    ]).toEqual([true, false, false])
    expect(QUEUE_ACCEPT.codeRabbit(['Skipped'])).toBe(true)
    expect(QUEUE_ACCEPT.authors(['a', 1])).toBe(false)
    expect(QUEUE_ACCEPT.sort(['labels', '-ready'])).toBe(true)
    expect(QUEUE_ACCEPT.sort([])).toBe(true)
    // A sort saved before columns stacked was one key: it falls back to no sorting.
    expect(QUEUE_ACCEPT.sort('labels')).toBe(false)
    expect(QUEUE_ACCEPT.sort(['loc'])).toBe(false)
    expect(QUEUE_ACCEPT.sort(['ready', '-ready'])).toBe(false)
  })
})

describe('sortQueue', () => {
  const rows = [
    row({
      number: 1,
      author: 'bob',
      readyAt: '2026-10-21T00:00:00Z',
      labels: ['b'],
      additions: 5,
      deletions: 5,
      canvas: 'Pending',
      codeRabbit: 'Skipped',
    }),
    row({
      number: 2,
      author: 'Alice',
      readyAt: '2026-10-19T00:00:00Z',
      labels: ['c'],
      additions: 1,
      deletions: 1,
      canvas: 'Ready',
      codeRabbit: 'Outdated',
    }),
    row({
      number: 3,
      author: 'carol',
      readyAt: '2026-10-20T00:00:00Z',
      labels: ['a'],
      additions: 50,
      deletions: 0,
      canvas: 'Stale',
      codeRabbit: 'Ready',
    }),
  ]
  const order = (/** @type {string[]} */ sort) => sortQueue(rows, sort).map(r => r.number)

  it('sorts by each column, both ways, and keeps the order with no sort', () => {
    expect(order([])).toEqual([1, 2, 3])
    expect(order(['pr'])).toEqual([1, 2, 3])
    expect(order(['-pr'])).toEqual([3, 2, 1])
    expect(order(['author'])).toEqual([2, 1, 3])
    expect(order(['ready'])).toEqual([2, 3, 1])
    expect(order(['-ready'])).toEqual([1, 3, 2])
    expect(order(['labels'])).toEqual([3, 1, 2])
    expect(order(['canvas'])).toEqual([2, 3, 1])
    expect(order(['codeRabbit'])).toEqual([3, 2, 1])
    // By open attention points, both kinds together; no canvas sorts below none open.
    const pointed = [
      row({ number: 1, points: { author: 1, reviewer: 1 } }),
      row({ number: 2 }),
      row({ number: 3, points: { author: 0, reviewer: 0 } }),
      row({ number: 4, points: { author: 0, reviewer: 3 } }),
    ]
    expect(sortQueue(pointed, ['points']).map(r => r.number)).toEqual([2, 3, 1, 4])
    expect(sortQueue(pointed, ['-points']).map(r => r.number)).toEqual([4, 1, 3, 2])
    // Pending is no column now, so no sort.
    expect(QUEUE_ACCEPT.sort(['pending'])).toBe(false)
  })

  it('stacks columns, the first deciding first, and keeps ties in their order', () => {
    const tied = [
      row({ number: 9, author: 'bob', canvas: 'Ready' }),
      row({ number: 8, author: 'amy', canvas: 'Pending' }),
      row({ number: 7, author: 'bob', canvas: 'Pending' }),
      row({ number: 6, author: 'amy', canvas: 'Ready' }),
    ]
    const by = (/** @type {string[]} */ sort) => sortQueue(tied, sort).map(r => r.number)
    expect(by(['author'])).toEqual([8, 6, 9, 7])
    expect(by(['author', 'canvas'])).toEqual([6, 8, 9, 7])
    expect(by(['canvas', '-author'])).toEqual([9, 6, 7, 8])
  })

  it('puts what needs you first when Status sorts ascending', () => {
    const health = (/** @type {Partial<import('./health.js').Health>} */ o) => ({
      ci: /** @type {const} */ ('passing'),
      failing: 0,
      stuck: null,
      conflict: false,
      ...o,
    })
    const rowsByHealth = [
      row({ number: 1, health: health({}) }),
      row({ number: 2 }),
      row({ number: 3, health: health({ conflict: true }) }),
      row({ number: 4, health: health({ ci: 'failing', failing: 1 }) }),
      row({ number: 5, health: health({ ci: 'running', stuck: 'checks queued, none running' }) }),
      row({ number: 6, health: health({ ci: 'running' }) }),
      row({ number: 7, health: health({ ci: 'none' }) }),
    ]
    expect(sortQueue(rowsByHealth, ['status']).map(r => r.number)).toEqual([4, 3, 5, 6, 1, 7, 2])
  })
})

describe('pickers', () => {
  it('counts authors and labels, most first', () => {
    const rows = [
      row({ author: 'bob', labels: ['bug', 'BUG'] }),
      row({ author: 'alice', labels: ['Bug'] }),
      row({ author: 'bob' }),
    ]
    expect(authorCounts(rows)).toEqual([
      { login: 'bob', count: 2 },
      { login: 'alice', count: 1 },
    ])
    // The queue's picker puts bots under their own heading, after people.
    const withBots = [
      ...rows,
      row({ author: 'renovate', authorBot: true }),
      row({ author: 'dependabot[bot]' }),
    ]
    expect(queueAuthors(withBots)).toEqual([
      { login: 'bob', count: 2, group: 'People' },
      { login: 'alice', count: 1, group: 'People' },
      { login: 'dependabot[bot]', count: 1, group: 'Bots' },
      { login: 'renovate', count: 1, group: 'Bots' },
    ])
    expect(labelCounts([...rows, row({ labels: ['docs'] })])).toEqual([
      { name: 'bug', count: 2 },
      { name: 'docs', count: 1 },
    ])
    // The Labels filter offers No labels first, and keeps a ticked label no PR carries now.
    expect(labelChoices([row({ labels: [] }), row({ labels: ['bug'] })], ['gone', 'BUG'])).toEqual([
      { value: NO_LABEL, text: 'No labels', count: 1 },
      { value: 'bug', text: 'bug', count: 1 },
      { value: 'gone', text: 'gone', count: 0 },
    ])
  })

  it('says what a picker holds', () => {
    expect(pickedLabel(null)).toBe('All')
    expect(pickedLabel([])).toBe('None')
    expect(pickedLabel(['bug'])).toBe('bug')
    expect(pickedLabel(['bug', 'docs'])).toBe('2 chosen')
    expect(pickedLabel(['bug', 'docs'], 5)).toBe('2 of 5')
    expect(pickedLabel(['bug', 'docs'], 2)).toBe('All')
    const saved = [{ name: 'Squad', logins: ['alice', 'bob'] }]
    expect(authorsLabel(null, saved)).toBe('Everyone')
    expect(authorsLabel([], saved)).toBe('Nobody')
    expect(authorsLabel(['bob', 'alice'], saved)).toBe('Squad · 2 people')
    expect(authorsLabel(['alice'], saved)).toBe('alice')
    expect(authorsLabel(['alice'], [{ name: 'Me', logins: ['alice'] }])).toBe('Me · 1 person')
    expect(authorsLabel(['alice', 'carol'], saved)).toBe('2 people')
  })
})
