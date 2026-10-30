// @ts-check
// The filter builder (experimental, off until Settings → Experimental turns it on), on Your PRs,
// the Review queue and the Inbox. The Builder button opens it in a modal, where the blocks are a
// draft: the page changes only on Done, which turns Builder on. Then the filter bar's filters hide
// and the page shows what the blocks keep, the button saying how many conditions; Close or Escape
// drops the draft, and "Use the filter bar instead" turns Builder off.
// Each block joins its conditions, and the blocks inside it, by AND or by OR as you pick, and each
// condition says a field is any of, none of, or (for a field a row can have several of, such as
// labels) all of the values ticked. A condition with nothing ticked, and a block with no condition
// that counts, are left out; with nothing left, every row shows.
// A condition is one line that reads as a sentence: "Where Label has any of bug, ui", the next
// "AND Author is bob", the AND / OR switching the block's join. Its values open in a list under
// the line, for every field. The field and how it
// holds are each a button opening a menu under it, as the Stack filter's. + Condition adds a line
// whose field is still to pick, its button focused.
// The blocks are one filter of the page, `where`, kept as JSON text beside `builder`, so they are
// saved, carried in the address and kept in saved filters like any other. Turning Builder on with
// no blocks yet starts from what the filter bar shows, written out as blocks.
// Rows, field names and values only ever become text.
import { button, el, iconNode } from './dom.js'
import { SEARCH_DELAY_MS } from './search.js'
import { STATES, stateOf } from './states.js'
import { TEXTS } from './texts.js'

/** @typedef {'and' | 'or'} Join */
/** @typedef {'any' | 'none' | 'all'} Is */
/** @typedef {{ field: string, is: Is, values: string[] }} Condition */
/** @typedef {{ op: Join, items: Node[] }} Block */
/** @typedef {Condition | Block} Node */

/**
 * A choice of a field: its value, its words, and the heading it is listed under, if any.
 * @typedef {readonly [string, string] | readonly [string, string, string]} Choice
 */

/**
 * A field the builder can filter on: its choices for the rows there are, as `Choice`s, and
 * the values one row has. `multi` when a row can have several, which offers "has all of". A
 * field with `text`, such as Search, takes words you type in place of choices: its condition holds
 * one value, and `text` says whether a row matches it.
 * @template T
 * @typedef {{ key: string, label: string, multi?: boolean,
 *   options: (rows: readonly T[]) => readonly Choice[],
 *   values: (row: T) => readonly string[],
 *   text?: (row: T, words: string) => boolean }} Field
 */

/** The longest words a typed condition keeps, as the search box does. */
export const MAX_TEXT = 300

/** How deep blocks nest: the outer one and two inside it. */
export const MAX_DEPTH = 3

/**
 * The words of a way a condition holds, as they read with the values ticked: "is" for one,
 * "is any of" for several; "has" for a field a row can have several of, such as labels.
 * @param {Is} is
 * @param {boolean} multi
 * @param {number} ticked
 */
export function isWords(is, multi, ticked) {
  const several = ticked > 1
  if (is === 'all') return 'has all of'
  if (multi) {
    if (is === 'none') return several ? 'has none of' : 'does not have'
    return several ? 'has any of' : 'has'
  }
  if (is === 'none') return several ? 'is none of' : 'is not'
  return several ? 'is any of' : 'is'
}

/** @returns {Block} */
export const emptyBlock = (/** @type {Join} */ op = 'and') => ({ op, items: [] })

/** @param {Node} node @returns {node is Block} */
export const isBlock = node => 'items' in node

/** @param {unknown} v @returns {v is Node} */
function isNode(v, depth = 1) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const r = /** @type {Record<string, unknown>} */ (v)
  if ('items' in r)
    return (
      depth <= MAX_DEPTH &&
      (r['op'] === 'and' || r['op'] === 'or') &&
      Array.isArray(r['items']) &&
      r['items'].every(i => isNode(i, depth + 1))
    )
  return (
    typeof r['field'] === 'string' &&
    (r['is'] === 'any' || r['is'] === 'none' || r['is'] === 'all') &&
    Array.isArray(r['values']) &&
    r['values'].every(x => typeof x === 'string')
  )
}

/**
 * The blocks a `where` holds; an empty block for none, or for text that is not blocks.
 * @param {unknown} text
 * @returns {Block}
 */
export function parseWhere(text) {
  if (typeof text !== 'string' || text === '') return emptyBlock()
  try {
    const parsed = JSON.parse(text)
    return isNode(parsed) && isBlock(parsed) ? parsed : emptyBlock()
  } catch {
    return emptyBlock()
  }
}

/** The `where` text for the blocks: '' when nothing in them counts. @param {Block} block */
export const whereText = block => (counts(block) ? JSON.stringify(block) : '')

/** Whether a saved `where` is blocks, or none. @param {unknown} v */
export function acceptWhere(v) {
  if (typeof v !== 'string') return false
  if (v === '') return true
  try {
    const parsed = JSON.parse(v)
    return isNode(parsed) && isBlock(parsed)
  } catch {
    return false
  }
}

/**
 * What a page's builder offers, as Claude is told it and its answer is checked against: each
 * field's key, words, whether a row can have several values, and its values with their words;
 * `text` for a field that takes typed words, with no values.
 * @typedef {{ key: string, label: string, multi: boolean, options: [string, string][], text?: boolean | undefined }} FieldSpec
 */

/**
 * Blocks from elsewhere (Claude's answer) made to fit a page: only its fields and their values,
 * "has all of" only where a row can have several, conditions left with no value and blocks left
 * empty dropped, no deeper than `MAX_DEPTH`. Null when it is not blocks at all.
 * @param {unknown} raw
 * @param {readonly FieldSpec[]} fields
 * @returns {Block | null}
 */
export function fitBlock(raw, fields, depth = 1) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || depth > MAX_DEPTH) return null
  const r = /** @type {Record<string, unknown>} */ (raw)
  if (!(r['op'] === 'and' || r['op'] === 'or') || !Array.isArray(r['items'])) return null
  /** @type {Node[]} */
  const items = []
  for (const item of r['items']) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    if ('items' in item) {
      const inner = fitBlock(item, fields, depth + 1)
      if (inner !== null && inner.items.length > 0) items.push(inner)
      continue
    }
    const c = /** @type {Record<string, unknown>} */ (item)
    const field = fields.find(f => f.key === c['field'])
    if (field === undefined || !Array.isArray(c['values'])) continue
    if (field.text === true) {
      // Typed words: the first value, as the box keeps it.
      const [first] = c['values']
      const words = typeof first === 'string' ? first.trim().slice(0, MAX_TEXT) : ''
      if (words !== '')
        items.push({ field: field.key, is: c['is'] === 'none' ? 'none' : 'any', values: [words] })
      continue
    }
    const is = c['is'] === 'none' || (c['is'] === 'all' && field.multi) ? c['is'] : 'any'
    const known = new Set(field.options.map(([value]) => value))
    const values = [...new Set(c['values'].filter(v => typeof v === 'string' && known.has(v)))]
    if (values.length > 0) items.push({ field: field.key, is, values })
  }
  return { op: r['op'], items }
}

/** How many conditions with something ticked a node holds. @param {Node} node @returns {number} */
export function conditionCount(node) {
  return isBlock(node)
    ? node.items.reduce((n, i) => n + conditionCount(i), 0)
    : node.values.length > 0
      ? 1
      : 0
}

/** Whether a node holds any condition with something ticked. @param {Node} node @returns {boolean} */
export function counts(node) {
  return isBlock(node) ? node.items.some(counts) : node.values.length > 0
}

/**
 * Whether a node keeps a row: null when it is left out (nothing ticked, an unknown field, a block
 * with nothing that counts).
 * @template T
 * @param {Node} node
 * @param {T} row
 * @param {ReadonlyMap<string, Field<T>>} fields
 * @returns {boolean | null}
 */
function holds(node, row, fields) {
  if (isBlock(node)) {
    const results = node.items.map(n => holds(n, row, fields)).filter(r => r !== null)
    if (results.length === 0) return null
    return node.op === 'and' ? results.every(Boolean) : results.some(Boolean)
  }
  const field = fields.get(node.field)
  if (field === undefined || node.values.length === 0) return null
  if (field.text !== undefined) {
    const words = node.values[0]?.trim() ?? ''
    if (words === '') return null
    const hit = field.text(row, words)
    return node.is === 'none' ? !hit : hit
  }
  const has = field.values(row)
  if (node.is === 'all') return node.values.every(v => has.includes(v))
  const any = has.some(v => node.values.includes(v))
  return node.is === 'none' ? !any : any
}

/**
 * The rows the blocks keep, in their order.
 * @template T
 * @param {readonly T[]} rows
 * @param {Block} block
 * @param {readonly Field<T>[]} fields
 */
export function filterWhere(rows, block, fields) {
  const byKey = new Map(fields.map(f => [f.key, f]))
  return rows.filter(r => holds(block, r, byKey) !== false)
}

/**
 * A condition for each filter of the bar that keeps less than everything, ANDed, as the bar joins
 * them; a `Block` given among them goes in as it is, when anything in it counts. A filter with
 * none ticked keeps nothing on the bar, but its condition has nothing ticked, so it is left out
 * until a value is.
 * @param {readonly ([string, readonly string[] | null] | Block)[]} parts
 * @returns {Block}
 */
export function seedBlock(parts) {
  /** @type {Node[]} */
  const items = []
  for (const part of parts) {
    if (!Array.isArray(part)) {
      if (counts(part)) items.push(part)
      continue
    }
    const [field, values] = part
    if (values !== null) items.push({ field, is: 'any', values: [...values] })
  }
  return { op: 'and', items }
}

/** A field with fixed choices, each row having one. @template T @param {string} key @param {string} label @param {readonly (readonly [string, string])[]} choices @param {(row: T) => string} value @returns {Field<T>} */
export const oneOf = (key, label, choices, value) => ({
  key,
  label,
  options: () => choices,
  values: row => [value(row)],
})

/** A field for a yes-or-no about a row. @template T @param {string} key @param {string} label @param {string} yes @param {string} no @param {(row: T) => boolean} test @returns {Field<T>} */
export const yesNo = (key, label, yes, no, test) =>
  oneOf(
    key,
    label,
    [
      ['yes', yes],
      ['no', no],
    ],
    row => (test(row) ? 'yes' : 'no')
  )

/**
 * The state of a PR or an event's PR, as Open / Draft / Queued (in GitHub's merge queue).
 * @template {{ isDraft: boolean, queuedAt?: string | null, queued?: boolean }} T @returns {Field<T>}
 */
export const stateField = () =>
  oneOf(
    'state',
    'State',
    [
      ['open', 'Open'],
      ['draft', 'Draft'],
      ['queued', 'Queued'],
    ],
    row => stateOf(row)
  )

/**
 * The state filter of the bar as the State field's values: none at All.
 * @param {import('./pulls.js').StateFilter} state
 */
export const stateValues = state => (state.length === STATES.length ? null : [...state])

/** The most messages Ask AI sends, the latest kept; the server takes no more. */
export const MAX_TALK = 20

/** The most saved filters, and saved groups of people, Ask AI sends; the server takes no more. */
export const MAX_NAMED = 50

/** How many choices a condition's list has before it offers a search. */
export const SEARCHABLE_CHOICES = 8

/**
 * Draws the builder in its modal and wires the Builder button. `on` says whether the page filters
 * by the blocks; `render` draws them again, with the counts of the rows there are, and the modal's
 * foot says how many rows the blocks keep.
 * @template T
 * @template {{ builder: boolean, where: string }} F
 * @param {Document} doc
 * @param {{ fields: () => readonly Field<T>[], rows: () => readonly T[],
 *   filters: () => F, change: (next: { builder?: boolean, where?: string }) => void,
 *   seed: (filters: F) => Block, page?: 'pulls' | 'queue' | 'inbox',
 *   saved?: () => readonly { name: string, filters: F }[],
 *   groups?: () => readonly { name: string, logins: readonly string[] }[],
 *   ask?: (body: { page: string, messages: { from: 'you' | 'claude', text: string }[],
 *     fields: { key: string, label: string, multi: boolean, options: string[][], text?: boolean }[], current: Block,
 *     saved: { name: string, blocks: Block }[], groups: { name: string, logins: string[] }[] }) =>
 *     Promise<{ reply: string, blocks: Block | null }> }} opts `seed` writes a page's bar filters
 *   out as blocks; `ask` sends Ask AI's message, with the page's saved filters (`saved`) and the
 *   repo's saved groups of people (`groups`), for Claude to use by name
 */
export function wireFilterBuilder(doc, opts) {
  const toggle = doc.getElementById('builder-toggle')
  const card = doc.getElementById('filter-builder')
  const root = doc.getElementById('filter-builder-root')
  const bar = doc.getElementById('bar-filters')
  // With the experiment off the page has none of them, and the bar filters as before.
  const offered = toggle !== null && card !== null && root !== null
  /** What each condition's search holds, by its place in the blocks. @type {Map<string, string>} */
  const searches = new Map()
  /** The menu open, as its button's place and part: `0.1:field` or `0.1:is`. */
  let openPart = /** @type {string | null} */ (null)
  /** The conditions whose list of values is open, by place: as many as you like, each staying
   * open until its button closes it, so the lines do not move under you. */
  const openValues = /** @type {Set<string>} */ (new Set())
  /** The control a redraw puts the focus on, in place of the one that had it. */
  let focusNext = /** @type {string | null} */ (null)

  const on = () => offered && opts.filters().builder
  /** The blocks the page filters by. */
  const block = () => parseWhere(opts.filters().where)
  /** The blocks the modal edits: nothing reaches the page until Done. Null while it is closed. */
  let draft = /** @type {Block | null} */ (null)
  const editing = () => draft ?? block()
  /** Changes the draft; new blocks altogether (Ask AI's) forget the open lists and searches. */
  const set = (/** @type {Block} */ next, fresh = false) => {
    if (fresh) {
      searches.clear()
      openValues.clear()
    }
    draft = next
    drawModal()
  }
  /**
   * Takes a node out of the draft. The open lists and searches inside it go, and those of the
   * places after it move up one with their lines.
   * @param {number[]} path
   */
  const removeAt = path => {
    const depth = path.length - 1
    /** @param {string} key @returns {string | null} */
    const moved = key => {
      const at = key.split('.').map(Number)
      if (path.every((n, i) => at[i] === n)) return null
      const after =
        at.length > depth &&
        path.every((n, i) => i === depth || at[i] === n) &&
        (at[depth] ?? 0) > (path[depth] ?? 0)
      if (after) at[depth] = (at[depth] ?? 0) - 1
      return at.join('.')
    }
    const lists = [...openValues].flatMap(k => moved(k) ?? [])
    openValues.clear()
    for (const k of lists) openValues.add(k)
    const searched = [...searches].flatMap(([k, v]) => {
      const next = moved(k)
      return next === null ? [] : [/** @type {const} */ ([next, v])]
    })
    searches.clear()
    for (const [k, v] of searched) searches.set(k, v)
    openPart = null
    set(update(editing(), path, () => null))
  }

  const dialog = /** @type {HTMLDialogElement | null} */ (card)
  const close = () => {
    draft = null
    if (dialog === null) return
    if (typeof dialog.close === 'function') dialog.close()
    // A browser without dialogs, or one opened without showModal, keeps the attribute.
    dialog.removeAttribute('open')
  }
  toggle?.addEventListener('click', () => {
    const f = opts.filters()
    // With Builder off, the draft starts from what the bar shows, unless blocks were kept from before.
    draft = f.builder || f.where !== '' ? block() : opts.seed(f)
    searches.clear()
    openValues.clear()
    openPart = null
    drawModal()
    if (dialog === null) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  })
  // Escape and Close drop the draft; Done applies it, turning Builder on.
  dialog?.addEventListener('close', () => {
    draft = null
  })
  // Escape closes an open menu, or the list of values it is in, first, and only then the modal.
  // The arrows move through a menu's choices.
  let keepOpen = false
  root?.addEventListener('keydown', event => {
    const target = /** @type {HTMLElement} */ (event.target)
    const menu = target.closest('.builder-menu')
    if (menu !== null && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const items = /** @type {HTMLElement[]} */ ([...menu.querySelectorAll('.menu-item')])
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(items.indexOf(target) + step + items.length) % items.length]?.focus()
      return
    }
    if (event.key !== 'Escape') return
    const list = target.closest('.builder-values-panel')?.closest('.builder-cond')
    const id = list instanceof HTMLElement ? list.dataset['path'] : undefined
    if (openPart === null && id === undefined) return
    event.preventDefault()
    event.stopPropagation()
    keepOpen = true
    if (openPart !== null) {
      focusNext = openPart
      openPart = null
    } else if (id !== undefined) {
      focusNext = `${id}:values`
      openValues.delete(id)
    }
    drawModal()
  })
  dialog?.addEventListener('cancel', event => {
    if (keepOpen) event.preventDefault()
    keepOpen = false
  })
  root?.addEventListener('keyup', () => {
    keepOpen = false
  })
  // A click anywhere else in the modal closes what is open, unless the click opened it (a field
  // picked opens its values). The path is the one the click started on: a control that redraws the
  // blocks has already left the page by now.
  let openAtClick = /** @type {string | null} */ (null)
  dialog?.addEventListener('click', () => (openAtClick = openPart), true)
  dialog?.addEventListener('click', event => {
    if (openPart === null || openPart !== openAtClick) return
    const open = openPart
    const owns = (/** @type {EventTarget} */ n) => n instanceof HTMLElement && n.dataset['owner'] === open
    if (event.composedPath().some(owns)) return
    openPart = null
    drawModal()
  })
  doc.getElementById('builder-done')?.addEventListener('click', () => {
    const next = editing()
    close()
    // A condition with nothing ticked yet stays, so it can be filled in later.
    opts.change({ builder: true, where: next.items.length === 0 ? '' : JSON.stringify(next) })
  })
  doc.getElementById('builder-close')?.addEventListener('click', close)
  doc.getElementById('builder-off')?.addEventListener('click', () => {
    close()
    opts.change({ builder: false })
  })

  // Ask AI: you describe what to show and Claude writes the draft's blocks, or asks back. The
  // talk starts over each time the modal opens.
  const chat = doc.getElementById('builder-chat')
  const chatToggle = doc.getElementById('builder-chat-toggle')
  const talk = doc.getElementById('builder-talk')
  const input = /** @type {HTMLTextAreaElement | null} */ (doc.getElementById('builder-ask-input'))
  const askButton = /** @type {HTMLButtonElement | null} */ (doc.getElementById('builder-ask'))
  const askError = doc.getElementById('builder-ask-error')
  /** @type {{ from: 'you' | 'claude', text: string }[]} */
  let messages = []
  let asking = false
  const drawTalk = () => {
    if (talk === null) return
    talk.hidden = messages.length === 0 && !asking
    talk.replaceChildren(
      ...messages.map(m => {
        const li = el(doc, 'li', `builder-msg from-${m.from}`)
        li.append(
          el(doc, 'span', 'builder-msg-who', m.from === 'you' ? 'You' : 'AI'),
          el(doc, 'span', undefined, m.text)
        )
        return li
      }),
      ...(asking ? [el(doc, 'li', 'builder-msg from-claude muted', TEXTS.lists.filterBuilder.filling)] : [])
    )
    talk.scrollTop = talk.scrollHeight
    if (askButton !== null) askButton.disabled = asking
  }
  const failAsk = (/** @type {string | null} */ message) => {
    if (askError === null) return
    askError.hidden = message === null
    askError.textContent = message ?? ''
  }
  toggle?.addEventListener('click', () => {
    messages = []
    failAsk(null)
    drawTalk()
  })
  chatToggle?.addEventListener('click', () => {
    if (chat === null) return
    chat.hidden = !chat.hidden
    chatToggle.setAttribute('aria-pressed', String(!chat.hidden))
    if (!chat.hidden) input?.focus()
  })
  const ask = async () => {
    const text = input?.value.trim() ?? ''
    if (text === '' || asking || opts.ask === undefined || input === null) return
    const rows = opts.rows()
    // What the builder offers, as Claude may use it; a field's values are capped as the server takes them.
    const fields = opts.fields().map(f => ({
      key: f.key,
      label: f.label,
      multi: f.multi === true,
      options: f
        .options(rows)
        .slice(0, 300)
        .map(([value, words]) => [value, words]),
      ...(f.text === undefined ? {} : { text: true }),
    }))
    // Saved filters as their blocks, those saved from the bar written out as Builder starts from them.
    // A saved search goes in as a Search condition beside them, where the page has that field.
    const searchable = fields.some(f => f.key === 'search' && f.text === true)
    const saved = (opts.saved?.() ?? []).slice(0, MAX_NAMED).map(s => {
      const blocks = s.filters.builder ? parseWhere(s.filters.where) : opts.seed(s.filters)
      const words = /** @type {Record<string, unknown>} */ (s.filters)['q']
      return {
        name: s.name,
        blocks:
          searchable && typeof words === 'string' && words.trim() !== ''
            ? {
                op: /** @type {const} */ ('and'),
                items: [
                  ...(blocks.op === 'and' ? blocks.items : [blocks]),
                  { field: 'search', is: /** @type {const} */ ('any'), values: [words] },
                ],
              }
            : blocks,
      }
    })
    const groups = (opts.groups?.() ?? [])
      .slice(0, MAX_NAMED)
      .map(g => ({ name: g.name, logins: [...g.logins] }))
    messages = [...messages, { from: /** @type {const} */ ('you'), text }].slice(-MAX_TALK)
    input.value = ''
    asking = true
    failAsk(null)
    drawTalk()
    try {
      const answer = await opts.ask({
        page: opts.page ?? '',
        messages,
        fields,
        current: editing(),
        saved,
        groups,
      })
      messages = [...messages, { from: /** @type {const} */ ('claude'), text: answer.reply }].slice(-MAX_TALK)
      // A reply without blocks is a question back; the draft stays.
      if (answer.blocks !== null && draft !== null) {
        openPart = null
        set(answer.blocks, true)
      }
    } catch (err) {
      // The words go back in the box, to send again.
      messages = messages.slice(0, -1)
      input.value = text
      failAsk(err instanceof Error ? err.message : String(err))
    }
    asking = false
    drawTalk()
  }
  askButton?.addEventListener('click', () => void ask())
  input?.addEventListener('keydown', event => {
    // Enter sends; Shift+Enter starts a new line.
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    void ask()
  })

  /**
   * The node at a place, and a copy of the blocks with it changed by `edit`.
   * @param {Block} top
   * @param {readonly number[]} path
   * @param {(node: Node) => Node | null} edit null takes the node out
   * @returns {Block}
   */
  const update = (top, path, edit) => {
    if (path.length === 0) return /** @type {Block} */ (edit(top) ?? emptyBlock())
    const [at, ...rest] = path
    const items = top.items.flatMap((item, i) => {
      if (i !== at) return [item]
      const next = rest.length === 0 ? edit(item) : isBlock(item) ? update(item, rest, edit) : item
      return next === null ? [] : [next]
    })
    return { ...top, items }
  }

  /**
   * A new condition on a field, or with its field still to pick: nothing ticked, so it is left
   * out until a value is.
   * @param {Field<T> | undefined} field
   * @returns {Condition}
   */
  const newCondition = field => ({ field: field?.key ?? '', is: 'any', values: [] })

  /** Changes the condition at a place. @param {number[]} path @param {(c: Condition) => Condition} edit */
  const editCondition = (path, edit) =>
    set(update(editing(), path, node => edit(/** @type {Condition} */ (node))))

  /**
   * A button showing what is picked, which opens a menu of the choices under it, the one picked
   * checked: a condition's field, and how it holds. Picking the one already picked only closes it.
   * @param {string} key the button's place and part, such as `0.1:field`
   * @param {string} className
   * @param {string} name what it picks, for its name and its menu's
   * @param {string} text what is picked, in words; '' for nothing yet
   * @param {string} placeholder its words while nothing is picked
   * @param {readonly (readonly [string, string])[]} choices
   * @param {string} current
   * @param {(value: string) => void} pick
   */
  const menuButton = (key, className, name, text, placeholder, choices, current, pick) => {
    const open = openPart === key
    const anchor = el(doc, 'span', 'builder-pick')
    const opener = button(doc, `builder-select ${className}`, '')
    opener.dataset['focus'] = key
    opener.dataset['owner'] = key
    opener.dataset['value'] = current
    opener.setAttribute('aria-haspopup', 'menu')
    opener.setAttribute('aria-expanded', String(open))
    opener.setAttribute('aria-label', `${name}: ${text === '' ? placeholder : text}`)
    opener.append(
      el(doc, 'span', `builder-values-text${text === '' ? ' muted' : ''}`, text === '' ? placeholder : text),
      el(doc, 'span', 'builder-chevron', '▾')
    )
    opener.addEventListener('click', () => {
      openPart = open ? null : key
      if (!open) focusNext = `${key}:menu`
      drawModal()
    })
    anchor.append(opener)
    if (!open) return anchor
    const menu = el(doc, 'div', 'menu builder-menu')
    // In the top layer, so the blocks' scrolling and the modal's edges do not cut it off.
    menu.setAttribute('popover', 'manual')
    menu.dataset['owner'] = key
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', name)
    for (const [value, words] of choices) {
      const item = button(doc, 'menu-item', '')
      item.setAttribute('role', 'menuitemradio')
      item.setAttribute('aria-checked', String(value === current))
      item.dataset['focus'] = `${key}:${value}`
      const check = el(doc, 'span', 'menu-check')
      check.append(iconNode(doc, 'check', 16))
      item.append(check, el(doc, 'span', 'menu-label', words))
      item.addEventListener('click', () => {
        openPart = null
        focusNext = key
        if (value === current) drawModal()
        else pick(value)
      })
      menu.append(item)
    }
    anchor.append(menu)
    return anchor
  }

  /**
   * The values of a condition, open under its line: a box to tick each, with how many rows have
   * it, and a search once there are many.
   * @param {Condition} cond
   * @param {number[]} path
   * @param {string} label
   * @param {readonly Choice[]} all
   * @param {readonly (readonly string[])[] | null} values each row's values, to count
   */
  const valuesPanel = (cond, path, label, all, values) => {
    const id = path.join('.')
    const panel = el(doc, 'div', 'builder-values-panel')
    panel.setAttribute('role', 'group')
    panel.setAttribute('aria-label', `${label} values`)
    if (all.length > SEARCHABLE_CHOICES) {
      const search = /** @type {HTMLInputElement} */ (el(doc, 'input', 'text-input builder-search'))
      search.type = 'search'
      search.placeholder = TEXTS.lists.filterBuilder.searchValues(label)
      search.setAttribute('aria-label', search.placeholder)
      search.dataset['focus'] = `${id}:search`
      search.value = searches.get(id) ?? ''
      search.addEventListener('input', () => {
        searches.set(id, search.value)
        drawModal()
      })
      panel.append(search)
    }
    const query = (searches.get(id) ?? '').trim().toLowerCase()
    const matching = all.filter(([, words]) => query === '' || words.toLowerCase().includes(query))
    if (matching.length === 0) {
      panel.append(el(doc, 'span', 'small muted', TEXTS.lists.filterBuilder.noValues))
      return panel
    }
    /** @param {Choice} choice */
    const item = ([value, words]) => {
      const li = el(doc, 'li')
      const row = el(doc, 'label', 'check-row')
      const box = /** @type {HTMLInputElement} */ (el(doc, 'input'))
      box.type = 'checkbox'
      box.checked = cond.values.includes(value)
      box.dataset['focus'] = `${id}:value:${value}`
      box.addEventListener('change', () =>
        editCondition(path, c => ({
          ...c,
          values: box.checked ? [...c.values, value] : c.values.filter(v => v !== value),
        }))
      )
      row.append(box, ` ${words}`)
      if (values !== null)
        row.append(
          el(doc, 'span', 'muted small people-count', String(values.filter(v => v.includes(value)).length))
        )
      li.append(row)
      return li
    }
    // Choices with no heading first, then each heading's, as the Authors picker lists them.
    const groups = [...new Set(matching.flatMap(c => (c[2] === undefined ? [] : [c[2]])))]
    const list = el(doc, 'ul', 'builder-options')
    list.append(
      ...matching.filter(c => c[2] === undefined).map(item),
      ...groups.map((group, i) => {
        const li = el(doc, 'li', 'people-group')
        const title = el(doc, 'span', 'people-group-title small muted', group)
        title.id = `builder-group-${id.replaceAll('.', '-')}-${i}`
        const ul = el(doc, 'ul')
        ul.setAttribute('role', 'group')
        ul.setAttribute('aria-labelledby', title.id)
        ul.append(...matching.filter(c => c[2] === group).map(item))
        li.append(title, ul)
        return li
      })
    )
    panel.append(list)
    return panel
  }

  /**
   * One condition, on one line: its field, how it holds, a button that opens its values' list
   * under the line, and its remove button.
   * @param {Condition} cond
   * @param {number[]} path
   * @param {readonly Field<T>[]} fields
   */
  const conditionNode = (cond, path, fields) => {
    const id = path.join('.')
    const wrap = el(doc, 'div', 'builder-cond')
    wrap.dataset['path'] = id
    const field = fields.find(f => f.key === cond.field)
    const label = field?.label ?? (cond.field === '' ? 'new' : cond.field)
    // A saved field this page no longer offers, such as an integration turned off, shows as it is.
    const off = field === undefined && cond.field !== '' ? `${cond.field} (off)` : null
    wrap.append(
      menuButton(
        `${id}:field`,
        'builder-field',
        'Field',
        field?.label ?? off ?? '',
        'Pick a field',
        [
          ...fields.map(f => /** @type {const} */ ([f.key, f.label])),
          ...(off === null ? [] : [/** @type {const} */ ([cond.field, off])]),
        ],
        cond.field,
        key => {
          const next = fields.find(f => f.key === key)
          // Its values open, to pick from the new field's; a field you type in takes the cursor.
          if (next?.text === undefined) openValues.add(id)
          else openValues.delete(id)
          focusNext = next?.text === undefined ? `${id}:panel` : `${id}:text`
          searches.delete(id)
          set(update(editing(), path, () => newCondition(next)))
        }
      )
    )
    if (cond.field === '') {
      wrap.append(removeButton(path, label))
      return wrap
    }
    if (field?.text !== undefined) {
      wrap.append(...textParts(cond, path, label), removeButton(path, label))
      return wrap
    }

    const rows = opts.rows()
    const options = field === undefined ? [] : field.options(rows)
    const values = field === undefined ? null : rows.map(r => field.values(r))
    const multi = field?.multi === true
    // "has all of" only for a field a row can have several of: a row has one of any other.
    const ways = /** @type {const} */ (['any', 'none', 'all'])
      .filter(key => key !== 'all' || multi || cond.is === 'all')
      .map(key => /** @type {const} */ ([key, isWords(key, multi, cond.values.length)]))
    const isButton = menuButton(
      `${id}:is`,
      'builder-is',
      'Holds when the field',
      ways.find(([key]) => key === cond.is)?.[1] ?? '',
      '',
      ways,
      cond.is,
      key => editCondition(path, c => ({ ...c, is: /** @type {Is} */ (key) }))
    )
    // A ticked value no row has now still shows, so it can be unticked.
    const all = [
      ...options,
      ...cond.values
        .filter(v => !options.some(([value]) => value === v))
        .map(v => /** @type {const} */ ([v, v])),
    ]
    const words = new Map(all.map(([value, text]) => [value, text]))
    const picked = cond.values.map(v => words.get(v) ?? v).join(', ')
    const open = openValues.has(id)
    const pick = button(doc, 'builder-values-button', '')
    pick.dataset['focus'] = `${id}:values`
    pick.setAttribute('aria-expanded', String(open))
    pick.setAttribute('aria-label', `${label} values: ${picked === '' ? 'none picked' : picked}`)
    pick.title = picked === '' ? TEXTS.lists.filterBuilder.pickValueTip : picked
    pick.append(
      el(
        doc,
        'span',
        `builder-values-text${picked === '' ? ' muted' : ''}`,
        picked === '' ? TEXTS.lists.filterBuilder.pickValues : picked
      ),
      el(doc, 'span', 'builder-chevron', '▾')
    )
    pick.addEventListener('click', () => {
      if (open) openValues.delete(id)
      else openValues.add(id)
      if (!open) focusNext = `${id}:panel`
      drawModal()
    })
    wrap.append(isButton, pick, removeButton(path, label))
    // The list goes under the line, the remove button staying at its end.
    if (open) wrap.append(valuesPanel(cond, path, label, all, values))
    return wrap
  }

  /**
   * A typed condition's parts, after its field: whether rows match the words or not, and the box
   * the words go in, as the search box reads them (AND and OR included). Each word typed changes
   * the draft, the focus and the caret staying put.
   * @param {Condition} cond
   * @param {number[]} path
   * @param {string} label
   */
  const textParts = (cond, path, label) => {
    const id = path.join('.')
    const ways = /** @type {const} */ ([
      ['any', 'matches'],
      ['none', 'does not match'],
    ])
    const isButton = menuButton(
      `${id}:is`,
      'builder-is',
      'Holds when the row',
      ways.find(([key]) => key === cond.is)?.[1] ?? 'matches',
      '',
      ways,
      cond.is === 'none' ? 'none' : 'any',
      key => editCondition(path, c => ({ ...c, is: /** @type {Is} */ (key) }))
    )
    const box = /** @type {HTMLInputElement} */ (el(doc, 'input', 'text-input builder-text'))
    box.type = 'search'
    box.maxLength = MAX_TEXT
    box.value = cond.values[0] ?? ''
    box.placeholder = TEXTS.lists.filterBuilder.wordsPlaceholder
    box.setAttribute('aria-label', `${label}: words to match`)
    box.title = TEXTS.lists.filterBuilder.wordsTip
    box.dataset['focus'] = `${id}:text`
    // The draft, and the count of what it keeps, take the words once typing pauses, as the search
    // box does; leaving the box, as a click on Done does, takes them at once.
    let timer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
    const take = () => {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
      const words = box.value.trim()
      editCondition(path, c => ({ ...c, values: words === '' ? [] : [box.value.slice(0, MAX_TEXT)] }))
    }
    box.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(take, SEARCH_DELAY_MS)
    })
    box.addEventListener('change', take)
    box.addEventListener('blur', take)
    return [isButton, box]
  }

  /** A condition's remove button. @param {number[]} path @param {string} label */
  const removeButton = (path, label) => {
    const remove = button(doc, 'icon-button small-icon-button builder-remove', '')
    remove.append(iconNode(doc, 'x', 14))
    remove.title = 'Remove this condition'
    remove.setAttribute('aria-label', `Remove the ${label} condition`)
    remove.dataset['focus'] = `${path.join('.')}:remove`
    remove.addEventListener('click', () => removeAt(path))
    return remove
  }

  /**
   * One block: its conditions and blocks, each line led by the word that joins it to the ones
   * above ("Where" on the first; AND / OR, which switches the block's join, on the rest), then
   * buttons to add more. The outer block cannot be removed.
   * @param {Block} b
   * @param {number[]} path
   * @param {readonly Field<T>[]} fields
   * @returns {HTMLElement}
   */
  const blockNode = (b, path, fields) => {
    const id = path.join('.')
    const other = b.op === 'and' ? 'or' : 'and'
    const wrap = el(doc, 'div', `builder-block builder-${b.op}`)
    wrap.setAttribute('role', 'group')
    wrap.setAttribute(
      'aria-label',
      b.op === 'and' ? TEXTS.lists.filterBuilder.everyHolds : TEXTS.lists.filterBuilder.anyHolds
    )
    const list = el(doc, 'ol', 'builder-items')
    b.items.forEach((item, i) => {
      const li = el(doc, 'li', 'builder-item')
      if (i === 0) li.append(el(doc, 'span', 'builder-where', 'Where'))
      else {
        const join = button(doc, `builder-join builder-join-${b.op}`, b.op.toUpperCase())
        join.dataset['join'] = b.op
        join.dataset['focus'] = `${id}:op:${i}`
        join.title =
          b.op === 'and' ? TEXTS.lists.filterBuilder.switchToOr : TEXTS.lists.filterBuilder.switchToAnd
        join.setAttribute('aria-label', `${b.op.toUpperCase()}: switch to ${other.toUpperCase()}`)
        join.addEventListener('click', () =>
          set(update(editing(), path, node => ({ .../** @type {Block} */ (node), op: other })))
        )
        li.append(join)
      }
      li.append(
        isBlock(item) ? blockNode(item, [...path, i], fields) : conditionNode(item, [...path, i], fields)
      )
      list.append(li)
    })
    if (b.items.length > 0) wrap.append(list)
    else
      wrap.append(
        el(
          doc,
          'p',
          'small muted builder-empty',
          path.length === 0 ? TEXTS.lists.filterBuilder.noConditions : TEXTS.lists.filterBuilder.emptyBlock
        )
      )

    const add = el(doc, 'div', 'builder-add')
    /** Adds a node at the end of this block, its first condition's field focused to pick. @param {Node} node @param {number[]} first */
    const append = (node, first) => {
      openPart = null
      focusNext = `${[...path, b.items.length, ...first].join('.')}:field`
      set(
        update(editing(), path, n => ({
          .../** @type {Block} */ (n),
          items: [.../** @type {Block} */ (n).items, node],
        }))
      )
    }
    const addCondition = button(doc, 'button small-button', '+ Condition')
    addCondition.dataset['focus'] = `${id}:add`
    addCondition.disabled = fields.length === 0
    addCondition.addEventListener('click', () => append(newCondition(undefined), []))
    add.append(addCondition)
    if (path.length + 1 < MAX_DEPTH) {
      const addBlock = button(doc, 'button small-button', '+ Block')
      addBlock.title = TEXTS.lists.filterBuilder.addBlock(other.toUpperCase())
      addBlock.dataset['focus'] = `${id}:add-block`
      addBlock.disabled = fields.length === 0
      // A block inside joins the other way: the reason to have one.
      addBlock.addEventListener('click', () => append({ op: other, items: [newCondition(undefined)] }, [0]))
      add.append(addBlock)
    }
    if (path.length > 0) {
      add.append(el(doc, 'span', 'spacer'))
      const remove = button(doc, 'link-button small builder-remove-block', 'Remove block')
      remove.addEventListener('click', () => removeAt(path))
      add.append(remove)
    }
    wrap.append(add)
    return wrap
  }

  /**
   * Draws the draft in the modal, with how many rows it matches; nothing while closed. A redraw
   * the page asks for (`fromPage`: a sync brought new rows) leaves the blocks alone while one of
   * their searches or boxes has the focus, and only counts again.
   */
  const drawModal = (fromPage = false) => {
    if (root === null) return
    if (draft === null) {
      root.replaceChildren()
      return
    }
    const status = doc.getElementById('builder-shown')
    if (status !== null) {
      const count = filterWhere(opts.rows(), draft, opts.fields()).length
      status.textContent = count === 1 ? '1 match' : `${count} matches`
    }
    doc.getElementById('builder-off')?.toggleAttribute('hidden', !on())
    const focused = /** @type {HTMLElement | null} */ (doc.activeElement)
    if (fromPage && root.contains(focused) && focused?.matches('input')) return
    // A redraw keeps the focus on the same control, by its place and part, unless the change
    // named the one to go to next; `<place>:panel` is the first box of a list of values just
    // opened, `<key>:menu` the choice picked in a menu just opened, or its first.
    const next = focusNext
    focusNext = null
    const key = next ?? (root.contains(focused) ? (focused?.dataset['focus'] ?? null) : null)
    const caret = next === null && focused instanceof HTMLInputElement ? focused.selectionStart : null
    root.replaceChildren(blockNode(draft, [], opts.fields()))
    placeMenu()
    if (key === null) return
    const menuOf = (/** @type {string} */ owner) => root.querySelector(`.builder-menu[data-owner="${owner}"]`)
    const again = key.endsWith(':panel')
      ? /** @type {HTMLElement | null} */ (
          root.querySelector(
            `.builder-cond[data-path="${key.slice(0, -':panel'.length)}"] .builder-values-panel input`
          )
        )
      : key.endsWith(':menu')
        ? /** @type {HTMLElement | null} */ (
            menuOf(key.slice(0, -':menu'.length))?.querySelector('[aria-checked="true"]') ??
            menuOf(key.slice(0, -':menu'.length))?.querySelector('.menu-item') ??
            null
          )
        : [.../** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll('[data-focus]'))].find(
            n => n.dataset['focus'] === key
          )
    again?.focus()
    if (again instanceof HTMLInputElement && caret !== null) again.setSelectionRange(caret, caret)
  }

  /**
   * Shows the open menu over everything, the modal too, under its button, or above it when it fits
   * whole only there; scrolling the blocks or resizing the window moves it along.
   */
  const placeMenu = () => {
    const menu = root?.querySelector('.builder-menu')
    const view = doc.defaultView
    if (!(menu instanceof HTMLElement) || menu.parentElement === null || view === null) return
    if (typeof menu.showPopover === 'function' && !menu.matches(':popover-open')) menu.showPopover()
    const at = menu.parentElement.getBoundingClientRect()
    const below = view.innerHeight - at.bottom - 12
    const above = at.top - 12
    // Under its button when it fits whole there, else above when it fits whole there, else the
    // side with more room.
    const need = Math.min(260, menu.scrollHeight)
    const up = need > below && (need <= above || above > below)
    const room = Math.min(260, up ? above : below)
    menu.style.minWidth = `${at.width}px`
    menu.style.maxHeight = `${Math.max(120, room)}px`
    menu.style.left = `${Math.max(8, Math.min(at.left, view.innerWidth - menu.offsetWidth - 8))}px`
    menu.style.top = up ? `${Math.max(8, at.top - 4 - menu.offsetHeight)}px` : `${at.bottom + 4}px`
  }
  root?.addEventListener('scroll', placeMenu)
  doc.defaultView?.addEventListener('resize', placeMenu)

  const render = () => {
    if (!offered) return
    const shown = on()
    toggle.setAttribute('aria-pressed', String(shown))
    const conditions = conditionCount(block())
    const label = doc.getElementById('builder-label')
    if (label !== null)
      label.textContent = shown
        ? `Builder · ${conditions === 0 ? 'nothing' : conditions === 1 ? '1 condition' : `${conditions} conditions`}`
        : 'Builder'
    if (bar !== null) bar.hidden = shown
    // New rows give the open modal new counts.
    drawModal(true)
  }

  return {
    on,
    render,
    /**
     * The rows the blocks keep while Builder is on; null while the filter bar filters.
     * @param {readonly T[]} rows
     */
    keep: rows => (on() ? filterWhere(rows, block(), opts.fields()) : null),
    /** Whether the blocks keep less than everything. */
    filtered: () => on() && counts(block()),
  }
}
