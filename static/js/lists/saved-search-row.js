// @ts-check
// A saved search's row in the Authors and Reviewers pickers and in a PR's Reviewers popup: its
// button, then Rename, Update (to the people picked now) and Delete, as Saved filters has them.
// The searches belong to the repo, so a change here shows in every picker; an update and a delete
// ask first.
import { askName, confirmRemove } from './confirm.js'
import { button, el, iconNode } from './dom.js'
import { loadSearches, saveSearches } from './filters.js'
import { TEXTS } from './texts.js'

/**
 * Wraps `pick`, a saved search's button, in its row with the search's actions. `picked` is who is
 * picked now, what Update keeps; `changed` hears once a change is saved.
 * @param {Document} doc
 * @param {HTMLButtonElement} pick
 * @param {{
 *   repo: { owner: string, name: string },
 *   search: import('./filters.js').AuthorSearch,
 *   picked: readonly string[] | null,
 *   changed: () => void,
 * }} opts
 * @returns {HTMLElement}
 */
export function savedSearchRow(doc, pick, opts) {
  const T = TEXTS.lists.savedSearches
  const { name, logins } = opts.search
  /** The repo's searches with this one changed by `f`, or gone when it gives null. */
  const save = (
    /** @type {(s: import('./filters.js').AuthorSearch) => import('./filters.js').AuthorSearch | null} */ f
  ) => {
    saveSearches(
      opts.repo,
      loadSearches(opts.repo).flatMap(s => {
        if (s.name !== name) return [s]
        const next = f(s)
        return next === null ? [] : [next]
      })
    )
    opts.changed()
  }
  const row = el(doc, 'div', 'preset-row people-row')

  const rename = button(doc, 'icon-button small-icon-button', '')
  rename.append(iconNode(doc, 'pencil', 14))
  rename.setAttribute('aria-label', `Rename saved search ${name}`)
  rename.title = 'Rename'
  rename.addEventListener('click', async event => {
    event.stopPropagation()
    const next = await askName(doc, {
      title: 'Rename saved search',
      label: 'Name',
      value: name,
      confirm: 'Rename',
      check: typed =>
        typed === ''
          ? 'Give it a name.'
          : loadSearches(opts.repo).some(s => s.name === typed && s.name !== name)
            ? T.nameTaken(typed)
            : null,
    })
    if (next === null || next === name) return
    save(s => ({ ...s, name: next }))
  })

  const picked = opts.picked ?? []
  const nothing = picked.length === 0
  const same = logins.length === picked.length && logins.every(l => picked.includes(l))
  const update = button(doc, 'icon-button small-icon-button', '')
  update.append(iconNode(doc, 'deviceFloppy', 14))
  update.setAttribute('aria-label', `Update saved search ${name} to the people picked`)
  update.disabled = nothing || same
  update.title = nothing ? T.pickFirst : same ? T.alreadyCurrent : T.updateToCurrent
  update.addEventListener('click', async event => {
    event.stopPropagation()
    const sure = await confirmRemove(doc, {
      title: 'Update saved search?',
      text: T.updateConfirm(name),
      confirm: 'Update',
      danger: false,
    })
    if (sure) save(s => ({ ...s, logins: [...picked] }))
  })

  const remove = button(doc, 'icon-button small-icon-button', '')
  remove.append(iconNode(doc, 'trash', 14))
  remove.setAttribute('aria-label', `Delete saved search ${name}`)
  remove.title = 'Delete'
  remove.addEventListener('click', async event => {
    event.stopPropagation()
    const sure = await confirmRemove(doc, {
      title: 'Delete saved search?',
      text: T.deleteConfirm(name),
      confirm: 'Delete',
    })
    if (sure) save(() => null)
  })

  row.append(pick, rename, update, remove)
  return row
}
