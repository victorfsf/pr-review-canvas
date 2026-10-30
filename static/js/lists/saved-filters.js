// @ts-check
// The Saved filters picker, on Your PRs, the Review queue and the Inbox: the page's filters saved
// under a name, to put back with one click, with a search over the names. Each page keeps its own,
// since their filters differ. The sort is not a filter, so a saved one leaves it as it is. One applies at a
// time: the one whose filters are exactly the page's shows pressed and names the button, changing
// any filter lets go of it, and pressing it again goes back to the defaults.
// Saved with the filter builder on, a saved filter keeps its blocks alone and says Builder, with
// how many conditions; saved with it off, it keeps the bar's filters and no blocks. Each one can
// be renamed, updated to the page's filters, or deleted; an update and a delete ask first.
import { askName, confirmRemove } from './confirm.js'
import { button, debounce, el, iconNode, SEARCH_DEBOUNCE_MS, wireFilterPanel } from './dom.js'
import { conditionCount, parseWhere } from './filter-builder.js'
import {
  acceptFilters,
  isDefault,
  loadPresets,
  PAGE_ONLY,
  savePresets,
  toSaved,
  upgradeSaved,
} from './filters.js'
import { TEXTS } from './texts.js'

/**
 * Wires the picker the page's markup holds (`SAVED_FILTERS` on the server). `current` and
 * `apply` read and set the page's filters; `apply` gets every filter but the sort, on a page that
 * has one. `upgrade` reads
 * one saved before a filter was renamed (see `upgradeSaved`).
 * @template {Record<string, unknown> & { sort?: string[] }} T
 * @param {Document} doc
 * @param {{
 *   repo: { owner: string, name: string },
 *   page: 'pulls' | 'queue' | 'inbox',
 *   defaults: T,
 *   accept: { [K in keyof T]: (value: unknown) => boolean },
 *   current: () => T,
 *   apply: (filters: Omit<T, 'sort'>) => void,
 *   upgrade?: (old: Record<string, unknown>) => Record<string, unknown>,
 * }} opts
 * @returns {{ render: () => void, saved: () => { name: string, filters: T }[] }}
 */
export function wireSavedFilters(doc, opts) {
  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(`presets-${id}`))
  const search = /** @type {HTMLInputElement} */ (get('search'))
  const name = /** @type {HTMLInputElement} */ (get('name'))
  const save = /** @type {HTMLButtonElement} */ (get('save'))
  let presets = loadPresets(opts.repo, opts.page)
  let query = ''

  /** The filters without the sort, what only the page keeps at its default (`PAGE_ONLY`). @param {Record<string, unknown>} f */
  const withoutSort = f => {
    const { sort: _, ...rest } = f
    for (const only of PAGE_ONLY)
      if (only in opts.defaults) /** @type {Record<string, unknown>} */ (rest)[only] = opts.defaults[only]
    return /** @type {Omit<T, 'sort'>} */ (rest)
  }
  /**
   * What of the filters counts, without the sort: with Builder on its blocks alone, the bar's at
   * their defaults; with it off the bar's, without blocks. The search box's words count either
   * way, since the box filters beside the builder too.
   * @param {Record<string, unknown>} f
   */
  const essence = f => {
    const rest = withoutSort(f)
    if (!('builder' in opts.defaults)) return rest
    return /** @type {Omit<T, 'sort'>} */ (
      f['builder'] === true
        ? {
            ...withoutSort(opts.defaults),
            builder: true,
            where: f['where'],
            ...('q' in opts.defaults ? { q: f['q'] } : {}),
          }
        : { ...rest, where: '' }
    )
  }
  /** A preset's filters as they apply: each checked, the ones it lacks or refuses at their defaults. */
  const filtersOf = (/** @type {import('./filters.js').Preset} */ p) =>
    essence(acceptFilters(upgradeSaved(p.filters, opts.defaults, opts.upgrade), opts.defaults, opts.accept))
  const sortless = { ...opts.defaults, sort: [] }
  const applied = () => {
    const now = { ...essence(opts.current()), sort: [] }
    return presets.find(p => isDefault(now, { ...filtersOf(p), sort: [] }))
  }
  /** Whether the page offers the builder: Settings → Experimental has it on. */
  const builderOn = doc.getElementById('builder-toggle') !== null

  const render = () => {
    const on = applied()
    // Whether the page's filters are all at their defaults: nothing to save.
    const nothing = isDefault({ ...essence(opts.current()), sort: [] }, sortless)
    get('label').textContent = on?.name ?? 'None'
    const wanted = query.trim().toLowerCase()
    const shown = presets.filter(p => wanted === '' || p.name.toLowerCase().includes(wanted))
    get('list').replaceChildren(
      ...(shown.length === 0
        ? [
            el(
              doc,
              'li',
              'small muted',
              presets.length === 0 ? TEXTS.lists.savedFilters.noneYet : TEXTS.lists.savedFilters.noneMatch
            ),
          ]
        : shown.map(p => {
            const li = el(doc, 'li', 'preset-row')
            const pick = button(doc, 'saved-search', '')
            pick.setAttribute('aria-pressed', String(p === on))
            pick.title = p === on ? TEXTS.lists.savedFilters.applied : TEXTS.lists.savedFilters.apply
            pick.append(el(doc, 'strong', undefined, p.name))
            const filters = filtersOf(p)
            /** @type {Record<string, unknown>} */
            const values = filters
            if (values['builder'] === true) {
              // Blocks from the builder, told apart from the bar's filters at a glance.
              const n = conditionCount(parseWhere(values['where']))
              const badge = el(doc, 'span', 'badge muted preset-builder')
              badge.append(iconNode(doc, 'filter', 12), ' Builder')
              pick.append(
                ' ',
                badge,
                ' ',
                el(doc, 'span', 'small muted', n === 1 ? '1 condition' : `${n} conditions`)
              )
              if (!builderOn) pick.title = TEXTS.lists.savedFilters.builderOff
            } else {
              const count = Object.keys(values).filter(
                k => k !== 'builder' && k !== 'where' && !isDefault({ [k]: values[k] }, { [k]: sortless[k] })
              ).length
              pick.append(' ', el(doc, 'span', 'small muted', count === 1 ? '1 filter' : `${count} filters`))
            }
            // A long name is cut short in the row, so the tooltip leads with it whole.
            pick.title = `${p.name} · ${pick.title}`
            pick.addEventListener('click', () => opts.apply(p === on ? withoutSort(sortless) : filters))
            const rename = button(doc, 'icon-button small-icon-button', '')
            rename.append(iconNode(doc, 'pencil', 14))
            rename.setAttribute('aria-label', `Rename saved filter ${p.name}`)
            rename.title = 'Rename'
            rename.addEventListener('click', async event => {
              event.stopPropagation()
              const next = await askName(doc, {
                title: 'Rename saved filter',
                label: 'Name',
                value: p.name,
                confirm: 'Rename',
                check: typed =>
                  typed === ''
                    ? 'Give it a name.'
                    : presets.some(other => other !== p && other.name === typed)
                      ? TEXTS.lists.savedFilters.nameTaken(typed)
                      : null,
              })
              if (next === null || next === p.name) return
              presets = presets.map(other => (other === p ? { ...p, name: next } : other))
              savePresets(opts.repo, opts.page, presets)
              render()
            })
            // Its filters become the page's, once confirmed: nothing to take while the page has none
            // or has its very filters.
            const update = button(doc, 'icon-button small-icon-button', '')
            update.append(iconNode(doc, 'deviceFloppy', 14))
            update.setAttribute('aria-label', `Update saved filter ${p.name} to the current filters`)
            update.disabled = nothing || p === on
            update.title = nothing
              ? TEXTS.lists.savedFilters.pickFirst
              : p === on
                ? TEXTS.lists.savedFilters.alreadyCurrent
                : TEXTS.lists.savedFilters.updateToCurrent
            update.addEventListener('click', async event => {
              event.stopPropagation()
              const sure = await confirmRemove(doc, {
                title: 'Update saved filter?',
                text: TEXTS.lists.savedFilters.updateConfirm(p.name),
                confirm: 'Update',
                danger: false,
              })
              if (!sure) return
              const preset = {
                name: p.name,
                filters: toSaved(structuredClone(essence(opts.current())), opts.defaults),
              }
              presets = presets.map(other => (other === p ? preset : other))
              savePresets(opts.repo, opts.page, presets)
              render()
            })
            const remove = button(doc, 'icon-button small-icon-button', '')
            remove.append(iconNode(doc, 'trash', 14))
            remove.setAttribute('aria-label', `Delete saved filter ${p.name}`)
            remove.title = 'Delete'
            remove.addEventListener('click', async event => {
              // The row goes away once confirmed; the panel stays open for the rest.
              event.stopPropagation()
              const sure = await confirmRemove(doc, {
                title: 'Delete saved filter?',
                text: TEXTS.lists.savedFilters.deleteConfirm(p.name),
                confirm: 'Delete',
              })
              if (!sure) return
              presets = presets.filter(other => other !== p)
              savePresets(opts.repo, opts.page, presets)
              render()
            })
            li.append(pick, rename, update, remove)
            return li
          }))
    )
    save.disabled = nothing
    save.title = nothing ? TEXTS.lists.savedFilters.pickToSave : TEXTS.lists.savedFilters.save
  }

  const saveCurrent = () => {
    const wanted = name.value.trim()
    const filters = essence(opts.current())
    if (wanted === '' || isDefault({ ...filters, sort: [] }, sortless)) return
    // A name already saved takes the new filters, in its place.
    const at = presets.findIndex(p => p.name === wanted)
    const preset = { name: wanted, filters: toSaved(structuredClone(filters), opts.defaults) }
    presets = at === -1 ? [...presets, preset] : presets.map((p, i) => (i === at ? preset : p))
    savePresets(opts.repo, opts.page, presets)
    name.value = ''
    render()
  }

  search.addEventListener(
    'input',
    debounce(() => {
      query = search.value
      render()
    }, SEARCH_DEBOUNCE_MS)
  )
  save.addEventListener('click', saveCurrent)
  name.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    saveCurrent()
  })
  wireFilterPanel(doc, get('button'), get('panel'))
  // Each saved filter as it applies, for the builder's chat to use by name.
  return {
    render,
    saved: () =>
      presets.map(p => ({ name: p.name, filters: /** @type {T} */ ({ ...opts.defaults, ...filtersOf(p) }) })),
  }
}
