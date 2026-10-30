// @ts-check
// The project home page's tables: its `main[data-page]` says which, Your PRs or the Review queue.
// Each loads its own module; the Sync now button, the sections and base branches editors and the
// "?" legends are shared.
import { wireBranchesEditor } from './branches-editor.js'
import { wireHelp } from './help.js'
import { wireSyncNow } from './repo-actions.js'
import { wireSectionsEditor } from './sections-editor.js'

/** Each table's module and how to wire it. */
const PAGES = /** @type {Record<string, () => Promise<(doc: Document) => unknown>>} */ ({
  pulls: () => import('./pulls-page.js').then(m => m.wirePullsPage),
  queue: () => import('./queue-page.js').then(m => m.wireQueuePage),
})

/**
 * Wires the home page's table and what it shares.
 * @param {Document} doc
 */
export async function wireHomePage(doc) {
  const main = doc.querySelector('main[data-page]')
  if (!(main instanceof HTMLElement)) return
  wireHelp(doc)
  wireSyncNow(doc)
  wireSectionsEditor(doc)
  wireBranchesEditor(doc)
  const load = PAGES[main.dataset['page'] ?? '']
  if (load !== undefined) await (await load())(doc)
}

if (typeof document !== 'undefined') void wireHomePage(document)
