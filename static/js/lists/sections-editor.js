// @ts-check
// The sections editor: a modal dialog, opened by any "Edit sections" button on the page. Rows move
// up and down, are renamed, take a color, take labels (suggested from the open PRs' labels, any
// typed label allowed) and can be deleted; the catch-all stays last with no labels. A preview counts how today's
// open PRs split across the sections. Nothing is saved until "Save sections".
import { api } from './api.js'
import { button, el, iconNode } from './dom.js'
import { labelCounts } from './queue.js'
import {
  DEFAULT_SECTIONS,
  defaultSectionColor,
  groupBySection,
  MAX_SECTIONS,
  SECTION_COLORS,
} from './sections.js'
import { swatchPicker } from './swatches.js'
import { TEXTS } from './texts.js'

/** @typedef {import('./sections.js').Section} Section */
/** @typedef {{ number: number, title: string, labels: string[] }} PreviewPull */

/**
 * The preview line: how many PRs each section would take.
 * @param {readonly Section[]} sections
 * @param {readonly PreviewPull[]} pulls
 */
export function previewText(sections, pulls) {
  const split = groupBySection(pulls, sections)
    .map(g => `${g.section.name || 'Unnamed'} ${g.items.length}`)
    .join(' · ')
  return `${split}.`
}

/**
 * Each section with its color made its own: the one it has, or the one its place gives. The editor
 * saves them so, so a section keeps its color when it moves.
 * @param {readonly Section[]} sections
 * @returns {Section[]}
 */
export function withColors(sections) {
  return sections.map((s, i) => ({
    name: s.name,
    labels: [...s.labels],
    color: s.color ?? defaultSectionColor(i, sections.length),
  }))
}

/**
 * The sections as they would be saved: names trimmed, labels without duplicates (ignoring case),
 * the catch-all without labels, each color kept. Null with the reason when they cannot be saved.
 * @param {readonly Section[]} sections
 * @returns {{ sections: Section[] } | { error: string }}
 */
export function cleanSections(sections) {
  const cleaned = sections.map((s, i) => {
    /** @type {string[]} */
    const labels = []
    for (const label of s.labels.map(l => l.trim()).filter(l => l !== '')) {
      if (!labels.some(l => l.toLowerCase() === label.toLowerCase())) labels.push(label)
    }
    return {
      name: s.name.trim(),
      labels: i === sections.length - 1 ? [] : labels,
      ...(s.color === undefined ? {} : { color: s.color }),
    }
  })
  if (cleaned.some(s => s.name === '')) return { error: TEXTS.lists.sectionsEditor.needsName }
  return { sections: cleaned }
}

/** @param {Document} doc */
export function wireSectionsEditor(doc) {
  const dialog = /** @type {HTMLDialogElement | null} */ (doc.getElementById('sections-dialog'))
  if (dialog === null) return
  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id))
  const list = get('section-rows')
  const options = get('label-options')
  const preview = get('section-preview')
  const error = get('sections-error')
  const add = /** @type {HTMLButtonElement} */ (get('section-add'))
  /** @type {Section[]} */
  let draft = []
  /** @type {PreviewPull[]} */
  let pulls = []

  const fail = (/** @type {string | null} */ text) => {
    error.hidden = text === null
    error.textContent = text ?? ''
  }

  /** Re-draws the rows, keeping focus on the control at `focus` when given. */
  const render = (/** @type {string} */ focus = '') => {
    const last = draft.length - 1
    list.replaceChildren(
      ...draft.map((section, i) => {
        const li = el(doc, 'li', i === last ? 'section-row catch-all' : 'section-row')
        const name = /** @type {HTMLInputElement} */ (el(doc, 'input', 'text-input section-name'))
        name.type = 'text'
        name.value = section.name
        name.maxLength = 60
        name.dataset['focus'] = `name-${i}`
        name.setAttribute('aria-label', i === last ? 'Catch-all section name' : `Name of section ${i + 1}`)
        name.addEventListener('input', () => {
          draft[i] = { .../** @type {Section} */ (draft[i]), name: name.value }
          preview.textContent = previewText(draft, pulls)
        })
        const color = swatchPicker(doc, {
          colors: SECTION_COLORS,
          value: section.color ?? defaultSectionColor(i, draft.length),
          label: `Color of ${section.name || `section ${i + 1}`}`,
          focusKey: String(i),
          pick: picked => {
            draft[i] = {
              .../** @type {Section} */ (draft[i]),
              color: /** @type {import('./sections.js').SectionColor} */ (picked),
            }
            render(`${picked}-${i}`)
          },
        })
        const order = el(doc, 'span', 'section-order')
        if (i === last) {
          order.append(el(doc, 'span', 'badge muted', 'Last'))
          li.append(
            order,
            name,
            color,
            el(doc, 'span', 'small muted', TEXTS.lists.sectionsEditor.catchAll),
            el(doc, 'span')
          )
          return li
        }
        const move = (/** @type {number} */ to, /** @type {string} */ label, /** @type {string} */ icon) => {
          const b = button(doc, 'icon-button small-icon-button', '')
          b.append(iconNode(doc, icon, 14))
          b.setAttribute('aria-label', `Move ${section.name || 'this section'} ${label}`)
          b.title = `Move ${label}`
          b.dataset['focus'] = `${label}-${to}`
          b.disabled = to < 0 || to >= last
          b.addEventListener('click', () => {
            const [moved] = draft.splice(i, 1)
            draft.splice(to, 0, /** @type {Section} */ (moved))
            render(`${label}-${to + (label === 'up' ? -1 : 1)}`)
          })
          return b
        }
        order.append(move(i - 1, 'up', 'arrowUp'), move(i + 1, 'down', 'arrowDown'))
        const labels = el(doc, 'span', 'section-labels')
        for (const label of section.labels) {
          // A long label is cut short; its whole name shows on hover.
          const chip = el(doc, 'span', 'chip')
          chip.title = label
          chip.append(el(doc, 'span', 'chip-text', label))
          const remove = button(doc, 'chip-remove', '×')
          remove.setAttribute('aria-label', `Remove label ${label}`)
          remove.addEventListener('click', () => {
            const now = /** @type {Section} */ (draft[i])
            draft[i] = { ...now, labels: now.labels.filter(l => l !== label) }
            render(`label-${i}`)
          })
          chip.append(remove)
          labels.append(chip)
        }
        const input = /** @type {HTMLInputElement} */ (el(doc, 'input', 'text-input label-input'))
        input.type = 'text'
        input.placeholder = TEXTS.lists.sectionsEditor.addLabel
        input.setAttribute('list', 'label-options')
        input.setAttribute('aria-label', `Add label to ${section.name || `section ${i + 1}`}`)
        input.dataset['focus'] = `label-${i}`
        const take = () => {
          const label = input.value.trim()
          if (label === '') return
          const now = /** @type {Section} */ (draft[i])
          draft[i] = { ...now, labels: [...now.labels, label] }
          render(`label-${i}`)
        }
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            take()
          }
        })
        input.addEventListener('change', take)
        labels.append(input)
        const remove = button(doc, 'icon-button small-icon-button', '')
        remove.append(iconNode(doc, 'trash', 14))
        remove.setAttribute('aria-label', `Delete section ${section.name || i + 1}`)
        remove.title = 'Delete section'
        remove.addEventListener('click', () => {
          draft.splice(i, 1)
          render('add')
        })
        li.append(order, name, color, labels, remove)
        return li
      })
    )
    add.disabled = draft.length >= MAX_SECTIONS
    preview.textContent = previewText(draft, pulls)
    const target = focus === 'add' ? add : list.querySelector(`[data-focus="${focus}"]`)
    if (target instanceof HTMLElement) target.focus()
  }

  const open = async () => {
    fail(null)
    try {
      const data = await api(`lists-sections`)
      draft = withColors(data.sections)
      pulls = data.pulls
    } catch (err) {
      draft = withColors(DEFAULT_SECTIONS)
      fail(TEXTS.lists.sectionsEditor.couldNotLoad(/** @type {Error} */ (err).message))
    }
    options.replaceChildren(
      ...labelCounts(pulls).map(({ name, count }) => {
        const option = /** @type {HTMLOptionElement} */ (el(doc, 'option'))
        option.value = name
        option.label = `${name} · ${count === 1 ? '1 open PR' : `${count} open PRs`}`
        return option
      })
    )
    render()
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }

  const close = () => {
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  }

  for (const opener of doc.querySelectorAll('[data-open-sections]')) {
    opener.addEventListener('click', () => void open())
  }
  add.addEventListener('click', () => {
    // A new section takes a color no section has yet, while there is one.
    const color = SECTION_COLORS.find(c => !draft.some(s => s.color === c)) ?? 'blue'
    draft.splice(draft.length - 1, 0, { name: '', labels: [], color })
    render(`name-${draft.length - 2}`)
  })
  get('sections-reset').addEventListener('click', () => {
    draft = withColors(DEFAULT_SECTIONS)
    render()
  })
  get('sections-cancel').addEventListener('click', close)
  get('sections-close').addEventListener('click', close)
  get('sections-save').addEventListener('click', async () => {
    const result = cleanSections(draft)
    if ('error' in result) {
      fail(result.error)
      return
    }
    try {
      const saved = await api(`lists-sections`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result),
      })
      fail(null)
      close()
      doc.dispatchEvent(new CustomEvent('pr-greenlight:sections', { detail: saved.sections }))
    } catch (err) {
      fail(TEXTS.lists.editors.notSaved(/** @type {Error} */ (err).message))
    }
  })
}
