// @ts-check
// The project's base branches, edited in their dialog from the tab bar: one row each, with its
// name, its pill as the scheme draws it, and a swatch per color. Save sends the list, Cancel leaves
// it as it was; a list that cannot be saved (a branch without a name, one listed twice) is not
// sent, and the note says why. Until a list is saved, the repository's default branch is the one
// base. A save loads the table again, since stacks follow the bases.
import { api } from './api.js'
import { BRANCH_COLORS, cleanBranches, MAX_BRANCHES } from './branches.js'
import { button as makeButton, el, iconNode } from './dom.js'
import { swatchPicker } from './swatches.js'
import { TEXTS } from './texts.js'

/** @typedef {import('./branches.js').MainBranch} MainBranch */

/** @param {Document} doc */
export function wireBranchesEditor(doc) {
  const dialog = /** @type {HTMLDialogElement | null} */ (doc.getElementById('branches-dialog'))
  const list = doc.getElementById('branch-rows')
  const add = /** @type {HTMLButtonElement | null} */ (doc.getElementById('branch-add'))
  const error = doc.getElementById('branches-error')
  if (dialog === null || list === null || add === null || error === null) return
  /** @type {MainBranch[]} */
  let draft = []
  const fail = (/** @type {string | null} */ text) => {
    error.hidden = text === null
    error.textContent = text ?? ''
  }
  const close = () => (typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open'))

  doc.getElementById('branches-open')?.addEventListener('click', async () => {
    fail(null)
    try {
      draft = (await api('lists-branches')).branches
    } catch (err) {
      draft = []
      fail(`Could not load the branches: ${err instanceof Error ? err.message : String(err)}`)
    }
    render()
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  })
  doc.getElementById('branches-cancel')?.addEventListener('click', close)
  doc.getElementById('branches-close')?.addEventListener('click', close)
  doc.getElementById('branches-save')?.addEventListener('click', async () => {
    const cleaned = cleanBranches(draft)
    if ('error' in cleaned) {
      fail(`Not saved: ${cleaned.error}`)
      return
    }
    try {
      await api('lists-branches', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branches: cleaned.branches }),
      })
      close()
      doc.querySelector('main[data-page]')?.dispatchEvent(new Event('pr-greenlight:synced'))
    } catch (err) {
      fail(`Not saved: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  /** Re-draws the rows, keeping focus on the control named `focus` when given. */
  const render = (/** @type {string} */ focus = '') => {
    list.replaceChildren(
      ...draft.map((branch, i) => {
        const li = el(doc, 'li', 'branch-row')
        const pill = el(doc, 'span', `branch-pill pill-${branch.color}`, branch.name || 'branch')
        pill.setAttribute('aria-hidden', 'true')
        const name = /** @type {HTMLInputElement} */ (el(doc, 'input', 'text-input branch-name'))
        name.type = 'text'
        name.value = branch.name
        name.maxLength = 100
        name.placeholder = TEXTS.shell.settings.branchPlaceholder
        name.spellcheck = false
        name.dataset['focus'] = `name-${i}`
        name.setAttribute('aria-label', `Name of base branch ${i + 1}`)
        name.addEventListener('input', () => {
          draft[i] = { .../** @type {MainBranch} */ (draft[i]), name: name.value }
          pill.textContent = name.value.trim() || 'branch'
        })
        const swatches = swatchPicker(doc, {
          colors: BRANCH_COLORS,
          value: branch.color,
          label: `Color of ${branch.name || `branch ${i + 1}`}`,
          focusKey: String(i),
          pick: color => {
            draft[i] = {
              .../** @type {MainBranch} */ (draft[i]),
              color: /** @type {MainBranch['color']} */ (color),
            }
            render(`${color}-${i}`)
          },
        })
        const remove = makeButton(doc, 'icon-button small-icon-button', '')
        remove.append(iconNode(doc, 'trash', 14))
        remove.setAttribute('aria-label', `Remove ${branch.name || 'this branch'}`)
        remove.title = draft.length === 1 ? TEXTS.shell.settings.lastBranchTip : 'Remove'
        remove.disabled = draft.length === 1
        remove.addEventListener('click', () => {
          draft.splice(i, 1)
          render(`name-${Math.min(i, draft.length - 1)}`)
        })
        li.append(name, swatches, pill, remove)
        return li
      })
    )
    add.disabled = draft.length >= MAX_BRANCHES
    if (focus !== '') {
      const target = /** @type {HTMLElement | null} */ (list.querySelector(`[data-focus="${focus}"]`))
      target?.focus()
    }
  }

  add.addEventListener('click', () => {
    // A color no branch has yet, while there is one.
    const color = BRANCH_COLORS.find(c => !draft.some(b => b.color === c)) ?? BRANCH_COLORS[0]
    draft.push({ name: '', color })
    render(`name-${draft.length - 1}`)
  })
}
