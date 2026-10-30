// @ts-check
// Sorting the Your PRs and Review queue tables by several columns at once. A sort is a list of
// column keys, the first deciding first; a key with a leading "-" sorts that column descending.
// Clicking a column's header adds it ascending, then flips it to descending, then takes it out;
// an empty list is no sorting, the order the server sent. It goes in the address like the filters.
import { button } from './dom.js'

/**
 * Takes a column through its three states: added ascending at the end of the sort, then
 * descending in place, then out.
 * @param {readonly string[]} sort
 * @param {string} key
 * @returns {string[]}
 */
export function nextSort(sort, key) {
  const at = sort.findIndex(s => s === key || s === `-${key}`)
  if (at === -1) return [...sort, key]
  if (sort[at] === key) return sort.map((s, i) => (i === at ? `-${key}` : s))
  return sort.filter((_, i) => i !== at)
}

/**
 * Where a column sits in the sort: its place (1 first, 0 when not sorted) and whether it runs
 * descending.
 * @param {readonly string[]} sort
 * @param {string} key
 */
export function sortState(sort, key) {
  const at = sort.findIndex(s => s === key || s === `-${key}`)
  return { place: at + 1, desc: at !== -1 && sort[at] === `-${key}` }
}

/**
 * What a column's sort button says after its name: ↕ when not sorted; ↑ or ↓, and its place when
 * more than one column sorts.
 * @param {readonly string[]} sort
 * @param {string} key
 */
export function sortMark(sort, key) {
  const { place, desc } = sortState(sort, key)
  if (place === 0) return '↕'
  return `${desc ? '↓' : '↑'}${sort.length > 1 ? place : ''}`
}

/**
 * The sort without the columns named, either way: a hidden column no longer sorts its table.
 * @param {readonly string[]} sort
 * @param {ReadonlySet<string>} columns
 */
export function withoutColumns(sort, columns) {
  return sort.filter(s => !columns.has(s.startsWith('-') ? s.slice(1) : s))
}

/**
 * The check for a stored or linked sort: keys it knows, each once, either way.
 * @param {readonly string[]} keys
 */
export const sortAccept = keys => (/** @type {unknown} */ value) => {
  if (!Array.isArray(value)) return false
  const bare = value.map(v => (typeof v === 'string' && v.startsWith('-') ? v.slice(1) : v))
  return bare.every(k => typeof k === 'string' && keys.includes(k)) && new Set(bare).size === bare.length
}

/**
 * The rows in the sort's order; ties keep the order they came in. No sort keeps them all as given.
 * @template T
 * @param {readonly T[]} rows
 * @param {readonly string[]} sort
 * @param {Readonly<Record<string, (a: T, b: T) => number>>} compare each column's ascending order
 * @returns {T[]}
 */
export function sortBy(rows, sort, compare) {
  const steps = sort.flatMap(s => {
    const desc = s.startsWith('-')
    const by = compare[desc ? s.slice(1) : s]
    return by === undefined ? [] : [{ by, dir: desc ? -1 : 1 }]
  })
  if (steps.length === 0) return [...rows]
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      for (const { by, dir } of steps) {
        const d = by(a.row, b.row)
        if (d !== 0) return dir * d
      }
      return a.i - b.i
    })
    .map(({ row }) => row)
}

/**
 * A column header's sort button: its name and mark, and where it sits in the sort for screen
 * readers. Sets the header cell's `aria-sort` for the column the sort starts with.
 * @param {Document} doc
 * @param {HTMLElement} cell the header cell it goes in
 * @param {{ key: string, words: string, sort: readonly string[], onSort: (next: string[]) => void }} opts
 */
export function sortButton(doc, cell, opts) {
  const { key, words, sort } = opts
  const { place, desc } = sortState(sort, key)
  cell.setAttribute('aria-sort', place === 1 ? (desc ? 'descending' : 'ascending') : 'none')
  const b = button(doc, 'sort-button', `${words} ${sortMark(sort, key)}`)
  b.setAttribute(
    'aria-label',
    place === 0
      ? `Sort by ${words.toLowerCase()}`
      : `Sorted by ${words.toLowerCase()}, ${desc ? 'descending' : 'ascending'}${sort.length > 1 ? `, ${place} of ${sort.length}` : ''}`
  )
  b.addEventListener('click', () => opts.onSort(nextSort(sort, key)))
  return b
}
