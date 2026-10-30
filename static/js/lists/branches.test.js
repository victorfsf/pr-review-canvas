import { baseColor, cleanBranches, DEFAULT_BRANCHES, isBranchName, MAX_BRANCHES } from './branches.js'

describe('main branches', () => {
  it('start as main in green', () => {
    expect(DEFAULT_BRANCHES).toEqual([{ name: 'main', color: 'green' }])
    expect(baseColor('main', DEFAULT_BRANCHES)).toBe('green')
    expect(baseColor('feature/x', DEFAULT_BRANCHES)).toBe('gray')
  })

  it('save trimmed, one or many', () => {
    expect(cleanBranches([{ name: ' main ', color: 'blue' }])).toEqual({
      branches: [{ name: 'main', color: 'blue' }],
    })
    const many = Array.from({ length: MAX_BRANCHES }, (_, i) => ({
      name: `b${i}`,
      color: /** @type {const} */ ('green'),
    }))
    expect(cleanBranches(many)).toEqual({ branches: many })
  })

  it('refuse none, too many, a blank, a bad name, or one twice', () => {
    expect(cleanBranches([])).toEqual({ error: 'Keep at least one base branch.' })
    const tooMany = Array.from({ length: MAX_BRANCHES + 1 }, (_, i) => ({
      name: `b${i}`,
      color: /** @type {const} */ ('green'),
    }))
    expect(cleanBranches(tooMany)).toEqual({ error: `At most ${MAX_BRANCHES} base branches.` })
    expect(cleanBranches([{ name: '  ', color: 'red' }])).toEqual({ error: 'Every branch needs a name.' })
    expect(cleanBranches([{ name: 'my branch', color: 'red' }])).toEqual({
      error: '"my branch" is not a branch name.',
    })
    expect(
      cleanBranches([
        { name: 'hotfix', color: 'red' },
        { name: 'hotfix ', color: 'blue' },
      ])
    ).toEqual({ error: '"hotfix" is listed twice.' })
  })

  it('take the names git takes', () => {
    for (const ok of ['develop', 'release/2.x', 'hot-fix_1', 'v1.2']) expect(isBranchName(ok)).toBe(true)
    for (const bad of [
      'a b',
      'a..b',
      'a~1',
      'a^',
      'a:b',
      'a?',
      'a*',
      'a[b',
      'a\\b',
      '.hidden',
      'x/.y',
      'a.lock',
      'a/',
      '/a',
      'a//b',
      'a.',
      '@',
      'a@{1}',
      'a\u0007',
    ])
      expect(isBranchName(bad)).toBe(false)
  })
})
