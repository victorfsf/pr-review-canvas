// @ts-check
// Folding on Your PRs, the Review queue, the Inbox and Settings: each table (on Settings, each
// section) folds shut from its heading, like an
// accordion, and each section inside a table folds from its colored row. Tables and sections keep
// their places and the space between them; a folded one keeps its heading or row and loses its
// PRs. What is folded is saved per repo and page, like the hidden columns (see filters.js). On
// Your PRs and the Review queue, the folded tables also go in the address (`fold`), so a link
// opens them the same way; `fold` with no value opens every table. Section folds stay saved only,
// as does whether the tables' rows are slim.
import { el, iconNode } from './dom.js'
import { loadFolds, saveFolds } from './filters.js'
import { queryParams, setQuery } from './url-state.js'

/**
 * A section's fold key: its name, ignoring case.
 * @param {string} name
 */
export const sectionFold = name => `section:${name.toLowerCase()}`

/** Kept with the folds while the tables' rows are slim (see pr-table.js): one line each. */
const SLIM = 'view:slim'

/**
 * A table's fold, as its heading's `data-fold`; a section's starts with `section:`, and how the
 * rows show with `view:`.
 * @param {string} key
 */
const tableFold = key => key !== '' && !key.startsWith('section:') && !key.startsWith('view:')

/** Your PRs and the Review queue keep their table folds in the address. @param {string} page */
const inQuery = page => page === 'pulls' || page === 'queue'

/**
 * The tables `fold` names, or null when the address does not name them. An empty `fold` is every
 * table open. Unknown names are left out.
 * @param {ReadonlySet<string>} known the table folds this page has
 * @returns {string[] | null}
 */
function tablesFromQuery(known) {
  const params = queryParams()
  if (!params.has('fold')) return null
  return params.getAll('fold').filter(key => known.has(key))
}

/**
 * Writes the folded tables into the address. With none folded, `keepOpen` leaves an empty `fold`
 * so a link that opened every table stays open; otherwise the parameter goes.
 * @param {ReadonlySet<string>} folded
 * @param {boolean} keepOpen
 */
function writeTables(folded, keepOpen) {
  const tables = [...folded].filter(tableFold)
  setQuery({ fold: tables.length > 0 ? tables : keepOpen ? '' : null })
}

/**
 * Wires every fold button on the page (`data-fold`, with `aria-controls` naming what it folds) and
 * makes the section rows' buttons. `onChange` hears each fold, so the page redraws its sections.
 * @param {Document} doc
 * @param {{ repo: { owner: string, name: string }, page: 'pulls' | 'queue' | 'inbox' | 'settings', onChange: () => void }} opts
 */
export function wireFolds(doc, opts) {
  const stored = loadFolds(opts.repo, opts.page)
  const known = new Set(
    [...doc.querySelectorAll('button[data-fold]')]
      .map(button => /** @type {HTMLElement} */ (button).dataset['fold'] ?? '')
      .filter(tableFold)
  )
  const fromQuery = inQuery(opts.page) ? tablesFromQuery(known) : null
  // The address wins for tables when it names them. Section folds always come from what was saved.
  let folded = new Set(fromQuery === null ? stored : [...stored.filter(key => !tableFold(key)), ...fromQuery])
  /** @param {boolean} keepOpen */
  const publish = keepOpen => {
    if (inQuery(opts.page)) writeTables(folded, keepOpen)
  }

  /** Shows each heading's state, and hides what a folded heading controls. */
  const paint = () => {
    for (const button of doc.querySelectorAll('button[data-fold]')) {
      const key = /** @type {HTMLElement} */ (button).dataset['fold'] ?? ''
      button.setAttribute('aria-expanded', String(!folded.has(key)))
      const body = doc.getElementById(button.getAttribute('aria-controls') ?? '')
      if (body !== null) body.hidden = folded.has(key)
    }
  }

  /** @param {string} key @param {boolean} shut */
  const set = (key, shut) => {
    if (folded.has(key) === shut) return
    folded = new Set(folded)
    if (shut) folded.add(key)
    else folded.delete(key)
    saveFolds(opts.repo, opts.page, [...folded])
    // A change is the page's own, so an empty `fold` left by a link can go once nothing is shut.
    publish(false)
    opts.onChange()
    paint()
  }

  const toggle = (/** @type {string} */ key) => {
    set(key, !folded.has(key))
    // A section's button is drawn again with its table: focus stays on the new one.
    const again = [...doc.querySelectorAll('button[data-fold]')].find(
      b => /** @type {HTMLElement} */ (b).dataset['fold'] === key
    )
    if (again instanceof HTMLElement && doc.activeElement !== again) again.focus()
  }

  for (const button of doc.querySelectorAll('button[data-fold]')) {
    const key = /** @type {HTMLElement} */ (button).dataset['fold'] ?? ''
    button.addEventListener('click', () => toggle(key))
  }
  publish(fromQuery !== null && fromQuery.length === 0)
  paint()

  return {
    /** Whether a table or section is folded. @param {string} key */
    folded: (/** @type {string} */ key) => folded.has(key),
    /** Opens a table or section, as a link to a PR in it does. @param {string} key */
    open: (/** @type {string} */ key) => set(key, false),
    /** Whether the tables' rows are slim. */
    slim: () => folded.has(SLIM),
    /** Makes the tables' rows slim, or shows them whole again. @param {boolean} on */
    setSlim: (/** @type {boolean} */ on) => set(SLIM, on),
    /** Folds every table shut, or opens every one. @param {boolean} shut */
    all(shut) {
      const next = new Set([...folded].filter(key => !tableFold(key)))
      if (shut) for (const key of known) next.add(key)
      folded = next
      saveFolds(opts.repo, opts.page, [...folded])
      publish(false)
      opts.onChange()
      paint()
    },
    /**
     * A section row's button: the section's name and count, folding its PRs.
     * @param {string} name
     * @param {number} count
     */
    sectionButton(name, count) {
      const key = sectionFold(name)
      const button = /** @type {HTMLButtonElement} */ (el(doc, 'button', 'fold-button section-fold'))
      button.type = 'button'
      button.dataset['fold'] = key
      button.setAttribute('aria-expanded', String(!folded.has(key)))
      button.append(
        iconNode(doc, 'chevronRight', 12),
        el(doc, 'span', 'fold-title', name),
        el(doc, 'span', 'section-count', ` · ${count === 1 ? '1 PR' : `${count} PRs`}`)
      )
      button.addEventListener('click', () => toggle(key))
      return button
    },
  }
}
