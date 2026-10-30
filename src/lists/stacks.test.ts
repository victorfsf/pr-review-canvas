import { makeListPull as makePull } from './testing.js'
import { stackPositions, stacksOf } from './stacks.js'

const MAIN = ['develop', 'hotfix']

/** A PR from `head` into `base`. */
const pr = (number: number, head: string, base: string, overrides: Parameters<typeof makePull>[0] = {}) =>
  makePull({ number, headRefName: head, baseRefName: base, ...overrides })

const shape = (stacks: ReturnType<typeof stacksOf>) =>
  stacks.map(s => ({ name: s.name, base: s.base, members: s.members.map(m => [m.number, m.on]) }))

describe('stacksOf', () => {
  it('links a chain root first and leaves a lone PR on a main branch out', () => {
    const pulls = [
      pr(12, 'limits-3', 'limits-2'),
      pr(10, 'limits-1', 'develop'),
      pr(11, 'limits-2', 'limits-1'),
      pr(20, 'readme', 'develop'),
    ]
    expect(shape(stacksOf(pulls, MAIN))).toEqual([
      {
        name: 'limits-1',
        base: 'develop',
        members: [
          [10, null],
          [11, null],
          [12, null],
        ],
      },
    ])
  })

  it('puts a fork depth first and says which PR the second branch sits on', () => {
    const pulls = [pr(1, 'a', 'develop'), pr(2, 'b', 'a'), pr(3, 'c', 'a'), pr(4, 'd', 'b')]
    expect(shape(stacksOf(pulls, MAIN))[0]?.members).toEqual([
      [1, null],
      [2, null],
      [4, null],
      [3, 1],
    ])
  })

  it('makes a lone PR on another branch its own stack', () => {
    expect(shape(stacksOf([pr(5, 'tweak', 'someone-elses-branch')], MAIN))).toEqual([
      { name: 'tweak', base: 'someone-elses-branch', members: [[5, null]] },
    ])
  })

  it('links no PR through a main branch, so a release PR from develop stacks nothing', () => {
    const pulls = [pr(1, 'develop', 'main'), pr(2, 'feature', 'develop'), pr(3, 'other', 'hotfix')]
    // The release PR targets `main`, which this repo does not list, so it is a stack of its own.
    expect(shape(stacksOf(pulls, MAIN))).toEqual([{ name: 'develop', base: 'main', members: [[1, null]] }])
  })

  it('takes the newest PR when two share a head branch', () => {
    const pulls = [pr(1, 'shared', 'develop'), pr(2, 'shared', 'develop'), pr(3, 'top', 'shared')]
    expect(shape(stacksOf(pulls, MAIN))).toEqual([
      {
        name: 'shared',
        base: 'develop',
        members: [
          [2, null],
          [3, null],
        ],
      },
    ])
  })

  it('breaks a loop at its lowest number instead of looping', () => {
    const pulls = [pr(7, 'x', 'y'), pr(8, 'y', 'x')]
    expect(shape(stacksOf(pulls, MAIN))).toEqual([
      {
        name: 'x',
        base: 'y',
        members: [
          [7, null],
          [8, null],
        ],
      },
    ])
  })

  it('orders stacks by their roots', () => {
    const pulls = [pr(30, 'z', 'q'), pr(4, 'p', 'r')]
    expect(stacksOf(pulls, MAIN).map(s => s.name)).toEqual(['p', 'z'])
  })
})

describe('positions', () => {
  it('numbers each member of a stack from its root', () => {
    expect(Object.fromEntries(stackPositions(stacksOf([pr(2, 'b', 'a'), pr(3, 'c', 'b')], MAIN)))).toEqual({
      2: { name: 'b', position: 1, total: 2, base: 'a' },
      3: { name: 'b', position: 2, total: 2, base: 'a' },
    })
  })
})
