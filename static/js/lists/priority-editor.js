// @ts-check
// Highest priority's editor: a modal dialog, opened by the table's "Prompt:" button or Settings' "Edit prompt", with
// the repo's saved prompts, each named. The one picked is the one Claude follows, open below to edit
// its name and text; a new one can be added and any but the default removed, asking first when it has words in it. The default keeps its
// name, and Reset default puts back its text and the count. How many PRs Claude may pick sits below. Nothing is saved until Save; the default prompt alone with the default count is saved as no
// setting at all, so a repo on them follows the defaults as they change.
import { api } from './api.js'
import { confirmRemove } from './confirm.js'
import { button, el, iconNode } from './dom.js'
import {
  DEFAULT_PRIORITY_COUNT,
  DEFAULT_PRIORITY_NAME,
  DEFAULT_PRIORITY_PROMPT,
  defaultPriority,
  MAX_PRIORITY_COUNT,
  MAX_PRIORITY_NAME,
  MAX_PRIORITY_PROMPT,
  MAX_PRIORITY_PROMPTS,
} from './priority.js'
import { TEXTS } from './texts.js'

/** @typedef {import('./priority.js').NamedPrompt} NamedPrompt */
/** @typedef {import('./priority.js').PrioritySetup} PrioritySetup */

/**
 * What Save sends: the prompts and names trimmed, the name of the one in use and the count, `null`
 * for the defaults, or why they cannot go.
 * @param {readonly NamedPrompt[]} prompts
 * @param {number} active the place of the one in use
 * @param {string} count as typed
 * @returns {{ priority: { prompts: NamedPrompt[], active: string, count: number } | null }
 *   | { error: string }}
 */
export function cleanPriority(prompts, active, count) {
  const cleaned = prompts.map(p => ({ name: p.name.trim(), prompt: p.prompt.trim() }))
  const n = Number(count)
  /** @type {Set<string>} */
  const seen = new Set()
  for (const [at, p] of cleaned.entries()) {
    if (p.name === '') return { error: TEXTS.lists.priorityEditor.needsName(at + 1) }
    if (p.name.length > MAX_PRIORITY_NAME) {
      return { error: TEXTS.lists.priorityEditor.nameTooLong(MAX_PRIORITY_NAME) }
    }
    if (seen.has(p.name.toLowerCase())) return { error: TEXTS.lists.priorityEditor.sameName(p.name) }
    seen.add(p.name.toLowerCase())
    if (p.prompt === '') return { error: TEXTS.lists.priorityEditor.needsPrompt(p.name) }
    if (p.prompt.length > MAX_PRIORITY_PROMPT) {
      return { error: TEXTS.lists.priorityEditor.promptTooLong(p.name, MAX_PRIORITY_PROMPT) }
    }
  }
  if (cleaned.length === 0) return { error: TEXTS.lists.priorityEditor.keepOne }
  if (cleaned.length > MAX_PRIORITY_PROMPTS)
    return { error: TEXTS.lists.priorityEditor.tooMany(MAX_PRIORITY_PROMPTS) }
  if (!Number.isInteger(n) || n < 1 || n > MAX_PRIORITY_COUNT) {
    return { error: TEXTS.lists.priorityEditor.countRange(MAX_PRIORITY_COUNT) }
  }
  const only = cleaned[0]
  if (
    cleaned.length === 1 &&
    only?.name === DEFAULT_PRIORITY_NAME &&
    only.prompt === DEFAULT_PRIORITY_PROMPT &&
    n === DEFAULT_PRIORITY_COUNT
  ) {
    return { priority: null }
  }
  const inUse = cleaned[active] ?? cleaned[0]
  return { priority: { prompts: cleaned, active: /** @type {NamedPrompt} */ (inUse).name, count: n } }
}

/**
 * A name no prompt has yet: "New prompt", then "New prompt 2" and on.
 * @param {readonly NamedPrompt[]} prompts
 */
export function freshName(prompts) {
  const taken = new Set(prompts.map(p => p.name.trim().toLowerCase()))
  for (let i = 1; ; i++) {
    const name = i === 1 ? 'New prompt' : `New prompt ${i}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

/**
 * @template {{ prompts: NamedPrompt[], active: string, count: number }} T
 * @param {Document} doc
 * @param {{ repo: { owner: string, name: string }, current: () => T | null, saved: (next: T) => void,
 *   opener?: string }} opts `opener` is the id of the button that opens it; the table's by default
 */
export function wirePriorityEditor(doc, opts) {
  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id))
  const dialog = /** @type {HTMLDialogElement} */ (get('priority-dialog'))
  const list = get('priority-list')
  const add = /** @type {HTMLButtonElement} */ (get('priority-add'))
  const name = /** @type {HTMLInputElement} */ (get('priority-name'))
  const prompt = /** @type {HTMLTextAreaElement} */ (get('priority-prompt'))
  const count = /** @type {HTMLInputElement} */ (get('priority-count'))
  const error = get('priority-error')
  /** The prompts as edited, the default among them, and the place of the one picked: in use and open. */
  /** @type {NamedPrompt[]} */
  let draft = []
  /** @type {NamedPrompt} */
  let fixed = { name: DEFAULT_PRIORITY_NAME, prompt: DEFAULT_PRIORITY_PROMPT }
  let active = 0
  const fail = (/** @type {string | null} */ message) => {
    error.hidden = message === null
    error.textContent = message ?? ''
  }
  const label = (/** @type {NamedPrompt} */ p) => p.name.trim() || 'Unnamed'

  const render = () => {
    list.replaceChildren(
      ...draft.map((p, i) => {
        const item = el(doc, 'li', i === active ? 'priority-item picked' : 'priority-item')
        const pick = button(doc, 'link-button priority-item-name', label(p))
        pick.setAttribute('aria-pressed', String(i === active))
        pick.title = TEXTS.lists.priorityEditor.usePrompt
        pick.addEventListener('click', () => {
          active = i
          fill()
        })
        const inUse = el(doc, 'span', 'small muted priority-in-use', i === active ? 'in use' : '')
        item.append(pick, inUse, el(doc, 'span', 'spacer'))
        // The default stays: it can be edited and reset, never removed.
        if (p !== fixed) {
          const remove = button(doc, 'icon-button small-icon-button priority-remove', '')
          remove.append(iconNode(doc, 'x', 14))
          remove.setAttribute('aria-label', `Remove ${label(p)}`)
          remove.title = TEXTS.lists.priorityEditor.removePrompt
          remove.addEventListener('click', async () => {
            // A prompt with words in it asks first, as a saved filter does; an empty one just goes.
            if (p.prompt.trim() !== '') {
              const sure = await confirmRemove(doc, {
                title: 'Remove prompt?',
                text: TEXTS.lists.priorityEditor.removeConfirm(label(p)),
                confirm: 'Remove',
              })
              if (!sure) return
            }
            const at = draft.indexOf(p)
            if (at === -1) return
            draft.splice(at, 1)
            if (active > at || active === draft.length) active = Math.max(0, active - 1)
            fill()
          })
          item.append(remove)
        }
        return item
      })
    )
    add.disabled = draft.length >= MAX_PRIORITY_PROMPTS
  }
  /** Shows the picked prompt in the fields below the list, and scrolls the list to it. */
  const fill = () => {
    const p = draft[active]
    name.value = p?.name ?? ''
    // The default's name is its own.
    name.disabled = p === fixed
    name.title = p === fixed ? TEXTS.lists.priorityEditor.defaultKeepsName : ''
    prompt.value = p?.prompt ?? ''
    render()
    reveal()
  }
  /** Scrolls the list to the picked prompt, if it is out of view. */
  const reveal = () => {
    const picked = list.children[active]
    if (picked !== undefined && typeof picked.scrollIntoView === 'function')
      picked.scrollIntoView({ block: 'nearest' })
  }
  const load = (/** @type {{ prompts: NamedPrompt[], active: string, count: number }} */ p) => {
    draft = p.prompts.map(x => ({ ...x }))
    const found = draft.find(x => x.name === DEFAULT_PRIORITY_NAME)
    fixed = found ?? { name: DEFAULT_PRIORITY_NAME, prompt: DEFAULT_PRIORITY_PROMPT }
    if (found === undefined) draft.unshift(fixed)
    active = Math.max(
      0,
      draft.findIndex(x => x.name === p.active)
    )
    count.value = String(p.count)
    fill()
  }
  const close = () => {
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  }

  name.addEventListener('input', () => {
    const p = draft[active]
    if (p === undefined || p === fixed) return
    p.name = name.value
    render()
  })
  prompt.addEventListener('input', () => {
    const p = draft[active]
    if (p !== undefined) p.prompt = prompt.value
  })
  add.addEventListener('click', () => {
    if (draft.length >= MAX_PRIORITY_PROMPTS) return
    draft.push({ name: freshName(draft), prompt: '' })
    active = draft.length - 1
    fill()
    name.focus()
    name.select()
  })
  get(opts.opener ?? 'queue-priority-edit').addEventListener('click', () => {
    fail(null)
    load(opts.current() ?? defaultPriority())
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    reveal()
    prompt.focus()
  })
  // Reset default: the default prompt's text and the count go back; the other prompts stay, and the
  // default is picked so what changed shows.
  get('priority-reset').addEventListener('click', () => {
    fixed.prompt = DEFAULT_PRIORITY_PROMPT
    count.value = String(DEFAULT_PRIORITY_COUNT)
    active = draft.indexOf(fixed)
    fill()
  })
  get('priority-cancel').addEventListener('click', close)
  get('priority-close').addEventListener('click', close)
  get('priority-save').addEventListener('click', async () => {
    const result = cleanPriority(draft, active, count.value)
    if ('error' in result) {
      fail(result.error)
      return
    }
    try {
      const next = await api(`lists-priority`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(result),
      })
      fail(null)
      close()
      opts.saved(next)
    } catch (err) {
      fail(TEXTS.lists.editors.notSaved(/** @type {Error} */ (err).message))
    }
  })
}
