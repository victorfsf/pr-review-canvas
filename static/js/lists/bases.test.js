// @ts-check
import { activeBases, filterBases, OTHER_BASE, placeOf, STACKED_BASE } from './bases.js'

const ONE = [{ name: 'main', color: /** @type {const} */ ('green') }]
const TWO = [...ONE, { name: 'develop', color: /** @type {const} */ ('blue') }]

describe('the Base filter', () => {
  it('filters by nothing while the repo has one base, or by a base it no longer has', () => {
    expect(activeBases(['main'], ONE)).toBeNull()
    expect(activeBases(['main', 'release'], TWO)).toEqual(['main'])
    expect(activeBases(null, TWO)).toBeNull()
    // Every base ticked, and stacked and other branches, is all of them.
    expect(activeBases(['develop', STACKED_BASE, OTHER_BASE, 'main'], TWO)).toBeNull()
    expect(activeBases(['develop', OTHER_BASE, 'main'], TWO)).toEqual(['develop', OTHER_BASE, 'main'])
  })

  it('places a PR on its base, under Stacked when it sits on another PR, else under Other', () => {
    expect(placeOf({ baseRefName: 'develop' }, TWO)).toBe('develop')
    // A stack's root on a base branch is on that branch; the PRs on it are stacked.
    expect(placeOf({ baseRefName: 'develop', stack: { position: 1 } }, TWO)).toBe('develop')
    expect(placeOf({ baseRefName: 'feature/a', stack: { position: 2 } }, TWO)).toBe(STACKED_BASE)
    // Alone on another branch, or at the foot of a stack on one: Other.
    expect(placeOf({ baseRefName: 'feature/gone', stack: { position: 1 } }, TWO)).toBe(OTHER_BASE)
    expect(placeOf({ baseRefName: 'feature/a' }, TWO)).toBe(OTHER_BASE)
  })

  it('keeps the PRs under the choices ticked', () => {
    const pulls = [
      { n: 1, baseRefName: 'develop' },
      { n: 2, baseRefName: 'main' },
      { n: 3, baseRefName: 'feature/a', stack: { position: 2 } },
      { n: 4, baseRefName: 'feature/x' },
    ]
    expect(filterBases(pulls, ['develop'], TWO).map(p => p.n)).toEqual([1])
    expect(filterBases(pulls, ['develop', STACKED_BASE], TWO).map(p => p.n)).toEqual([1, 3])
    expect(filterBases(pulls, ['develop', OTHER_BASE], TWO).map(p => p.n)).toEqual([1, 4])
    expect(filterBases(pulls, null, TWO).map(p => p.n)).toEqual([1, 2, 3, 4])
    expect(filterBases(pulls, [], TWO).map(p => p.n)).toEqual([])
    expect(filterBases(pulls, ['develop'], ONE).map(p => p.n)).toEqual([1, 2, 3, 4])
    expect(
      filterBases(pulls, [STACKED_BASE], TWO, p => (p.n === 4 ? { position: 3 } : undefined)).map(p => p.n)
    ).toEqual([4])
  })
})
