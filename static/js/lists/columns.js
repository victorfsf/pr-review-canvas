// @ts-check
// The Columns picker on Your PRs and the Review queue: a box per column that can hide, with All
// and None. Pull request and Actions always show, so they have no box. Hidden columns are saved per
// repo and table (see filters.js); a column the repo does not have (CodeRabbit or Canvas turned off)
// is neither offered nor counted.
import { el, wireFilterPanel } from './dom.js'
import { loadColumns, saveColumns } from './filters.js'

/** Your PRs' columns that can hide, in table order. */
export const PULL_COLUMNS = /** @type {const} */ ([
  ['status', 'Status'],
  ['points', 'Attention points'],
  ['review', 'Review'],
  ['reviewed', 'Reviewed by'],
  ['ready', 'Ready'],
  ['labels', 'Labels'],
  ['canvas', 'Canvas'],
  ['codeRabbit', 'CodeRabbit'],
])

/** The Review queue's columns that can hide, in table order. */
export const QUEUE_COLUMNS = /** @type {const} */ ([
  ['status', 'Status'],
  ['points', 'Attention points'],
  ['reviewed', 'Reviewed by'],
  ['author', 'Author'],
  ['ready', 'Ready'],
  ['labels', 'Labels'],
  ['canvas', 'Canvas'],
  ['codeRabbit', 'CodeRabbit'],
])

/**
 * The columns a repo has: Canvas and CodeRabbit only while it uses them.
 * @param {readonly (readonly [string, string])[]} columns
 * @param {{ canvas: boolean, codeRabbit: boolean }} on
 */
export function columnsOn(columns, on) {
  return columns
    .map(([name]) => name)
    .filter(name => (name !== 'canvas' || on.canvas) && (name !== 'codeRabbit' || on.codeRabbit))
}

/**
 * What the Columns button says: All, None, or how many of the columns show.
 * @param {number} shown
 * @param {number} total
 */
export function columnsLabel(shown, total) {
  if (shown === total) return 'All'
  if (shown === 0) return 'None'
  return `${shown} of ${total}`
}

/**
 * Wires the page's Columns button and fills its popover each time `render` runs. `available`
 * says which columns the repo has; `onChange` hears the hidden columns and redraws the table.
 * @param {Document} doc
 * @param {{ repo: { owner: string, name: string }, page: 'pulls' | 'queue',
 *   columns: readonly (readonly [string, string])[], available: () => readonly string[],
 *   onChange: (hidden: ReadonlySet<string>) => void }} opts
 */
export function wireColumnsPicker(doc, opts) {
  let hidden = new Set(loadColumns(opts.repo, opts.page))
  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id))
  const button = get('columns-button')
  const options = get('columns-options')
  const offered = () => opts.columns.filter(([key]) => opts.available().includes(key))

  const set = (/** @type {Set<string>} */ next) => {
    hidden = next
    saveColumns(opts.repo, opts.page, [...hidden])
    render()
    opts.onChange(hidden)
  }

  const render = () => {
    const columns = offered()
    get('columns-label').textContent = columnsLabel(
      columns.filter(([key]) => !hidden.has(key)).length,
      columns.length
    )
    options.replaceChildren(
      ...columns.map(([key, words]) => {
        const row = el(doc, 'label', 'check-row')
        const box = /** @type {HTMLInputElement} */ (el(doc, 'input'))
        box.type = 'checkbox'
        box.dataset['column'] = key
        box.checked = !hidden.has(key)
        box.addEventListener('change', () => {
          const next = new Set(hidden)
          if (box.checked) next.delete(key)
          else next.add(key)
          set(next)
        })
        row.append(box, ` ${words}`)
        return row
      })
    )
  }

  get('columns-all').addEventListener('click', () => set(new Set()))
  get('columns-none').addEventListener('click', () => set(new Set(opts.columns.map(([key]) => key))))
  wireFilterPanel(doc, button, get('columns-panel'))
  render()
  return {
    render,
    /** Whether a column shows: the repo has it and it is not hidden. @param {string} key */
    shows: (/** @type {string} */ key) => opts.available().includes(key) && !hidden.has(key),
  }
}
