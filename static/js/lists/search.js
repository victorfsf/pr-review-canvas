// @ts-check
// The search box on the Inbox, Your PRs and the Review queue: it narrows the page to the PRs whose
// title, branches, number or (with Jira on) Jira keys match what you type, in the browser over the
// rows already loaded, with no request to the server. Case and accents are ignored. Words are
// ANDed: each must match some field. `OR`, in capitals, splits the search into alternatives, any
// of which may match, and `AND` may be written between words too; AND binds first, so
// `cache AND docs OR login` is (cache and docs) or login. In lower case they are plain words.
// `#12` is PR 12 alone; `12` is PR 12, or 12 in a title, branch or key; a key, `proj-12`, is that
// card or a title or branch carrying it; anything else is part of a title, branch or key. A pasted
// GitHub PR or Jira card address reads as its number or key. The box colors AND and OR.
// The search is the page's `q` filter: it goes in the address, so Back and a copied link keep it,
// and in saved filters, but the page never remembers it on its own (filters.js), so a page opened
// from the nav starts with an empty box. `/` puts the cursor in the box, Escape clears it and then
// leaves it, and Enter opens the PR when exactly one matches.
import { el, iconNode, withSlots } from './dom.js'
import { MAX_SEARCH } from './filters.js'
import { TEXTS } from './texts.js'

/**
 * What the search reads of a PR.
 * @typedef {{ number: number, title: string, head: string, base: string, keys: readonly string[] }} Searchable
 */

/**
 * One word of the search.
 * @typedef {{ kind: 'number', n: number } | { kind: 'digits' | 'key' | 'text', text: string }} Term
 */

/**
 * A search: its alternatives, joined by OR, each its words, all of which must match.
 * @typedef {Term[][]} Query
 */

/** The words that join others; only in capitals, so "or" in a title is still a word to find. */
export const OPERATORS = /** @type {const} */ (['AND', 'OR'])

const KEY = /^[a-z][a-z0-9_]+-[1-9][0-9]*$/i
const MARKS = /\p{M}/gu

/** Text as the search compares it: lower case, without accents. @param {string} text */
export const fold = text => text.normalize('NFD').replace(MARKS, '').toLowerCase()

/** The number or key a pasted address points at, or null. @param {string} word @returns {Term | null} */
function linkTerm(word) {
  if (!/^https?:\/\//i.test(word)) return null
  let url
  try {
    url = new URL(word)
  } catch {
    return null
  }
  const pr = /\/pull\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1]
  if (pr !== undefined) return { kind: 'number', n: Number(pr) }
  const key = /\/browse\/([^/]+)\/?$/.exec(url.pathname)?.[1] ?? url.searchParams.get('selectedIssue') ?? ''
  return KEY.test(key) ? { kind: 'key', text: fold(key) } : null
}

/** One word as the search reads it. @param {string} word @returns {Term} */
function termOf(word) {
  const linked = linkTerm(word)
  if (linked !== null) return linked
  const number = /^#(\d+)$/.exec(word)?.[1]
  if (number !== undefined) return { kind: 'number', n: Number(number) }
  if (/^\d+$/.test(word)) return { kind: 'digits', text: word }
  return { kind: KEY.test(word) ? 'key' : 'text', text: fold(word) }
}

/**
 * The search's alternatives: split at each OR, AND dropped. An operator with no word on one side,
 * such as a trailing OR while you type, is left out.
 * @param {string} query
 * @returns {Query}
 */
export function parseSearch(query) {
  /** @type {Query} */
  const groups = [[]]
  for (const word of query.trim().split(/\s+/)) {
    if (word === '' || word === 'AND') continue
    if (word === 'OR') groups.push([])
    else groups.at(-1)?.push(termOf(word))
  }
  return groups.filter(g => g.length > 0)
}

/**
 * Whether plain text matches any alternative of the search: every word of one found in it,
 * compared folded, a `#number` as written. An empty search matches any text.
 * @param {string} text
 * @param {Query} query
 */
export function textMatch(text, query) {
  if (query.length === 0) return true
  const folded = fold(text)
  return query.some(terms => terms.every(t => folded.includes(t.kind === 'number' ? `#${t.n}` : t.text)))
}

/** Every word of a search, whatever alternative it is in, to mark them. @param {Query} query */
export const searchTerms = query => query.flat()

/**
 * Whether a PR matches any alternative of the search, and the Jira keys that alone let a word of
 * a matching one through: the row shows those under its title, so you see why it is there. Null
 * when it matches none; an empty search matches every PR.
 * @param {Searchable} pr
 * @param {Query} query
 * @param {boolean} jira whether the repo's Jira switch is on; off, keys never match
 * @returns {{ keys: string[] } | null}
 */
export function searchMatch(pr, query, jira) {
  if (query.length === 0) return { keys: [] }
  /** @type {Set<string> | null} */
  let keys = null
  for (const terms of query) {
    const found = matchAll(pr, terms, jira)
    if (found === null) continue
    keys ??= new Set()
    for (const k of found) keys.add(k)
  }
  return keys === null ? null : { keys: [...keys] }
}

/**
 * The search's text with its operators in their own spans, spaces kept, for the layer over the
 * box that colors them.
 * @param {Document} doc
 * @param {string} text
 * @returns {(Node | string)[]}
 */
export function searchSyntax(doc, text) {
  return text
    .split(/(\s+)/)
    .filter(part => part !== '')
    .map(part =>
      /** @type {readonly string[]} */ (OPERATORS).includes(part) ? el(doc, 'span', 'search-op', part) : part
    )
}

/**
 * Whether a PR matches one alternative: every word. Null when it does not; else the Jira keys
 * that alone let some word through.
 * @param {Searchable} pr
 * @param {readonly Term[]} terms
 * @param {boolean} jira
 * @returns {string[] | null}
 */
function matchAll(pr, terms, jira) {
  const fields = [pr.title, pr.head, pr.base].map(fold)
  const keys = jira ? pr.keys : []
  /** @type {Set<string>} */
  const byKey = new Set()
  for (const term of terms) {
    if (term.kind === 'number') {
      if (pr.number !== term.n) return null
      continue
    }
    const inFields = fields.some(f => f.includes(term.text))
    const number = term.kind === 'digits' && String(pr.number) === term.text
    const found = keys.filter(k =>
      term.kind === 'key' ? fold(k) === term.text : fold(k).includes(term.text)
    )
    if (!inFields && !number && found.length === 0) return null
    if (!inFields && !number) for (const k of found) byKey.add(k)
  }
  return [...byKey]
}

/**
 * Wraps the parts of `root`'s text that the words match in `<mark>`: titles and branches (under
 * `text`) by what they contain, and a `#number` (under `number`, when given) whole when a word names it.
 * @param {ParentNode} root
 * @param {readonly Term[]} terms
 * @param {{ text: string, number: string }} [where]
 */
export function markMatches(
  root,
  terms,
  where = { text: '.pull-title, .branch-head, .branch-pill', number: '.pull-number' }
) {
  const words = terms.flatMap(t => (t.kind === 'number' ? [] : [t.text]))
  const numbers = new Set(
    terms.flatMap(t => (t.kind === 'number' ? [`#${t.n}`] : t.kind === 'digits' ? [`#${t.text}`] : []))
  )
  for (const number of where.number === '' ? [] : root.querySelectorAll(where.number)) {
    const text = number.textContent?.trim() ?? ''
    if (numbers.has(text)) number.replaceChildren(mark(number.ownerDocument, text))
  }
  if (words.length === 0) return
  for (const box of root.querySelectorAll(where.text)) {
    const walker = box.ownerDocument.createTreeWalker(box, 4 /* NodeFilter.SHOW_TEXT */)
    /** @type {Text[]} */
    const texts = []
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (node.parentElement?.closest(where.number === '' ? 'mark' : `${where.number}, mark`) === null)
        texts.push(/** @type {Text} */ (node))
    }
    for (const text of texts) markText(text, words)
  }
}

/** A `<mark>` holding `text`. @param {Document} doc @param {string} text */
const mark = (doc, text) => el(doc, 'mark', 'search-mark', text)

/**
 * Splits one text node around what the words match, compared folded, each match in a `<mark>`.
 * @param {Text} node
 * @param {readonly string[]} words folded
 */
function markText(node, words) {
  const raw = node.data
  // The folded text, and for each of its characters the original one it came from.
  let folded = ''
  /** @type {number[]} */
  const from = []
  for (let i = 0; i < raw.length; i++) {
    const f = fold(raw[i] ?? '')
    folded += f
    for (let j = 0; j < f.length; j++) from.push(i)
  }
  /** @type {boolean[]} */
  const hit = Array.from({ length: raw.length }, () => false)
  for (const word of words.filter(w => w !== '')) {
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + 1)) {
      for (let k = at; k < at + word.length; k++) hit[from[k] ?? 0] = true
    }
  }
  if (!hit.includes(true)) return
  const doc = node.ownerDocument
  /** @type {Node[]} */
  const parts = []
  let start = 0
  for (let i = 1; i <= raw.length; i++) {
    if (i < raw.length && hit[i] === hit[start]) continue
    const piece = raw.slice(start, i)
    parts.push(hit[start] ? mark(doc, piece) : doc.createTextNode(piece))
    start = i
  }
  node.replaceWith(...parts)
}

/**
 * The Jira keys a row was found by, as a chip after the Jira icon, for the line under its title.
 * @param {Document} doc
 * @param {readonly string[]} keys
 */
export function keyChip(doc, keys) {
  const chip = el(doc, 'span', 'search-key-chip')
  chip.title = TEXTS.lists.search.foundByJira
  chip.append(iconNode(doc, 'brandJira', 12), el(doc, 'mark', 'search-mark', keys.join(', ')))
  return chip
}

/**
 * Puts each row's key chip on the line under its title, or beside it on a slim row, for the rows
 * found by their Jira keys alone; a row is known by the `#number` in its title.
 * @param {ParentNode} root
 * @param {ReadonlyMap<number, readonly string[]>} foundBy
 * @param {{ number: string, row: string, line: string }} [where] the `#number`, the row around it,
 *   and the line in that row the chip goes on
 */
export function addKeyChips(
  root,
  foundBy,
  where = { number: '.pull-title .pull-number', row: 'td, .pull-text', line: '.pull-branch, .slim-marks' }
) {
  if (foundBy.size === 0) return
  for (const number of root.querySelectorAll(where.number)) {
    const keys = foundBy.get(Number(number.textContent?.replace('#', '')))
    const line = number.closest(where.row)?.querySelector(where.line)
    if (keys !== undefined && line !== null && line !== undefined)
      line.append(' ', keyChip(number.ownerDocument, keys))
  }
}

/**
 * Whether a key press should put the cursor in the box: `/` with no modifier, outside any field.
 * @param {KeyboardEvent} event
 */
function wantsSearch(event) {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented)
    return false
  const target = /** @type {HTMLElement | null} */ (event.target instanceof Element ? event.target : null)
  return (
    target === null ||
    target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') === null
  )
}

/**
 * A search as a filter keeps it: trimmed, and no longer than `MAX_SEARCH`.
 * @param {string} text
 */
export const searchText = text => text.trim().slice(0, MAX_SEARCH)

/**
 * How long typing must pause before the search filters the rows: longer than a picker's search
 * (`SEARCH_DEBOUNCE_MS`), since it redraws whole tables. Enter, Escape and × apply at once.
 */
export const SEARCH_DELAY_MS = 300

/**
 * Wires the page's search box (`SEARCH_BOX` in html.ts) and puts its count line under the filter
 * bar. The search is the page's `q` filter: `value` reads it, and `set` changes it once the words
 * settle; `single` gives the page of the one PR that matches, if one alone does, for Enter.
 * @param {Document} doc
 * @param {{ value: () => string, set: (q: string) => void, single: () => string | null }} opts
 */
export function wireSearch(doc, { value, set, single }) {
  const input = /** @type {HTMLInputElement} */ (doc.getElementById('pr-search'))
  const clear = /** @type {HTMLButtonElement} */ (doc.getElementById('pr-search-clear'))
  const box = /** @type {HTMLElement} */ (input.closest('.search-box'))
  const count = el(doc, 'p', 'small muted search-count')
  count.id = 'search-count'
  count.setAttribute('role', 'status')
  count.hidden = true
  input.closest('.filter-bar')?.after(count)
  // The layer over the field that colors AND and OR: while the text holds one, the field's own
  // text goes clear and this draws it, at the same place, scrolled as the field is.
  const mirror = el(doc, 'div', 'search-mirror')
  mirror.setAttribute('aria-hidden', 'true')
  const line = el(doc, 'span', 'search-mirror-line')
  mirror.append(line)
  input.after(mirror)
  input.value = value()
  let timer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)

  const paint = () => {
    clear.hidden = input.value === ''
    const parts = searchSyntax(doc, input.value)
    const colored = parts.some(p => typeof p !== 'string')
    box.classList.toggle('has-syntax', colored)
    line.replaceChildren(...(colored ? parts : []))
    line.style.transform = `translateX(${-input.scrollLeft}px)`
  }
  const settle = () => {
    clearTimeout(timer)
    timer = undefined
    const next = searchText(input.value)
    if (next !== value()) set(next)
  }
  // The box and its colors follow each key at once; the rows wait for a pause in typing.
  input.addEventListener('input', () => {
    paint()
    clearTimeout(timer)
    timer = setTimeout(settle, SEARCH_DELAY_MS)
  })
  // The caret moving can scroll the field; the layer follows.
  for (const type of ['scroll', 'keyup', 'click', 'select', 'focus']) input.addEventListener(type, paint)
  const empty = () => {
    input.value = ''
    paint()
    settle()
  }
  clear.addEventListener('click', () => {
    empty()
    input.focus()
  })
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (input.value !== '') empty()
      else input.blur()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      settle()
      const href = single()
      if (href !== null) doc.defaultView?.location.assign(href)
    }
  })
  doc.addEventListener('keydown', event => {
    if (!wantsSearch(event)) return
    event.preventDefault()
    input.focus()
    input.select()
  })
  paint()

  return {
    /** The search in effect now, as alternatives of words. */
    query: () => parseSearch(value()),
    /** Whether a search is in effect: any word, not only operators. */
    active: () => parseSearch(value()).length > 0,
    /** The search as typed, for the empty state. */
    text: () => value(),
    /** Empties the box, as its × does. */
    clear: empty,
    /**
     * Puts the page's search in the box when it changed from elsewhere, a saved filter or Back,
     * leaving it alone while you type.
     */
    sync() {
      if (timer !== undefined || searchText(input.value) === value()) return
      input.value = value()
      paint()
    },
    /** Names Jira keys in the placeholder only while the repo's Jira switch is on. @param {boolean} jira */
    setJira(jira) {
      input.placeholder = jira ? TEXTS.lists.search.placeholderJira : TEXTS.lists.search.placeholder
    },
    /**
     * Says how many match, while searching: "4 of 23 PRs", or on the Inbox "6 events on 3 PRs".
     * @param {string} text
     */
    showCount(text) {
      count.hidden = !this.active()
      count.textContent = this.active() ? text : ''
    },
  }
}

/** `n` and the noun, plural past one. @param {number} n @param {string} one @param {string} [many] */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * The empty state while a search finds nothing: what was searched, Clear search, and when the
 * filters hide PRs that do match, how many and a way to reset the filters.
 * @param {HTMLElement} node the page's empty-state card
 * @param {{ query: string, hidden: number, clear: () => void, reset: () => void }} opts
 */
export function searchEmpty(node, { query, hidden, clear, reset }) {
  const doc = node.ownerDocument
  node.classList.remove('loading')
  const clearButton = el(doc, 'button', 'link-button', 'Clear search')
  clearButton.setAttribute('type', 'button')
  clearButton.addEventListener('click', clear)
  const resetButton = el(doc, 'button', 'link-button', 'Reset filters')
  resetButton.setAttribute('type', 'button')
  resetButton.addEventListener('click', reset)
  node.replaceChildren(
    ...withSlots(TEXTS.lists.search.noMatch(query, hidden), { clear: clearButton, reset: resetButton })
  )
}
