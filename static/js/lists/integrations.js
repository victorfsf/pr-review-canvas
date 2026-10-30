// @ts-check
// The Integrations filter, on Your PRs and the Review queue: one popup with a section per service a
// PR's state comes from, CodeRabbit, Vercel, GitHub and Canvas, as the Inbox's Filter groups its
// boxes. Every choice starts ticked, and the whole popup is one filter: a PR passes with any ticked
// choice, from any section (CI failing or CI stuck or Canvas stale). All ticked keeps every PR,
// even one no sync has read; none ticked keeps none.
// CodeRabbit's and Vercel's sections show only while the repo uses them (Settings → Integrations).
import { tick, ticked } from './filters.js'
import { healthStatus, STATUS_KIND } from './health.js'

/** @typedef {'codeRabbit' | 'vercel' | 'github' | 'canvas'} Section */

/**
 * Each section, in the popup's order, with its choices: the value a filter keeps and its words.
 * @type {readonly { key: Section, title: string, choices: readonly (readonly [string, string])[] }[]}
 */
export const INTEGRATION_SECTIONS = [
  {
    key: 'codeRabbit',
    title: 'CodeRabbit',
    choices: [
      ['Ready', 'Ready'],
      ['Outdated', 'Outdated'],
      ['Pending', 'Pending'],
      ['Skipped', 'Skipped'],
    ],
  },
  {
    key: 'vercel',
    title: 'Vercel',
    choices: [
      ['vercelReady', 'Ready'],
      ['vercelRunning', 'Running'],
      ['vercelFailed', 'Failed'],
    ],
  },
  {
    key: 'github',
    title: 'Checks',
    choices: [
      ['failing', 'CI failing'],
      ['passing', 'CI passing'],
      ['running', 'CI running'],
      ['stuck', 'CI stuck'],
      ['conflict', 'Merge conflict'],
      ['noConflict', 'No conflicts'],
    ],
  },
  {
    key: 'canvas',
    title: 'Canvas',
    choices: [
      ['Ready', 'Ready'],
      ['Stale', 'Stale'],
      ['Pending', 'Pending'],
    ],
  },
]

/** The values a section's filter may hold. @param {Section} section */
export const sectionValues = section =>
  INTEGRATION_SECTIONS.find(s => s.key === section)?.choices.map(([value]) => value) ?? []

/**
 * Each section's ticked choices; `null` ticks all of them.
 * @typedef {{ codeRabbit: string[] | null, vercel: string[] | null, github: string[] | null,
 *   canvas: string[] | null }} Picked
 * @typedef {{ health?: import('./health.js').Health | null | undefined,
 *   canvas?: string | null | undefined, codeRabbit?: string | null | undefined }} Subject
 */

/**
 * Which integrations the repo uses.
 * @typedef {{ codeRabbit: boolean, vercel: boolean, canvas?: boolean }} On
 */

/**
 * Whether a PR passes the Integrations filter: every choice shown ticked, or any ticked one it has.
 * A section that is off in the repo is not shown.
 * @param {Subject} pr
 * @param {Picked} f
 * @param {On} on Canvas is on unless false
 */
export function matchesIntegrations(pr, f, on) {
  const sections = shownSections(on)
  if (sections.every(s => f[s.key] === null)) return true
  return sections.some(s =>
    sectionValues(s.key).some(v => ticked(f[s.key], v) && hasIntegration(pr, s.key, v))
  )
}

/**
 * Whether a PR has one choice's state: for the filter, and the count beside the choice.
 * @param {Subject} pr
 * @param {Section} section
 * @param {string} value
 */
export function hasIntegration(pr, section, value) {
  if (section === 'codeRabbit' || section === 'canvas') return pr[section] === value
  return healthStatus(pr.health, STATUS_KIND[value] ?? '') === value
}

/**
 * The sections the popup shows, by what the repo uses.
 * @param {On} on
 */
const shownSections = on =>
  INTEGRATION_SECTIONS.filter(
    s =>
      (s.key !== 'codeRabbit' || on.codeRabbit) &&
      (s.key !== 'vercel' || on.vercel) &&
      (s.key !== 'canvas' || on.canvas !== false)
  )

/**
 * The filter button's words after "Integrations:": All, None, or how many of the choices shown
 * are ticked.
 * @param {Picked} f
 * @param {On} on
 */
export function integrationsLabel(f, on) {
  const choices = shownSections(on).flatMap(s => sectionValues(s.key).map(v => ({ s, v })))
  const count = choices.filter(({ s, v }) => ticked(f[s.key], v)).length
  if (count === choices.length) return 'All'
  return count === 0 ? 'None' : `${count} of ${choices.length}`
}

/**
 * Wires the popup the server drew: each box ticks or unticks its value, and All and None tick or
 * untick every choice shown. `render` sets the boxes, their counts, which sections show, and the
 * button's words.
 * @param {Document} doc
 * @param {{ picked: () => Picked, pick: (next: Partial<Picked>) => void }} opts
 */
export function wireIntegrationsFilter(doc, opts) {
  const panel = doc.getElementById('integrations-panel')
  const label = doc.getElementById('integrations-label')
  const boxes = /** @type {HTMLInputElement[]} */ ([
    ...(panel?.querySelectorAll('input[data-section]') ?? []),
  ])
  for (const box of boxes) {
    box.addEventListener('change', () => {
      const section = /** @type {Section} */ (box.dataset['section'])
      opts.pick({
        [section]: tick(opts.picked()[section], box.value, box.checked, sectionValues(section)),
      })
    })
  }
  /** @type {On} */
  let shown = { codeRabbit: true, vercel: true }
  doc
    .getElementById('integrations-all')
    ?.addEventListener('click', () =>
      opts.pick(Object.fromEntries(shownSections(shown).map(s => [s.key, null])))
    )
  doc
    .getElementById('integrations-none')
    ?.addEventListener('click', () =>
      opts.pick(Object.fromEntries(shownSections(shown).map(s => [s.key, []])))
    )
  return {
    /**
     * @param {On} on
     * @param {(section: Section, value: string) => number} count how many PRs have a choice's state
     */
    render(on, count) {
      shown = on
      const picked = opts.picked()
      for (const box of boxes) {
        const section = /** @type {Section} */ (box.dataset['section'])
        box.checked = ticked(picked[section], box.value)
        const counter = box.parentElement?.querySelector('.people-count')
        if (counter) counter.textContent = String(count(section, box.value))
      }
      for (const group of panel?.querySelectorAll('[data-integration]') ?? []) {
        const key = group.getAttribute('data-integration')
        group.toggleAttribute(
          'hidden',
          (key === 'codeRabbit' && !on.codeRabbit) ||
            (key === 'vercel' && !on.vercel) ||
            (key === 'canvas' && on.canvas === false)
        )
      }
      if (label !== null) label.textContent = integrationsLabel(picked, on)
    },
  }
}
