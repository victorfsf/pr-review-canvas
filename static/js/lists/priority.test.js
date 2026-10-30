import { prioritySummary } from './priority.js'

describe('prioritySummary', () => {
  it('says one PR in the singular, and which prompt is in use', () => {
    expect(prioritySummary({ active: 'Default', count: 1 })).toBe('1 PR · Default')
    expect(prioritySummary({ active: 'Security first', count: 4 })).toBe('4 PRs · Security first')
  })
})
