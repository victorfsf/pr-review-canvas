// @ts-check
import { asOf } from './ready.js'

describe('the Ready column’s clock', () => {
  it('counts to when GitHub was last read, else to when the page loaded', () => {
    expect(asOf('2026-10-28T10:00:00Z', 5)).toBe(Date.parse('2026-10-28T10:00:00Z'))
    expect([asOf(null, 5), asOf(undefined, 5), asOf('not a time', 5)]).toEqual([5, 5, 5])
  })
})
