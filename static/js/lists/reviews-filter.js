// @ts-check
// The Reviews filter, on Your PRs and the Review queue: the review states, and on the queue whether
// a PR asks you by name for your review, all ticked to start; a PR needs a ticked choice of each
// group that has one (see `keepsReviews`). Then Author attention points and Reviewer attention
// points, each of which must hold once checked.
// Canvas and bot reviews are the Integrations filter's. The server draws the popup; `reviewsFilter` in html.ts.
import { wireFilterPanel } from './dom.js'
import { tick, ticked } from './filters.js'
import { reviewChoices, reviewFilterLabel } from './pulls.js'

/** @typedef {import('./pulls.js').ReviewsPicked} ReviewsPicked */

/**
 * Wires the popup: each box ticks or unticks its choice or checks its flag, and All and None tick
 * or untick every choice. `render` sets the boxes and the button's words.
 * @param {Document} doc
 * @param {{ picked: () => ReviewsPicked, pick: (next: Partial<ReviewsPicked>) => void, queue?: boolean }} opts
 * @returns {{ render: () => void }}
 */
export function wireReviewsFilter(doc, opts) {
  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id))
  const panel = get('review-filter')
  const choices = /** @type {HTMLInputElement[]} */ ([...panel.querySelectorAll('input[data-review]')])
  const flags = /** @type {HTMLInputElement[]} */ ([...panel.querySelectorAll('input[data-filter]')])
  const all = reviewChoices(opts.queue).map(([key]) => key)
  for (const box of choices) {
    box.addEventListener('change', () =>
      opts.pick({ reviews: tick(opts.picked().reviews, box.dataset['review'] ?? '', box.checked, all) })
    )
  }
  for (const box of flags) {
    box.addEventListener('change', () =>
      opts.pick({ [/** @type {string} */ (box.dataset['filter'])]: box.checked })
    )
  }
  get('reviews-all').addEventListener('click', () => opts.pick({ reviews: null }))
  get('reviews-none').addEventListener('click', () => opts.pick({ reviews: [] }))
  wireFilterPanel(doc, get('review-filter-button'), panel)
  return {
    render() {
      const picked = opts.picked()
      for (const box of choices) box.checked = ticked(picked.reviews, box.dataset['review'] ?? '')
      for (const box of flags)
        box.checked = picked[/** @type {import('./pulls.js').ReviewFlag} */ (box.dataset['filter'])] === true
      get('review-filter-label').textContent = reviewFilterLabel(picked, opts.queue)
    },
  }
}
