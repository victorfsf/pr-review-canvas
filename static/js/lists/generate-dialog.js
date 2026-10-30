// @ts-check
// Generate and Regenerate on the tables open the review page's own generate dialog (generate.js),
// for one PR: its start screen, with the agent, the sharing note and the choice to start from a
// blank page, then the job's progress until it ends, when the table loads again. The dialog reads
// what it shows of the PR from `lists-generate/<n>/dialog`, which answers from the lists and the
// canvas store, so it opens at once.
import { setApiBase } from '../api.js'
import { createGeneration } from '../generate.js'
import { api, projectBase } from './api.js'

/** One dialog side per PR, kept while the page is open: it follows its job across openings. */
const made = /** @type {Map<number, ReturnType<typeof createGeneration>>} */ (new Map())

/** Forgets the dialogs made; tests open one page after another. */
export function resetGenerateDialogs() {
  for (const generation of made.values()) generation.stop()
  made.clear()
}

/**
 * Opens the generate dialog for PR `number`; `started` hears when its job starts, so the row can
 * show it at once, and `ended` when it ends.
 * @param {Document} doc
 * @param {number} number
 * @param {() => void} ended
 * @param {() => void} [started]
 */
export async function openGenerateDialog(doc, number, ended, started) {
  // The dialog calls the review routes under this project's base, as the review page does.
  setApiBase(projectBase())
  let generation = made.get(number)
  if (generation === undefined) {
    // Each PR's dialog lives in a box of its own: the dialog listens for its clicks on its root,
    // so a shared root would start, stop or redo every PR whose dialog was ever opened.
    const root = doc.createElement('div')
    root.dataset['generateFor'] = String(number)
    doc.body.append(root)
    generation = createGeneration(root, {
      prNumber: number,
      onEnded: () => ended(),
      onStarted: () => started?.(),
    })
    made.set(number, generation)
  }
  const bundle = /** @type {import('../contract-types.js').PrBundle} */ (
    await api(`lists-generate/${number}/dialog`)
  )
  generation.open(bundle)
}
