// @ts-check
import { nextSort, sortAccept, sortBy, sortMark, sortState, withoutColumns } from './sorting.js'

describe('sorting', () => {
  it('takes a column from out, to ascending at the end, to descending in place, to out', () => {
    expect(nextSort([], 'author')).toEqual(['author'])
    expect(nextSort(['ready'], 'author')).toEqual(['ready', 'author'])
    expect(nextSort(['author', 'ready'], 'author')).toEqual(['-author', 'ready'])
    expect(nextSort(['-author', 'ready'], 'author')).toEqual(['ready'])
  })

  it('says where a column sits, and marks it', () => {
    expect(sortState(['ready', '-author'], 'author')).toEqual({ place: 2, desc: true })
    expect(sortState(['ready'], 'author')).toEqual({ place: 0, desc: false })
    expect([sortMark([], 'pr'), sortMark(['pr'], 'pr'), sortMark(['ready', '-pr'], 'pr')]).toEqual([
      '↕',
      '↑',
      '↓2',
    ])
  })

  it('takes back only known columns, each once', () => {
    const accept = sortAccept(['pr', 'ready'])
    expect(accept(['pr', '-ready'])).toBe(true)
    expect(accept(['pr', '-pr'])).toBe(false)
    expect(accept(['stars'])).toBe(false)
    expect(accept([1])).toBe(false)
    expect(accept('pr')).toBe(false)
  })

  it('sorts by each step in turn, skips a column it cannot compare, and keeps ties in order', () => {
    const rows = [
      { n: 1, a: 'b', b: 2 },
      { n: 2, a: 'a', b: 2 },
      { n: 3, a: 'b', b: 1 },
    ]
    /** @typedef {{ n: number, a: string, b: number }} Row */
    const compare = {
      a: (/** @type {Row} */ x, /** @type {Row} */ y) => x.a.localeCompare(y.a),
      b: (/** @type {Row} */ x, /** @type {Row} */ y) => x.b - y.b,
    }
    expect(sortBy(rows, ['a', 'b'], compare).map(r => r.n)).toEqual([2, 3, 1])
    expect(sortBy(rows, ['-b', 'gone'], compare).map(r => r.n)).toEqual([1, 2, 3])
    expect(sortBy(rows, [], compare)).not.toBe(rows)
  })
})

describe('withoutColumns', () => {
  it('drops the columns named, either way, and keeps the rest in order', () => {
    expect(withoutColumns(['status', '-labels', 'author', 'labels2'], new Set(['labels', 'author']))).toEqual(
      ['status', 'labels2']
    )
    expect(withoutColumns(['-pr'], new Set())).toEqual(['-pr'])
  })
})
