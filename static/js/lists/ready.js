// @ts-check
// What Your PRs and the Review queue both draw of a PR's state: the mark before its title (open, a
// draft, or in GitHub's merge queue), and the Ready column: how long it has been ready for review,
// or, once in the merge queue, the queue's mark and how long it has been in it. Both count to when
// GitHub was last read (`asOf`), so they move with the syncs alone, never on a timer or a redraw.
import { el, externalLink, iconNode } from './dom.js'
import { mergeQueueUrl, readySince, STATE_LOOK, stateOf } from './states.js'
import { TEXTS } from './texts.js'
import { duration } from './time.js'

/**
 * The moment a table's times are counted to: when GitHub was last read for it (`fetched`), else
 * when the page loaded its data. So a time moves only when a sync brings new data, never on a
 * redraw of the page's own (a filter, a fold, a search).
 * @param {string | null | undefined} fetched
 * @param {number} loaded
 */
export const asOf = (fetched, loaded) => {
  const at = Date.parse(fetched ?? '')
  return Number.isNaN(at) ? loaded : at
}

/**
 * A PR's state mark, before its title: an icon in its state's tone, its state in its tooltip and
 * its name for screen readers.
 * @param {Document} doc
 * @param {{ isDraft: boolean, queuedAt?: string | null }} pr
 */
export function stateMark(doc, pr) {
  const state = stateOf(pr)
  // The icon sits in a box that holds the tooltip: the page's tooltips go on its elements, not on
  // an icon's drawing.
  const mark = el(doc, 'span', `pull-state ${STATE_LOOK[state].tone}`)
  mark.setAttribute('role', 'img')
  mark.setAttribute('aria-label', TEXTS.lists.state[state])
  mark.title = TEXTS.lists.state[state]
  mark.append(iconNode(doc, STATE_LOOK[state].icon))
  return mark
}

/**
 * A PR's Ready cell content. A queued PR's is a link to its merge queue on GitHub, in a new tab:
 * the queue's mark and how long it has waited, its tooltip ending in the arrow of a link out.
 * @param {Document} doc
 * @param {{ readyAt?: string, createdAt?: string, queuedAt?: string | null, url: string, baseRefName: string }} pr
 * @param {number} now
 */
export function readyNode(doc, pr, now) {
  if (pr.queuedAt !== undefined && pr.queuedAt !== null) {
    const waited = duration(now - Date.parse(pr.queuedAt))
    const link = externalLink(doc, mergeQueueUrl(pr), 'ready-queued')
    link.append(iconNode(doc, 'gitMergeQueue', 14), waited)
    link.title = TEXTS.lists.ready.openQueue
    link.dataset['tipIcon'] = 'arrowUpRight'
    link.setAttribute('aria-label', TEXTS.lists.ready.openQueueFor(waited))
    return link
  }
  return el(doc, 'span', undefined, duration(now - Date.parse(readySince(pr))))
}
