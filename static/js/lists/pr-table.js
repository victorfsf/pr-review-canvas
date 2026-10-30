// @ts-check
// The PR tables on Your PRs and the Review queue: one <table> per list, its header with each
// column's sort button and "?" legend, then a body per section under its colored row. The rows are
// whole, or slim: one line each, nothing in them wrapping, with an arrow that opens the rest of
// the PR (its branches and links, and on Highest priority why it was picked) in a row under it. The toolbar's view button
// switches between the two, kept per repo and page with the folds; its Expand all opens or shuts
// every slim row the page shows.
import { button, el, iconNode, paintIconButton } from './dom.js'
import { sortButton } from './sorting.js'
import { TEXTS } from './texts.js'

/**
 * @template R
 * @typedef {{ name: string | null, tone: string, rows: readonly R[] }} RowGroup
 */

/**
 * A table of PRs: the header, then one body per group with rows, a named group under its section
 * row, folded to that row alone when its section is.
 * @template R
 * @param {Document} doc
 * @param {{
 *   label: string,
 *   columns: readonly (readonly [string, string])[],
 *   help?: Readonly<Record<string, string>>,
 *   sort: { sort: readonly string[], onSort: (next: string[]) => void, sortable: (key: string) => boolean } | null,
 *   groups: readonly RowGroup<R>[],
 *   folds: { folded: (key: string) => boolean, sectionButton: (name: string, count: number) => HTMLButtonElement },
 *   rows: (row: R) => HTMLTableRowElement[],
 *   slim: boolean,
 * }} opts `columns` are those that show, between Pull request and Actions; `help` names the
 *   page's template whose "?" follows a column's name; `sort` is null for a table whose rows keep
 *   their order; `rows` draws a row, and its open part under it when slim
 */
export function prTable(doc, opts) {
  const t = el(doc, 'table', `queue-grid${opts.slim ? ' slim' : ''}`)
  t.setAttribute('aria-label', opts.label)
  const head = el(doc, 'thead')
  const tr = el(doc, 'tr')
  /** Puts the "?" from the page's template `id` after `heading`; each table's copy gets its own id. */
  const helpAfter = (/** @type {HTMLElement} */ heading, /** @type {string} */ id) => {
    const help = doc.getElementById(id)
    if (!(help instanceof HTMLTemplateElement)) return
    const legend = /** @type {DocumentFragment} */ (help.content.cloneNode(true))
    const tip = `${help.id}-${opts.label.toLowerCase().replace(/\W+/g, '-')}`
    legend.querySelector('[role="tooltip"]')?.setAttribute('id', tip)
    legend.querySelector('.help-button')?.setAttribute('aria-describedby', tip)
    heading.append(legend)
  }
  /** A header cell: its sort button when the column sorts, then its "?" when it has one. */
  const headCell = (/** @type {string} */ key, /** @type {string} */ words) => {
    const th = el(doc, 'th')
    th.dataset['col'] = key
    const sort = opts.sort
    const name =
      sort !== null && sort.sortable(key)
        ? sortButton(doc, th, { key, words, sort: sort.sort, onSort: sort.onSort })
        : doc.createTextNode(words)
    const help = opts.help?.[key]
    if (help === undefined) th.append(name)
    else {
      // The flex row sits inside the cell, so the cell stays a table cell like its neighbours.
      const wrap = el(doc, 'span', 'head-with-help')
      wrap.append(name, ' ')
      th.append(wrap)
      helpAfter(wrap, help)
    }
    return th
  }
  tr.append(headCell('pr', 'Pull request'))
  for (const [key, words] of opts.columns) tr.append(headCell(key, words))
  tr.append(el(doc, 'th', 'actions-head', 'Actions'))
  head.append(tr)
  t.append(head)
  const span = tr.childElementCount
  for (const group of opts.groups) {
    if (group.rows.length === 0) continue
    const body = el(doc, 'tbody')
    if (group.name !== null) {
      const row = el(doc, 'tr', `section-row ${group.tone}`)
      const th = el(doc, 'th')
      th.setAttribute('colspan', String(span))
      th.setAttribute('scope', 'rowgroup')
      const fold = opts.folds.sectionButton(group.name, group.rows.length)
      th.append(fold)
      row.append(th)
      body.append(row)
      // A folded section keeps its row only.
      if (opts.folds.folded(String(fold.dataset['fold']))) {
        t.append(body)
        continue
      }
    }
    for (const r of group.rows) body.append(...opts.rows(r))
    t.append(body)
  }
  return t
}

/**
 * How many cells a row of a table with `columns` showing spans: theirs, Pull request's and Actions'.
 * @param {number} columns
 */
export const rowSpan = columns => columns + 2

/**
 * The row under an open slim row: what its one line left out, across every column.
 * @param {Document} doc
 * @param {number} span
 * @param {readonly Node[]} parts
 */
export function openRow(doc, span, parts) {
  const tr = /** @type {HTMLTableRowElement} */ (el(doc, 'tr', 'row-open'))
  const td = el(doc, 'td')
  td.setAttribute('colspan', String(span))
  const body = el(doc, 'div', 'row-open-body')
  body.append(...parts)
  td.append(body)
  tr.append(td)
  return tr
}

/**
 * The Labels cell: every label, or, slim, the first and "+N" for the rest, whose popup lists them
 * on hover and keyboard focus, as Reviewed by's "+N" does (reviewers.js); Escape closes it until
 * the pointer or focus leaves. A long label in the cell is cut short; its whole name shows on hover.
 * @param {Document} doc
 * @param {readonly string[]} labels
 * @param {boolean} slim
 */
export function labelsNode(doc, labels, slim) {
  const badges = el(doc, 'span', 'queue-labels')
  const badge = (/** @type {string} */ l) => {
    const b = el(doc, 'span', 'badge muted label-badge', l)
    b.title = l
    return b
  }
  const shown = slim ? labels.slice(0, 1) : labels
  badges.append(...shown.map(badge))
  const rest = labels.slice(shown.length)
  if (rest.length === 0) return badges
  const more = button(doc, 'badge muted label-more', `+${rest.length}`)
  more.setAttribute('aria-label', TEXTS.lists.rows.moreLabels(rest))
  // What a sighted reader sees on hover. The button's label already says all of it in words, so
  // the popup is hidden from assistive tech.
  const popup = el(doc, 'ul', 'reviewer-popup label-popup')
  popup.setAttribute('aria-hidden', 'true')
  for (const l of rest) {
    const li = el(doc, 'li')
    li.append(el(doc, 'span', 'badge muted', l))
    popup.append(li)
  }
  const wrap = el(doc, 'span', 'reviewer-more')
  wrap.addEventListener('keydown', event => {
    if (event.key === 'Escape') wrap.classList.add('popup-closed')
  })
  const reset = () => wrap.classList.remove('popup-closed')
  wrap.addEventListener('mouseleave', reset)
  wrap.addEventListener('focusout', reset)
  wrap.append(more, popup)
  badges.append(wrap)
  return badges
}

/**
 * The toolbar's view and Expand all buttons, and which slim rows are open, by PR number. Opening
 * a row opens every copy of its PR on the page, as one PR can sit in two tables.
 * @param {Document} doc
 * @param {{ folds: { slim: () => boolean, setSlim: (on: boolean) => void }, render: () => void }} opts
 */
export function wireRowView(doc, opts) {
  const view = /** @type {HTMLButtonElement} */ (doc.getElementById('slim-rows'))
  const foldAll = /** @type {HTMLButtonElement} */ (doc.getElementById('fold-rows'))
  /** @type {Set<number>} */
  const open = new Set()
  /** The PRs the slim rows show, as last drawn. */
  let drawn = /** @type {number[]} */ ([])
  const paint = () => {
    const slim = opts.folds.slim()
    view.setAttribute('aria-pressed', String(slim))
    paintIconButton(
      doc,
      view,
      slim ? 'listDetails' : 'list',
      slim ? TEXTS.lists.rows.whole : TEXTS.lists.rows.slim
    )
    // Whole rows have nothing to open.
    foldAll.hidden = !slim
    const expand = drawn.length === 0 || drawn.some(n => !open.has(n))
    foldAll.disabled = drawn.length === 0
    paintIconButton(
      doc,
      foldAll,
      expand ? 'chevronsDown' : 'chevronsUp',
      expand ? TEXTS.lists.rows.expandAll : TEXTS.lists.rows.collapseAll
    )
    foldAll.dataset['expand'] = String(expand)
  }
  view.addEventListener('click', () => opts.folds.setSlim(!opts.folds.slim()))
  foldAll.addEventListener('click', () => {
    const expand = foldAll.dataset['expand'] === 'true'
    for (const n of drawn) {
      if (expand) open.add(n)
      else open.delete(n)
    }
    opts.render()
  })
  paint()
  return {
    /** Whether the rows are slim. */
    slim: () => opts.folds.slim(),
    /** Whether a PR's slim rows are open. @param {number} pr */
    isOpen: (/** @type {number} */ pr) => open.has(pr),
    /** Opens a PR's slim rows, as a link to it does; the page draws them. @param {number} pr */
    open: (/** @type {number} */ pr) => void open.add(pr),
    /**
     * A slim row's arrow, opening or shutting it.
     * @param {number} pr
     */
    arrow(pr) {
      const shown = open.has(pr)
      const b = button(doc, 'row-arrow', '')
      b.setAttribute('aria-expanded', String(shown))
      b.setAttribute('aria-label', shown ? TEXTS.lists.rows.hide(pr) : TEXTS.lists.rows.show(pr))
      b.title = b.getAttribute('aria-label') ?? ''
      b.dataset['arrow'] = String(pr)
      b.append(iconNode(doc, 'chevronRight', 14))
      b.addEventListener('click', () => {
        const table = b.closest('table')?.getAttribute('aria-label')
        if (open.has(pr)) open.delete(pr)
        else open.add(pr)
        opts.render()
        // The row is drawn again: focus goes to its new arrow, in the same table.
        const again = [...doc.querySelectorAll(`button[data-arrow="${pr}"]`)].find(
          a => a.closest('table')?.getAttribute('aria-label') === table
        )
        if (again instanceof HTMLElement) again.focus()
      })
      return b
    },
    /** Says which PRs the slim rows show now, for Expand all. @param {readonly number[]} prs */
    drawn(prs) {
      drawn = opts.folds.slim() ? [...new Set(prs)] : []
      paint()
    },
  }
}

/** @typedef {ReturnType<typeof wireRowView>} RowView */
