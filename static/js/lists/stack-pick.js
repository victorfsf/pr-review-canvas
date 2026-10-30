// @ts-check
// The Stack filter of Your PRs and the Review queue: it shows only while some PR is in a stack, and
// keeps the PRs of the one stack picked, every PR to start with.
import { button as makeButton, el, iconNode, wireFilterPanel } from './dom.js'
import { isBlock, parseWhere } from './filter-builder.js'

/** @typedef {{ stack?: { name: string, position?: number, total: number } | undefined }} Stacked */

/** The stack names among the PRs, in order of first appearance; a stack of one PR is no stack. */
export const stackNames = (/** @type {readonly Stacked[]} */ pulls) => [
  ...new Set(pulls.flatMap(p => (p.stack !== undefined && p.stack.total > 1 ? [p.stack.name] : []))),
]

/**
 * The stack picked, `''` for every PR, and also when the stack is gone.
 * @param {string} picked
 * @param {readonly string[]} names
 */
export const activeStack = (picked, names) => (names.includes(picked) ? picked : '')

/**
 * The PRs of the stack picked.
 * @template T
 * @param {readonly T[]} pulls
 * @param {string} picked
 * @param {(pull: T) => Stacked['stack']} stackOf
 */
export function filterStack(pulls, picked, stackOf) {
  if (picked === '') return [...pulls]
  return pulls.filter(p => stackOf(p)?.name === picked)
}

/**
 * The PRs in their stack's order, the one on the base first; a PR in no stack after them, as it was.
 * @template T
 * @param {readonly T[]} pulls
 * @param {(pull: T) => Stacked['stack']} stackOf
 */
export const byStackPosition = (pulls, stackOf) =>
  [...pulls].sort(
    (a, b) =>
      (stackOf(a)?.position ?? Number.MAX_SAFE_INTEGER) - (stackOf(b)?.position ?? Number.MAX_SAFE_INTEGER)
  )

/**
 * Whether the filters ask for a stack: the Stack filter picks one, or with the builder in use, one
 * of its conditions keeps PRs by their stack.
 * @param {{ builder: boolean, where: string, stack: string }} f
 * @param {readonly string[]} names the stacks among the PRs
 */
export function picksStack(f, names) {
  if (activeStack(f.stack, names) !== '') return true
  if (!f.builder) return false
  /** @param {import('./filter-builder.js').Node} node @returns {boolean} */
  const asks = node =>
    isBlock(node)
      ? node.items.some(asks)
      : node.field === 'stack' && node.is !== 'none' && node.values.length > 0
  return asks(parseWhere(f.where))
}

/**
 * The stack the PRs shown all belong to, because the filters asked for a stack, or null: then they
 * read best in its order, in one table named after it, even when the other filters leave one PR.
 * @template T
 * @param {readonly T[]} pulls
 * @param {(pull: T) => Stacked['stack']} stackOf
 * @param {boolean} asked what `picksStack` says
 * @returns {string | null}
 */
export function shownStack(pulls, stackOf, asked) {
  const names = new Set(pulls.map(p => stackOf(p)?.name))
  const [name] = names
  return asked && names.size === 1 && name !== undefined ? name : null
}

/**
 * Names the main table's heading after the stack shown, with the stack icon, or gives it back its
 * own words. Show all PRs beside it clears the Stack filter, so it shows only while that filter,
 * not the builder, picks the stack.
 * @param {Document} doc
 * @param {{ heading: HTMLElement, words: string, stack: string | null, showAll: HTMLElement, builder: boolean }} opts
 */
export function nameStackHeading(doc, { heading, words, stack, showAll, builder }) {
  const title = heading.querySelector('.fold-title')
  if (title !== null) {
    if (stack === null) title.replaceChildren(words)
    else title.replaceChildren(iconNode(doc, 'stack', 14), ` Stack: ${stack}`)
  }
  showAll.hidden = stack === null || builder
}

/**
 * Wires the Stack filter's button and popover; `render` fills a menu item per stack, after one for
 * every PR, each with how many PRs it keeps, and hides the filter while no PR is in a stack.
 * @param {Document} doc
 * @param {{ picked: () => string, pick: (stack: string) => void }} opts
 */
export function wireStackFilter(doc, { picked, pick }) {
  const anchor = doc.getElementById('stack-filter')
  const button = doc.getElementById('stack-button')
  const panel = doc.getElementById('stack-panel')
  const label = doc.getElementById('stack-label')
  const options = doc.getElementById('stack-options')
  if (button !== null && panel !== null) wireFilterPanel(doc, button, panel)
  // The list keeps room for its scrollbar only while it scrolls; that is known once it is open.
  const fit = () => options?.classList.toggle('scrolls', options.scrollHeight > options.clientHeight)
  button?.addEventListener('click', fit)
  return {
    /** @param {readonly Stacked[]} pulls each with its stack, when it is in one */
    render(pulls) {
      if (anchor === null || label === null || options === null) return
      const names = stackNames(pulls)
      anchor.hidden = names.length === 0
      const chosen = activeStack(picked(), names)
      label.textContent = chosen === '' ? 'All' : chosen
      if (button !== null) button.title = chosen === '' ? '' : `Stack: ${chosen}`
      /** @param {string} value @param {Node} words @param {number} count */
      const row = (value, words, count) => {
        const item = makeButton(doc, 'menu-item', '')
        item.setAttribute('role', 'menuitemradio')
        item.setAttribute('aria-checked', String(value === chosen))
        const check = el(doc, 'span', 'menu-check')
        check.append(iconNode(doc, 'check', 16))
        item.append(check, el(doc, 'span', 'menu-label', ''), el(doc, 'span', 'muted small', String(count)))
        item.querySelector('.menu-label')?.append(words)
        item.title = words.textContent ?? ''
        item.addEventListener('click', () => {
          pick(value)
          // Picking is the whole job: the menu closes, and focus returns to its button.
          button?.click()
          button?.focus()
        })
        return item
      }
      options.replaceChildren(
        row('', doc.createTextNode('All PRs'), pulls.length),
        ...names.map(name =>
          row(name, el(doc, 'span', 'stack-name', name), pulls.filter(p => p.stack?.name === name).length)
        )
      )
      fit()
    },
  }
}
