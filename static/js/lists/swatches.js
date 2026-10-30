// @ts-check
// A color picker of swatches: one round button per color, each the scheme's own color for it, so
// the picker follows the color scheme. Main branches and label sections both pick with it.
import { button, el } from './dom.js'

/** A color's name as its swatch says it. */
export const colorName = (/** @type {string} */ color) => color.charAt(0).toUpperCase() + color.slice(1)

/**
 * The swatches for `colors`, `value` checked; a click calls `pick`. Each swatch carries
 * `data-focus="<color>-<focusKey>"`, so a re-drawn list can put focus back on it.
 * @param {Document} doc
 * @param {{ colors: readonly string[], value: string, label: string, focusKey: string, pick: (color: string) => void }} opts
 * @returns {HTMLElement}
 */
export function swatchPicker(doc, opts) {
  const group = el(doc, 'span', 'swatches')
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-label', opts.label)
  for (const color of opts.colors) {
    const swatch = button(doc, `swatch pill-${color}`, '')
    swatch.setAttribute('role', 'radio')
    swatch.setAttribute('aria-checked', String(color === opts.value))
    swatch.setAttribute('aria-label', colorName(color))
    swatch.title = colorName(color)
    swatch.dataset['focus'] = `${color}-${opts.focusKey}`
    swatch.addEventListener('click', () => opts.pick(color))
    group.append(swatch)
  }
  return group
}
