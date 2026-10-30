// @ts-check
// Highest priority, on the Review queue: Claude picks the few PRs to review first, by the prompt in
// use among the named ones the repo keeps, which the table's Edit button manages, each time the
// table's sync button is pressed. The server and the page share these defaults and limits.

/** What a repo asks for until its prompt is edited. */
export const DEFAULT_PRIORITY_PROMPT = [
  'The highest priority PRs are the ones where my review unblocks the most, soonest:',
  '',
  '1. PRs labeled critical, hotfix, security or incident.',
  '2. PRs that request my review by name.',
  '3. PRs that have waited the longest for a review and have no approval yet.',
  '4. When the rest is equal, small PRs before large ones: they are quick to review.',
  '',
  'Leave out PRs with failing checks or merge conflicts unless they are critical: their authors have work to do first.',
].join('\n')

/** How many PRs the table shows until the repo picks another number. */
export const DEFAULT_PRIORITY_COUNT = 3

/** The most PRs the table may show. */
export const MAX_PRIORITY_COUNT = 10

/** The longest prompt a repo may keep, in characters. */
export const MAX_PRIORITY_PROMPT = 4000

/** The name the default prompt goes by. */
export const DEFAULT_PRIORITY_NAME = 'Default'

/** The longest name a prompt may have, in characters. */
export const MAX_PRIORITY_NAME = 60

/** The most prompts a repo may keep. */
export const MAX_PRIORITY_PROMPTS = 100

/** @typedef {{ name: string, prompt: string }} NamedPrompt */

/**
 * A repo's Highest priority: its named prompts, the name of the one in use and its text, and how
 * many PRs Claude may pick.
 * @typedef {{ prompts: NamedPrompt[], active: string, prompt: string, count: number }} PrioritySetup
 */

/** @returns {PrioritySetup} what a repo has until it saves its own */
export function defaultPriority() {
  return {
    prompts: [{ name: DEFAULT_PRIORITY_NAME, prompt: DEFAULT_PRIORITY_PROMPT }],
    active: DEFAULT_PRIORITY_NAME,
    prompt: DEFAULT_PRIORITY_PROMPT,
    count: DEFAULT_PRIORITY_COUNT,
  }
}

/**
 * What Settings says of a repo's Highest priority: how many PRs, and the prompt in use.
 * @param {{ active: string, count: number }} p
 */
export function prioritySummary(p) {
  const prs = p.count === 1 ? '1 PR' : `${p.count} PRs`
  return `${prs} · ${p.active}`
}

/** @typedef {{ number: number, why: string }} PriorityPick */

/**
 * The picks that are still in the queue, in Claude's order, as rows: a pick whose PR left the queue
 * since the sync drops out, and none past `count` shows.
 * @template {{ number: number }} T
 * @param {readonly PriorityPick[]} picks
 * @param {readonly T[]} rows
 * @param {number} count
 * @returns {(T & { why: string })[]}
 */
export function pickedRows(picks, rows, count) {
  const byNumber = new Map(rows.map(r => [r.number, r]))
  return picks
    .flatMap(p => {
      const row = byNumber.get(p.number)
      return row === undefined ? [] : [{ ...row, why: p.why }]
    })
    .slice(0, count)
}
