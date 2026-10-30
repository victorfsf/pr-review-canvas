// @ts-check
// A repo's main development branches: the ones work is pushed on, each with the color its base
// pill takes. A PR whose base is not one of them targets another PR's branch, so it is part of a
// stack, and its pill is gray. Each repo keeps its own list in the settings file.
import { TEXTS } from './texts.js'

/** The colors a main branch can take; each maps to one of the scheme's status colors. */
export const BRANCH_COLORS = /** @type {const} */ (['green', 'red', 'yellow', 'purple', 'blue'])
/** @typedef {(typeof BRANCH_COLORS)[number]} BranchColor */

/** @typedef {{ name: string, color: BranchColor }} MainBranch */

/** What a repo starts with: `main` in green. */
export const DEFAULT_BRANCHES = /** @type {readonly MainBranch[]} */ ([{ name: 'main', color: 'green' }])

/** How many main branches a repo can list. */
export const MAX_BRANCHES = 10

/**
 * The branches as they would be saved: names trimmed. An error says why they cannot be: a repo
 * needs at least one, each with a name git would take, none twice.
 * @param {readonly MainBranch[]} branches
 * @returns {{ branches: MainBranch[] } | { error: string }}
 */
export function cleanBranches(branches) {
  const cleaned = branches.map(b => ({ name: b.name.trim(), color: b.color }))
  if (cleaned.length === 0) return { error: TEXTS.lists.branches.keepOne }
  if (cleaned.length > MAX_BRANCHES) return { error: TEXTS.lists.branches.tooMany(MAX_BRANCHES) }
  if (cleaned.some(b => b.name === '')) return { error: TEXTS.lists.branches.needsName }
  const bad = cleaned.find(b => !isBranchName(b.name))
  if (bad !== undefined) return { error: TEXTS.lists.branches.notBranch(bad.name) }
  const twice = cleaned.find((b, i) => cleaned.findIndex(o => o.name === b.name) !== i)
  if (twice !== undefined) return { error: TEXTS.lists.branches.twice(twice.name) }
  return { branches: cleaned }
}

/**
 * Whether git would take `name` as a branch: no spaces, control characters or `~^:?*[\`, no `..`
 * or `@{`, and no part that starts with a dot or ends with `.lock`.
 * @param {string} name
 */
export function isBranchName(name) {
  if (name.length > 100 || /[\s~^:?*[\\]/.test(name)) return false
  if ([...name].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) return false
  if (name.includes('..') || name.includes('@{') || name === '@') return false
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.includes('//')) return false
  return name.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock'))
}

/**
 * The pill color for a PR's base branch: its main branch color, or gray for any other branch.
 * @param {string} base
 * @param {readonly MainBranch[]} branches
 * @returns {BranchColor | 'gray'}
 */
export function baseColor(base, branches) {
  return branches.find(b => b.name === base)?.color ?? 'gray'
}
