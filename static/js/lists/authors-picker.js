// @ts-check
// The Authors picker, on the Review queue, the Inbox and Settings, and as Reviewers on Pull
// requests: saved searches at the top (one click applies one), then a searchable checkbox list of
// the people on the page with their counts, and "Save as" to name the current pick. Everyone starts
// ticked; several ticked shows anyone's ("Any of"), and none ticked shows nobody's. The saved
// searches belong to the repo, so every picker offers the same ones. People given a `group` are
// listed under its heading, in the order given, after those without one. Someone ticked who has no
// rows now still shows, to untick.
import { button, debounce, el, SEARCH_DEBOUNCE_MS, wireFilterPanel } from './dom.js'
import { loadSearches, saveSearches, tick, ticked } from './filters.js'
import { authorsLabel } from './queue.js'

/** @typedef {{ login: string, count: number, group?: string, text?: string }} Person */

/**
 * Wires the picker the page's markup holds (`authorsPicker` on the server). `picked` and `pick`
 * read and set the page's filter, `null` for everyone; `people` lists who to offer, with their
 * counts, on a page that splits them their group, and the words for a choice that is no login;
 * `prefix` starts its element ids when a page has a second picker.
 * @param {Document} doc
 * @param {{
 *   repo: { owner: string, name: string },
 *   picked: () => readonly string[] | null,
 *   pick: (authors: string[] | null) => void,
 *   people: () => readonly Person[],
 *   prefix?: string,
 * }} opts
 * @returns {{ render: () => void, searches: () => readonly import('./filters.js').AuthorSearch[] }}
 */
export function wireAuthorsPicker(doc, opts) {
  const prefix = opts.prefix ?? ''
  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(`${prefix}${id}`))
  const list = get('people-list')
  const search = /** @type {HTMLInputElement} */ (get('people-search'))
  const saveAs = /** @type {HTMLInputElement} */ (get('save-as'))
  let searches = loadSearches(opts.repo)
  let query = ''

  /** Everyone offered, and anyone ticked who is not. @returns {Person[]} */
  const everyone = () => {
    const people = opts.people()
    const missing = (opts.picked() ?? []).filter(login => !people.some(p => p.login === login))
    return [...people, ...missing.map(login => ({ login, count: 0 }))]
  }

  const render = () => {
    const picked = opts.picked()
    const all = everyone()
    const name = (/** @type {string} */ login) => all.find(p => p.login === login)?.text ?? login
    get('authors-label').textContent = authorsLabel(picked, searches, name)
    get('saved-options').replaceChildren(
      ...[{ name: 'Everyone', logins: /** @type {string[] | null} */ (null) }, ...searches].map(s => {
        const pick = button(doc, 'saved-search', '')
        const same =
          s.logins === null || picked === null
            ? s.logins === picked
            : s.logins.length === picked.length && s.logins.every(l => picked.includes(l))
        pick.setAttribute('aria-pressed', String(same))
        pick.append(el(doc, 'strong', undefined, s.name))
        if (s.logins !== null && s.logins.length > 0)
          pick.append(' ', el(doc, 'span', 'small muted', s.logins.map(name).join(', ')))
        pick.addEventListener('click', () => opts.pick(s.logins === null ? null : [...s.logins]))
        return pick
      })
    )
    const wanted = query.trim().toLowerCase()
    const people = all.filter(p => wanted === '' || name(p.login).toLowerCase().includes(wanted))
    const logins = all.map(p => p.login)
    /** @param {Person} p */
    const row = p => {
      const li = el(doc, 'li')
      const label = el(doc, 'label', 'check-row')
      const input = /** @type {HTMLInputElement} */ (el(doc, 'input'))
      input.type = 'checkbox'
      input.checked = ticked(picked, p.login)
      input.addEventListener('change', () => opts.pick(tick(picked, p.login, input.checked, logins)))
      label.append(input, ` ${name(p.login)}`, el(doc, 'span', 'muted small people-count', String(p.count)))
      li.append(label)
      return li
    }
    const groups = [...new Set(people.flatMap(p => (p.group === undefined ? [] : [p.group])))]
    list.replaceChildren(
      ...people.filter(p => p.group === undefined).map(row),
      ...groups.map((group, i) => {
        const li = el(doc, 'li', 'people-group')
        const title = el(doc, 'span', 'people-group-title small muted', group)
        title.id = `${prefix}people-group-${i}`
        const ul = el(doc, 'ul')
        ul.setAttribute('role', 'group')
        ul.setAttribute('aria-labelledby', title.id)
        ul.append(...people.filter(p => p.group === group).map(row))
        li.append(title, ul)
        return li
      })
    )
    get('people-count').textContent =
      picked === null ? 'Everyone' : picked.length === 0 ? 'Nobody' : `${picked.length} selected · Any of`
  }

  search.addEventListener(
    'input',
    debounce(() => {
      query = search.value
      render()
    }, SEARCH_DEBOUNCE_MS)
  )
  get('save-search').addEventListener('click', () => {
    const name = saveAs.value.trim()
    const picked = opts.picked()
    if (name === '' || picked === null || picked.length === 0) return
    searches = [...searches.filter(s => s.name !== name), { name, logins: [...picked] }]
    saveSearches(opts.repo, searches)
    saveAs.value = ''
    render()
  })
  get('people-all').addEventListener('click', () => opts.pick(null))
  get('people-none').addEventListener('click', () => opts.pick([]))
  wireFilterPanel(doc, get('authors-button'), get('authors-panel'))
  return { render, searches: () => searches }
}
