// @ts-check
// The Canvas and Actions columns on Your PRs and the Review queue. Canvas is one badge: Pending
// while no canvas exists, Stale while one stands only for other commits, Ready once one stands for
// the head (by the canvas's own lookup on the server), and Generating while a generation
// runs; its tooltip says the rest, such as the phase or why the last one failed. Actions is one
// button, in the same place whatever it does: Generate or Regenerate, which open the review
// page's generate dialog for the PR; Stop while one runs; and Open once the canvas is ready, or
// where no agent can run, which opens the canvas in a new tab. Each action loads the table again,
// and a table with a generation under way keeps loading until it ends.
import { api } from './api.js'
import { button, el, externalLink, iconNode } from './dom.js'
import { openGenerateDialog } from './generate-dialog.js'
import { waysOf } from './title-menu.js'

/**
 * A row's generation as the server says it.
 * @typedef {{ state: 'running', phase: string, startedAt: string }
 *   | { state: 'failed', message: string, endedAt: string | null }} RowGeneration
 */

/** The phases in a tooltip's few words; the generate dialog says them at length. */
const PHASE_WORDS = /** @type {Record<string, string>} */ ({
  preparing: 'Preparing the diff',
  checkout: 'Checking out the head',
  generating: 'The agent is writing the canvas',
  publishing: 'Publishing',
  repairing: 'Fixing what publish rejected',
})

/** Each canvas status's tone. */
const TONE = /** @type {Record<string, string>} */ ({ Ready: 'ok', Stale: 'warn', Pending: 'muted' })

/** What each canvas status means, for its tooltip. */
const MEANING = /** @type {Record<string, string>} */ ({
  Ready: 'A canvas stands for its head commit',
  Stale: 'Its canvas is for other commits than its head',
  Pending: 'No canvas yet',
})

/** Tells the page to load its table again. @param {Document} doc */
const reload = doc => doc.querySelector('main[data-page]')?.dispatchEvent(new Event('pr-greenlight:synced'))

/**
 * Whether a row's generation still moves: the table keeps loading while one does.
 * @param {{ generation?: RowGeneration }} row
 */
export const generating = row => row.generation?.state === 'running'

/**
 * A row's Canvas cell: one badge.
 * @param {Document} doc
 * @param {{ number: number, canvas?: string, isDraft?: boolean, generation?: RowGeneration }} row
 * @returns {HTMLElement}
 */
export function canvasCell(doc, row) {
  const g = row.generation
  if (g?.state === 'running') {
    const badge = el(doc, 'span', 'badge acc canvas-state canvas-running')
    badge.append(iconNode(doc, 'rotateDot', 12), ' Generating')
    badge.title = `${PHASE_WORDS[g.phase] ?? 'Generating'}, since ${new Date(g.startedAt).toLocaleTimeString()}`
    return badge
  }
  const status = row.canvas !== undefined && TONE[row.canvas] !== undefined ? row.canvas : 'Pending'
  const failed = g?.state === 'failed'
  const badge = el(doc, 'span', `badge ${failed ? 'bad' : TONE[status]} canvas-state`, status)
  badge.title = failed
    ? `${MEANING[status]}. The last generation failed: ${g.message}`
    : /** @type {string} */ (MEANING[status])
  return badge
}

/**
 * A canvas's attention points still open: those for the author, and those for the reviewer.
 * @typedef {{ author: number, reviewer: number }} OpenPoints
 */

/** A count for its pill: muted at zero. @param {Document} doc @param {number} n @param {string} title */
const pointCount = (doc, n, title) => {
  const count = el(doc, 'span', n > 0 ? 'pending-count' : 'pending-count muted', String(n))
  count.title = title
  return count
}

/**
 * A row's Attention points cell, as the Review queue's Pending draws its two numbers: the points
 * still open for the author, then those for the reviewer (not resolved by the author, not
 * answered or in your pending review, not dismissed); a dash while it has no canvas.
 * @param {Document} doc
 * @param {OpenPoints | undefined} points
 * @returns {HTMLElement}
 */
export function pointsCell(doc, points) {
  if (points === undefined) {
    const none = el(doc, 'span', 'muted points-cell', '—')
    none.title = 'No canvas to count its attention points'
    return none
  }
  const pill = el(doc, 'span', 'badge pending-pill points-cell')
  // A drawn line between the two numbers, not a character a screen reader would read out.
  const divider = el(doc, 'span', 'pending-divider')
  divider.setAttribute('aria-hidden', 'true')
  pill.append(
    pointCount(doc, points.author, `${points.author} for the author`),
    divider,
    pointCount(doc, points.reviewer, `${points.reviewer} for the reviewer`)
  )
  return pill
}

/**
 * A row's Actions: one button, by where its canvas stands. Stop while a generation runs; Open once the canvas is ready, or where no agent can run; else Generate, or Regenerate for
 * a stale canvas, which open the generate dialog.
 * @param {Document} doc
 * @param {{ number: number, canvas?: string, generation?: RowGeneration }} row
 * @returns {HTMLElement}
 */
export function canvasAction(doc, row) {
  const ways = waysOf(doc, row.number)
  if (generating(row)) {
    const stop = button(doc, 'button small-button canvas-action', '')
    stop.append(iconNode(doc, 'square', 12), ' Stop')
    stop.title = 'Stop the generation'
    stop.setAttribute('aria-label', `${stop.title}: #${row.number}`)
    stop.addEventListener('click', () => {
      stop.disabled = true
      void api(`lists-generate/${row.number}`, { method: 'DELETE' }).then(
        () => reload(doc),
        () => reload(doc)
      )
    })
    return stop
  }
  if (!ways.agent || row.canvas === 'Ready') {
    const open = externalLink(doc, ways.canvas, 'button small-button canvas-action')
    open.append(iconNode(doc, 'browserCheck', 12), ' Open')
    open.title = `Open #${row.number} in the canvas, in a new tab`
    return open
  }
  const stale = row.canvas === 'Stale'
  const go = button(doc, 'button small-button canvas-action', '')
  go.append(iconNode(doc, 'brush', 12), stale ? ' Regenerate' : ' Generate')
  go.title = stale ? 'Generate a canvas for its head commit' : 'Generate its canvas'
  go.setAttribute('aria-label', `${go.title}: #${row.number}`)
  go.addEventListener('click', () => {
    void openGenerateDialog(doc, row.number, () => reload(doc)).catch(err => {
      go.title = `Could not open the dialog: ${err instanceof Error ? err.message : String(err)}`
      go.classList.add('bad')
    })
  })
  return go
}
