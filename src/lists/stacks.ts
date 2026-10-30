// Stacks: PR B sits on PR A when B's base branch is A's head branch. A chain of them is a stack;
// so is a PR that targets a branch other than the repo's main ones, alone or not, since it waits on
// whatever owns that branch. A PR on a main branch with nothing on it stands alone and is no stack.
//
// Your PRs are linked among themselves, and the Review queue's among themselves.
import type { ListPull } from './model.js'

type Pull = Pick<
  ListPull,
  'number' | 'title' | 'url' | 'headRefName' | 'baseRefName' | 'isDraft' | 'reviewDecision'
>

export interface StackMember {
  number: number
  title: string
  url: string
  headRefName: string
  baseRefName: string
  isDraft: boolean
  reviewDecision: Pull['reviewDecision']
  /**
   * The PR this one sits on, when that is not the member just below it: in a fork, two PRs sit on
   * the same one. Null otherwise.
   */
  on: number | null
}

export interface Stack {
  /** The head branch of its lowest open PR. */
  name: string
  /** The branch the lowest member targets. */
  base: string
  /** Lowest first: the root, then each PR on it, depth first. */
  members: StackMember[]
}

/** Where a PR sits in its stack, counting open PRs only: "rate-limit 2/3". */
export interface StackPosition {
  name: string
  position: number
  total: number
  /** The branch the stack sits on: its lowest member's base. */
  base: string
}

const memberOf = (pull: Pull, on: number | null): StackMember => ({
  number: pull.number,
  title: pull.title,
  url: pull.url,
  headRefName: pull.headRefName,
  baseRefName: pull.baseRefName,
  isDraft: pull.isDraft,
  reviewDecision: pull.reviewDecision,
  on,
})

/**
 * Groups open PRs into stacks, in the order of their roots' numbers. A PR's parent is the open
 * PR whose head is its base (the newest, if two share a head); a PR on a main branch has none.
 */
export function stacksOf(pulls: readonly Pull[], mainBranches: readonly string[]): Stack[] {
  const main = new Set(mainBranches)
  const byHead = new Map<string, Pull>()
  for (const p of [...pulls].sort((a, b) => a.number - b.number)) byHead.set(p.headRefName, p)
  const parentOf = new Map<number, number>()
  for (const p of pulls) {
    if (main.has(p.baseRefName)) continue
    const parent = byHead.get(p.baseRefName)
    if (parent !== undefined && parent.number !== p.number) parentOf.set(p.number, parent.number)
  }
  const children = new Map<number, Pull[]>()
  for (const p of pulls) {
    const parent = parentOf.get(p.number)
    if (parent === undefined) continue
    children.set(parent, [...(children.get(parent) ?? []), p])
  }

  const placed = new Set<number>()
  const walk = (root: Pull): StackMember[] => {
    const members: StackMember[] = []
    const visit = (pull: Pull) => {
      if (placed.has(pull.number)) return
      placed.add(pull.number)
      const parent = parentOf.get(pull.number) ?? null
      const below = members.at(-1)?.number ?? null
      members.push(memberOf(pull, parent !== null && parent !== below ? parent : null))
      for (const child of (children.get(pull.number) ?? []).sort((a, b) => a.number - b.number)) visit(child)
    }
    visit(root)
    return members
  }

  const ordered = [...pulls].sort((a, b) => a.number - b.number)
  const groups = ordered.filter(p => !parentOf.has(p.number)).map(walk)
  // PRs left over sit on each other in a loop; the lowest number of each loop is taken as its root.
  for (const p of ordered) if (!placed.has(p.number)) groups.push(walk(p))

  return groups
    .filter(members => members.length > 1 || !main.has((members[0] as StackMember).baseRefName))
    .map(members => {
      const root = members[0] as StackMember
      return {
        name: root.headRefName,
        base: root.baseRefName,
        members: [{ ...root, on: null }, ...members.slice(1)],
      }
    })
    .sort((a, b) => (a.members[0] as StackMember).number - (b.members[0] as StackMember).number)
}

/** Each stacked PR's place in its stack, by number. */
export function stackPositions(stacks: readonly Stack[]): Map<number, StackPosition> {
  const positions = new Map<number, StackPosition>()
  for (const stack of stacks) {
    stack.members.forEach((m, i) =>
      positions.set(m.number, {
        name: stack.name,
        position: i + 1,
        total: stack.members.length,
        base: stack.base,
      })
    )
  }
  return positions
}
