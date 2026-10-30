// @ts-check
import { OTHER_BASE } from './bases.js'
import { inboxFields, inboxSeed, pullFields, pullsSeed, queueFields, queueSeed } from './builder-fields.js'
import { INBOX_DEFAULTS } from './events.js'
import { sectionValues } from './integrations.js'
import { NO_REVIEWER, PULLS_DEFAULTS } from './pulls.js'
import { NO_LABEL, QUEUE_DEFAULTS } from './queue.js'

/** @param {Partial<import('./pulls.js').Pull>} o @returns {import('./pulls.js').Pull} */
const pull = o => ({
  number: 1,
  title: 't',
  url: 'u',
  isDraft: false,
  createdAt: '',
  updatedAt: '',
  headRefName: 'h',
  baseRefName: 'develop',
  reviewDecision: null,
  author: 'me',
  reviewers: [],
  ...o,
})

/** @param {string} login @param {Partial<import('./reviewers.js').Reviewer>} [extra] */
const reviewer = (login, extra = {}) => ({
  login,
  approvals: 0,
  changesRequested: 0,
  comments: 0,
  dismissed: 0,
  lastApprovalAt: null,
  lastChangeRequestAt: null,
  lastCommentAt: null,
  ...extra,
})

/** @param {Partial<import('./queue.js').QueueRow>} o @returns {import('./queue.js').QueueRow} */
const queueRow = o => ({
  number: 1,
  title: '',
  url: '',
  author: 'ada',
  readyAt: '2026-10-20T00:00:00Z',
  isDraft: false,
  headRefName: 'h',
  baseRefName: 'develop',
  labels: [],
  additions: 0,
  deletions: 0,
  requested: false,
  reviewers: [],
  canvas: 'Pending',
  codeRabbit: 'Pending',
  ...o,
})

/** @param {Partial<import('./events.js').InboxEvent>} o @returns {import('./events.js').InboxEvent} */
const event = o => ({
  id: '1',
  pr: 1,
  at: '',
  label: 'Comment',
  category: 'review',
  source: 'human',
  icon: 'comment',
  who: 'ann',
  meta: '',
  url: '',
  items: [],
  read: false,
  title: '',
  isDraft: false,
  dismissed: false,
  muted: false,
  ...o,
})

/** @type {readonly import('./branches.js').MainBranch[]} */
const branches = [
  { name: 'develop', color: 'green' },
  { name: 'main', color: 'blue' },
]

/** @template T @param {readonly T[]} items @param {number} index @returns {T} */
const at = (items, index) => {
  const item = items[index]
  if (item === undefined) throw new Error(String(index))
  return item
}
const on = { codeRabbit: true, vercel: true, canvas: true }

/** @template T @param {import('./filter-builder.js').Field<T>[]} fields @param {string} key */
const field = (fields, key) => {
  const found = fields.find(f => f.key === key)
  if (found === undefined) throw new Error(key)
  return found
}

describe('the builder’s fields', () => {
  it('writes the Review queue bar as blocks, including a review state and attention points', () => {
    expect(
      queueSeed(
        {
          ...QUEUE_DEFAULTS,
          authors: ['ada'],
          labels: ['Bug', NO_LABEL],
          reviews: ['approved'],
          authorPoints: true,
          reviewerPoints: true,
          codeRabbit: ['Ready'],
          github: [],
        },
        { on: { codeRabbit: true, vercel: true, canvas: false }, bases: ['develop'], stack: 'auth' }
      )
    ).toEqual({
      op: 'and',
      items: [
        { field: 'state', is: 'any', values: ['open', 'queued'] },
        { field: 'author', is: 'any', values: ['ada'] },
        { field: 'label', is: 'any', values: ['bug', NO_LABEL] },
        { field: 'review', is: 'any', values: ['approved'] },
        { field: 'authorPoints', is: 'any', values: ['yes'] },
        { field: 'reviewerPoints', is: 'any', values: ['yes'] },
        { field: 'base', is: 'any', values: ['develop'] },
        { field: 'stack', is: 'any', values: ['auth'] },
        {
          op: 'or',
          items: [
            { field: 'codeRabbit', is: 'any', values: ['Ready'] },
            { field: 'vercel', is: 'any', values: [...sectionValues('vercel')] },
          ],
        },
      ],
    })
  })

  it('offers a base once the repo has two, and attention points only where a row has some open', () => {
    const rows = [
      queueRow({
        author: 'ada',
        labels: ['Bug'],
        points: { author: 2, reviewer: 0 },
        baseRefName: 'develop',
        requested: true,
      }),
      queueRow({ author: 'bob', labels: [], baseRefName: 'feature', points: { author: 0, reviewer: 3 } }),
    ]
    const fields = queueFields({ on, branches })
    const base = field(fields, 'base')
    expect(base.options(rows)).toEqual([
      ['develop', 'develop'],
      ['main', 'main'],
      [OTHER_BASE, 'Other branches'],
    ])
    expect(base.values(at(rows, 0))).toEqual(['develop'])
    expect(base.values(at(rows, 1))).toEqual([OTHER_BASE])
    const author = field(fields, 'authorPoints')
    expect(author.label).toBe('Author attention points')
    expect(author.values(at(rows, 0))).toEqual(['yes'])
    expect(author.values(at(rows, 1))).toEqual(['no'])
    // No canvas to count counts as none.
    expect(author.values(queueRow({}))).toEqual(['no'])
    const reviewerPoints = field(fields, 'reviewerPoints')
    expect(reviewerPoints.label).toBe('Reviewer attention points')
    expect(reviewerPoints.values(at(rows, 0))).toEqual(['no'])
    expect(reviewerPoints.values(at(rows, 1))).toEqual(['yes'])
    expect(reviewerPoints.values(queueRow({}))).toEqual(['no'])
    expect(fields.map(f => f.key)).not.toContain('pending')
    // Both tables have the same two.
    const pullKeys = pullFields({ on, branches, stacks: {}, health: {}, statuses: {}, points: {} }).map(
      f => f.key
    )
    expect(pullKeys).toEqual(expect.arrayContaining(['authorPoints', 'reviewerPoints']))
    expect(pullKeys).not.toContain('pending')
    expect(pullKeys).not.toContain('waiting')
    expect(field(fields, 'label').values(at(rows, 0))).toEqual(['bug'])
    expect(field(fields, 'label').values(at(rows, 1))).toEqual([NO_LABEL])
    field(fields, 'label').options(rows)
    field(fields, 'author').options(rows)
    field(fields, 'github').values(at(rows, 0))
    field(fields, 'github').values(queueRow({}))
  })

  it('writes Your PRs the same way, without the queue’s “awaits you”', () => {
    expect(
      pullsSeed(
        { ...PULLS_DEFAULTS, reviews: ['approved'], reviewerPoints: true, reviewers: ['sam'] },
        { on: { codeRabbit: false, vercel: false, canvas: false }, bases: null, stack: '' }
      )
    ).toEqual({
      op: 'and',
      items: [
        { field: 'state', is: 'any', values: ['open', 'queued'] },
        { field: 'review', is: 'any', values: ['approved'] },
        { field: 'reviewerPoints', is: 'any', values: ['yes'] },
        { field: 'reviewer', is: 'any', values: ['sam'] },
      ],
    })
    const pulls = [
      pull({ number: 1, baseRefName: 'feature' }),
      pull({ number: 2, labels: ['Bug'], reviewers: [reviewer('sam')] }),
      pull({ number: 3, baseRefName: 'feature', labels: [] }),
    ]
    const fields = pullFields({
      on,
      branches,
      stacks: { 1: { name: 'auth', total: 2 }, 3: { name: 'solo', total: 1 } },
      health: { 2: { ci: 'failing', failing: 1, stuck: null, conflict: true } },
      statuses: { 2: { canvas: 'Ready', codeRabbit: 'Outdated' } },
      points: { 2: { author: 1, reviewer: 0 } },
    })
    // The branch a PR targets itself: one into a feature branch is on Other branches, stacked or not.
    const base = field(fields, 'base')
    expect(base.values(at(pulls, 0))).toEqual([OTHER_BASE])
    expect(base.values(at(pulls, 1))).toEqual(['develop'])
    expect(base.values(at(pulls, 2))).toEqual([OTHER_BASE])
    // The Stack filter's stacks: a stack of one PR is none.
    const stack = field(fields, 'stack')
    expect(stack.options(pulls)).toEqual([['auth', 'auth']])
    expect(stack.values(at(pulls, 0))).toEqual(['auth'])
    expect(stack.values(at(pulls, 1))).toEqual([])
    expect(stack.values(at(pulls, 2))).toEqual([])
    const reviewers = field(fields, 'reviewer')
    expect(reviewers.options(pulls)).toContainEqual([NO_REVIEWER, 'No reviewers'])
    expect(reviewers.options(pulls)).toContainEqual(['sam', 'sam', 'People'])
    expect(reviewers.values(at(pulls, 0))).toEqual([NO_REVIEWER])
    expect(reviewers.values(at(pulls, 1))).toEqual(['sam'])
    const label = field(fields, 'label')
    label.options(pulls)
    expect(label.values(at(pulls, 0))).toEqual([NO_LABEL])
    expect(label.values(at(pulls, 1))).toEqual(['bug'])
    expect(label.values(at(pulls, 2))).toEqual([NO_LABEL])
    expect(field(fields, 'authorPoints').values(at(pulls, 0))).toEqual(['no'])
    expect(field(fields, 'authorPoints').values(at(pulls, 1))).toEqual(['yes'])
    expect(field(fields, 'reviewerPoints').values(at(pulls, 1))).toEqual(['no'])
    field(fields, 'codeRabbit').values(at(pulls, 0))
    field(fields, 'codeRabbit').values(at(pulls, 1))
    field(fields, 'github').values(at(pulls, 0))
    field(fields, 'github').values(at(pulls, 1))
  })

  it('writes the Inbox bar, and counts who shows up most', () => {
    expect(
      inboxSeed({
        ...INBOX_DEFAULTS,
        state: ['open', 'queued'],
        sources: ['bot'],
        types: ['Comment'],
        authors: ['ann'],
        dismissed: true,
        chatter: false,
        notifying: true,
      })
    ).toEqual({
      op: 'and',
      items: [
        { field: 'state', is: 'any', values: ['open', 'queued'] },
        { field: 'source', is: 'any', values: ['bot'] },
        { field: 'type', is: 'any', values: ['Comment'] },
        { field: 'user', is: 'any', values: ['ann'] },
        { field: 'chatter', is: 'any', values: ['no'] },
        { field: 'notifying', is: 'any', values: ['yes'] },
      ],
    })
    const events = [
      event({ who: 'bob', source: 'canvas' }),
      event({ who: 'ann', source: 'human', read: true, dismissed: true, chatter: true, notifies: true }),
      event({ who: 'bob', source: 'bot' }),
      event({ who: 'ann', source: 'you' }),
      event({ who: 'cara' }),
    ]
    const fields = inboxFields({ labels: ['Comment', 'Review'] })
    expect(events.map(e => field(fields, 'source').values(e)[0])).toEqual([
      'human',
      'human',
      'bot',
      'you',
      'human',
    ])
    // People, then bots (bob has a bot's event), as on the Users picker.
    expect(field(fields, 'user').options(events)).toEqual([
      ['ann', 'ann', 'People'],
      ['cara', 'cara', 'People'],
      ['bob', 'bob', 'Bots'],
    ])
    for (const key of /** @type {const} */ (['read', 'dismissed', 'chatter', 'notifying'])) {
      expect(field(fields, key).values(at(events, 1))).toEqual(['yes'])
      expect(field(fields, key).values(at(events, 0))).toEqual(['no'])
    }
    field(fields, 'type').options(events)
    field(fields, 'type').values(at(events, 0))
    field(fields, 'state').values(event({ isDraft: true }))
  })
})
