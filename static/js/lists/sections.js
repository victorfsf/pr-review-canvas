// @ts-check
// Review queue sections: an ordered list per repo, each a name and the labels that put a PR in it.
// A PR goes in the first section whose labels it carries, ignoring case; the last section takes
// everything else and has no labels of its own. The Your PRs page groups your PRs the same way.

/** The colors a section's row can take; each is one of the scheme's status colors, gray its accent. */
export const SECTION_COLORS = /** @type {const} */ (['red', 'yellow', 'purple', 'green', 'blue', 'gray'])
/** @typedef {(typeof SECTION_COLORS)[number]} SectionColor */

/**
 * A section: its name, the labels that put a PR in it, and its row's color. A section saved
 * without a color takes the one its place gives (`defaultSectionColor`).
 * @typedef {{ name: string, labels: string[], color?: SectionColor | undefined }} Section
 */

/** What a repo starts with: by priority. */
export const DEFAULT_SECTIONS = /** @type {readonly Section[]} */ ([
  { name: 'Critical', labels: ['Critical'] },
  { name: 'Bugs', labels: ['bug'] },
  { name: 'Tasks', labels: [] },
])

/** How many sections a repo may have, catch-all included. */
export const MAX_SECTIONS = 12

/**
 * The index of the section a PR with these labels goes in.
 * @param {readonly string[]} labels
 * @param {readonly Section[]} sections
 */
export function sectionOf(labels, sections) {
  const carried = new Set(labels.map(l => l.toLowerCase()))
  const last = sections.length - 1
  const found = sections.findIndex((s, i) => i < last && s.labels.some(l => carried.has(l.toLowerCase())))
  return found === -1 ? last : found
}

/**
 * Every section a PR's labels match, catch-all aside: more than one means the first wins, which
 * the editor's preview names.
 * @param {readonly string[]} labels
 * @param {readonly Section[]} sections
 */
export function sectionsMatched(labels, sections) {
  const carried = new Set(labels.map(l => l.toLowerCase()))
  return sections
    .slice(0, -1)
    .flatMap((s, i) => (s.labels.some(l => carried.has(l.toLowerCase())) ? [i] : []))
}

/** The colors sections take by place: red, yellow, purple and green in turn; the catch-all gray. */
const BY_PLACE = /** @type {const} */ (['red', 'yellow', 'purple', 'green'])

/** The row class each color draws with. */
const TONES = /** @type {Record<SectionColor, string>} */ ({
  red: 'bad',
  yellow: 'warn',
  purple: 'done',
  green: 'ok',
  blue: 'info',
  gray: 'acc',
})

/**
 * The color a section takes when it has none of its own: the priority setup's red, yellow, then
 * purple and green, and gray for the catch-all.
 * @param {number} index
 * @param {number} count how many sections there are
 * @returns {SectionColor}
 */
export function defaultSectionColor(index, count) {
  return index === count - 1 ? 'gray' : /** @type {SectionColor} */ (BY_PLACE[index % BY_PLACE.length])
}

/**
 * A section row's class: its own color's, or the one its place gives.
 * @param {number} index
 * @param {number} count how many sections there are
 * @param {SectionColor} [color]
 * @returns {string}
 */
export function sectionTone(index, count, color) {
  return TONES[color ?? defaultSectionColor(index, count)]
}

/**
 * Splits items into the sections, keeping each section's order of items; an item without labels
 * goes in the catch-all. Every section is there, empty or not.
 * @template {{ labels?: readonly string[] }} T
 * @param {readonly T[]} items
 * @param {readonly Section[]} sections
 * @returns {{ section: Section, index: number, items: T[] }[]}
 */
export function groupBySection(items, sections) {
  const groups = sections.map((section, index) => ({ section, index, items: /** @type {T[]} */ ([]) }))
  for (const item of items) groups[sectionOf(item.labels ?? [], sections)]?.items.push(item)
  return groups
}
