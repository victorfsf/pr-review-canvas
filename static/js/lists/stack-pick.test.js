// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  activeStack,
  byStackPosition,
  filterStack,
  picksStack,
  shownStack,
  stackNames,
} from './stack-pick.js'

const pulls = [
  { n: 1, stack: { name: 'a', total: 2 } },
  { n: 2, stack: { name: 'a', total: 2 } },
  { n: 3, stack: { name: 'b', total: 1 } },
  { n: 4 },
]

describe('stack filter', () => {
  it('lists stacks of more than one PR', () => expect(stackNames(pulls)).toEqual(['a']))
  it('keeps the PRs of the stack picked', () =>
    expect(filterStack(pulls, 'a', p => p.stack).map(p => p.n)).toEqual([1, 2]))
  it('keeps every PR when none is picked', () => expect(filterStack(pulls, '', p => p.stack)).toHaveLength(4))
  it('treats a gone stack as none', () => expect(activeStack('zz', ['a'])).toBe(''))
})

describe('one stack in its order', () => {
  const placed = [
    { n: 7, stack: { name: 'a', position: 3, total: 3 } },
    { n: 5 },
    { n: 9, stack: { name: 'a', position: 1, total: 3 } },
    { n: 8, stack: { name: 'a', position: 2, total: 3 } },
  ]
  it('orders by place in the stack, PRs in none after', () =>
    expect(byStackPosition(placed, p => p.stack).map(p => p.n)).toEqual([9, 8, 7, 5]))
  it('asks for a stack by the Stack filter or a builder condition on it', () => {
    expect(picksStack({ builder: false, where: '', stack: 'a' }, ['a'])).toBe(true)
    expect(picksStack({ builder: false, where: '', stack: '' }, ['a'])).toBe(false)
    const where = (/** @type {string} */ is) =>
      JSON.stringify({ op: 'and', items: [{ op: 'or', items: [{ field: 'stack', is, values: ['a'] }] }] })
    expect(picksStack({ builder: true, where: where('any'), stack: '' }, ['a'])).toBe(true)
    expect(picksStack({ builder: true, where: where('none'), stack: '' }, ['a'])).toBe(false)
    // The Stack filter, which a row's place sets, keeps the list to its stack beside the builder too.
    expect(picksStack({ builder: true, where: where('none'), stack: 'a' }, ['a'])).toBe(true)
  })
  it('names the one stack shown, one of its PRs included, when asked', () => {
    const a = placed.filter(p => p.stack !== undefined)
    expect(shownStack(a, p => p.stack, true)).toBe('a')
    expect(shownStack(a, p => p.stack, false)).toBeNull()
    expect(shownStack(placed, p => p.stack, true)).toBeNull()
    expect(shownStack(a.slice(0, 1), p => p.stack, true)).toBe('a')
    expect(shownStack(a.slice(0, 0), p => p.stack, true)).toBeNull()
  })
})
