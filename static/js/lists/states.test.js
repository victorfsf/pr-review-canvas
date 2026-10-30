// @ts-check
import {
  ALL_STATES,
  acceptStates,
  emptyBy,
  inOrder,
  OPEN_STATES,
  readyCompare,
  readySince,
  sameStates,
  stateLabel,
  stateOf,
  upgradeState,
} from './states.js'

describe('a PR’s state', () => {
  it('is a draft, else in the merge queue, else open', () => {
    expect(stateOf({ isDraft: true, queuedAt: '2026-10-28T10:00:00Z' })).toBe('draft')
    expect(stateOf({ isDraft: false, queuedAt: '2026-10-28T10:00:00Z' })).toBe('queued')
    expect(stateOf({ isDraft: false, queued: true })).toBe('queued')
    expect(stateOf({ isDraft: false, queuedAt: null })).toBe('open')
    expect(stateOf({ isDraft: false })).toBe('open')
  })

  it('accepts states it knows, each once, at least one, and reads the old words', () => {
    expect([acceptStates(['open', 'queued']), acceptStates([]), acceptStates(['open', 'open'])]).toEqual([
      true,
      false,
      false,
    ])
    expect([acceptStates(['merged']), acceptStates('open')]).toEqual([false, false])
    expect(upgradeState('open')).toEqual(OPEN_STATES)
    expect(upgradeState('draft')).toEqual(['draft'])
    expect(upgradeState('both')).toEqual(ALL_STATES)
    expect(upgradeState(['both'])).toEqual(ALL_STATES)
    expect(upgradeState(['open'])).toEqual(['open'])
  })

  it('names, orders and compares what is ticked', () => {
    expect([stateLabel(ALL_STATES), stateLabel(OPEN_STATES), stateLabel(['draft'])]).toEqual([
      'All',
      'Open, Queued',
      'Draft',
    ])
    expect(stateLabel(['odd'])).toBe('odd')
    expect(inOrder(['queued', 'open'])).toEqual(['open', 'queued'])
    expect([sameStates(['queued', 'open'], OPEN_STATES), sameStates(['open'], OPEN_STATES)]).toEqual([
      true,
      false,
    ])
  })

  it('picks the empty line by what is ticked', () => {
    const lines = { open: 'o', draft: 'd', queued: 'q', all: 'a' }
    expect([
      emptyBy(['draft'], lines),
      emptyBy(['open', 'draft'], lines),
      emptyBy(['queued'], lines),
      emptyBy(['open', 'queued'], lines),
      emptyBy(['open'], lines),
    ]).toEqual(['d', 'a', 'q', 'o', 'o'])
  })

  it('orders the Ready column: the longest queued first, then the longest ready', () => {
    const old = { createdAt: '2026-10-01T00:00:00Z', readyAt: '2026-10-02T00:00:00Z' }
    const fresh = { createdAt: '2026-10-20T00:00:00Z', readyAt: '' }
    const queuedLong = { createdAt: '2026-10-25T00:00:00Z', queuedAt: '2026-10-27T00:00:00Z' }
    const queuedNow = { createdAt: '2026-10-25T00:00:00Z', queuedAt: '2026-10-28T00:00:00Z' }
    expect([fresh, queuedNow, old, queuedLong].sort(readyCompare)).toEqual([
      queuedLong,
      queuedNow,
      old,
      fresh,
    ])
    expect([readySince(fresh), readySince(old), readySince({})]).toEqual([
      '2026-10-20T00:00:00Z',
      '2026-10-02T00:00:00Z',
      '',
    ])
  })
})
