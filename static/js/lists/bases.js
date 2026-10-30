// @ts-check
// The Base filter of Your PRs and the Review queue: it shows only while the repo has more than one
// base branch, and keeps the PRs on the choices ticked, every one to start with. Each PR is under
// one choice, as the two tables split them: a base branch it targets itself; "Stacked branches"
// when it sits on another open PR; "Other branches" when it targets any other branch, alone or at
// the foot of its stack.
import { el, wireFilterPanel } from './dom.js'
import { tick } from './filters.js'
import { pickedLabel } from './queue.js'

/** @typedef {import('./branches.js').MainBranch} MainBranch */
/** @typedef {{ baseRefName: string, stack?: { position?: number } | undefined }} Placed */

/** The Base filter's choice for a PR on another open PR: no branch name has a colon. */
export const STACKED_BASE = ':stacked'
/** Its choice for a PR on any other branch that is not a base branch. */
export const OTHER_BASE = ':other'

/** What the filter calls each choice that is not a branch. */
const WORDS = /** @type {Record<string, string>} */ ({
  [STACKED_BASE]: 'Stacked branches',
  [OTHER_BASE]: 'Other branches',
})

/**
 * Every choice the filter offers.
 * @param {readonly MainBranch[]} branches
 * @param {boolean} [other] whether it offers Stacked and Other branches
 */
const choicesOf = (branches, other = true) => [
  ...branches.map(b => b.name),
  ...(other ? [STACKED_BASE, OTHER_BASE] : []),
]

/**
 * The ticked bases the repo still has, `null` when that is all of them, and always `null` while it
 * has only one, as the filter is hidden then.
 * @param {readonly string[] | null} picked
 * @param {readonly MainBranch[]} branches
 * @param {boolean} [other] whether the filter offers Stacked and Other branches
 * @returns {string[] | null}
 */
export function activeBases(picked, branches, other = true) {
  if (branches.length < 2 || picked === null) return null
  const all = choicesOf(branches, other)
  const kept = picked.filter(name => all.includes(name))
  return kept.length === all.length ? null : kept
}

/**
 * The choice a PR is under: the base branch it targets; `STACKED_BASE` when it sits on another
 * open PR, as every member of a stack but its lowest does; else `OTHER_BASE`.
 * @param {Placed} pull
 * @param {readonly MainBranch[]} branches
 */
export function placeOf(pull, branches) {
  if (branches.some(b => b.name === pull.baseRefName)) return pull.baseRefName
  return (pull.stack?.position ?? 1) > 1 ? STACKED_BASE : OTHER_BASE
}

/**
 * The PRs the Base filter keeps.
 * @template {{ baseRefName: string }} T
 * @param {readonly T[]} pulls
 * @param {readonly string[] | null} picked
 * @param {readonly MainBranch[]} branches
 * @param {(pull: T) => Placed['stack']} [stackOf] where a PR sits in its stack; the row's own `stack`
 */
export function filterBases(pulls, picked, branches, stackOf = p => /** @type {Placed} */ (p).stack) {
  const wanted = activeBases(picked, branches)
  if (wanted === null) return [...pulls]
  return pulls.filter(p =>
    wanted.includes(placeOf({ baseRefName: p.baseRefName, stack: stackOf(p) }, branches))
  )
}

/**
 * Wires the Base filter's button and popover; `render` fills a checkbox per base branch, then
 * Stacked branches and Other branches, each with how many PRs are under it, and hides the filter
 * while the repo has one base branch. All and None tick or untick every one. With `other` false,
 * Stacked and Other branches are not offered.
 * @param {Document} doc
 * @param {{ picked: () => readonly string[] | null, pick: (bases: string[] | null) => void, other?: boolean }} opts
 */
export function wireBaseFilter(doc, { picked, pick, other = true }) {
  const anchor = doc.getElementById('bases-filter')
  const button = doc.getElementById('bases-button')
  const panel = doc.getElementById('bases-panel')
  const label = doc.getElementById('bases-label')
  const options = doc.getElementById('bases-options')
  if (button !== null && panel !== null) wireFilterPanel(doc, button, panel)
  doc.getElementById('bases-all')?.addEventListener('click', () => pick(null))
  doc.getElementById('bases-none')?.addEventListener('click', () => pick([]))
  return {
    /**
     * @param {readonly MainBranch[]} branches
     * @param {readonly Placed[]} pulls each with its stack, when it is in one
     */
    render(branches, pulls) {
      if (anchor === null || label === null || options === null) return
      anchor.hidden = branches.length < 2
      const chosen = activeBases(picked(), branches, other)
      const all = choicesOf(branches, other)
      label.textContent = pickedLabel(chosen?.map(name => WORDS[name] ?? name) ?? null, all.length)
      /** @param {string} name @param {Node} words */
      const row = (name, words) => {
        const line = el(doc, 'label', 'check-row')
        const input = /** @type {HTMLInputElement} */ (el(doc, 'input'))
        input.type = 'checkbox'
        input.value = name
        input.checked = chosen === null || chosen.includes(name)
        input.addEventListener('change', () => pick(tick(chosen, name, input.checked, all)))
        const count = pulls.filter(p => placeOf(p, branches) === name).length
        line.append(input, ' ', words, el(doc, 'span', 'muted small people-count', String(count)))
        return line
      }
      options.replaceChildren(
        ...branches.map(b => row(b.name, el(doc, 'span', `branch-pill pill-${b.color}`, b.name))),
        ...(other
          ? [STACKED_BASE, OTHER_BASE].map(name => row(name, doc.createTextNode(WORDS[name] ?? name)))
          : [])
      )
    },
  }
}
