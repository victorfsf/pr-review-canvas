// @ts-check
// @vitest-environment happy-dom
import { inboxSeed, queueFields, queueSeed } from './builder-fields.js'
import { confirmRemove } from './confirm.js'
import { INBOX_DEFAULTS } from './events.js'
import {
  acceptWhere,
  conditionCount,
  counts,
  emptyBlock,
  filterWhere,
  fitBlock,
  isWords,
  oneOf,
  parseWhere,
  seedBlock,
  SEARCHABLE_CHOICES,
  whereText,
  wireFilterBuilder,
} from './filter-builder.js'
import { SEARCH_DELAY_MS } from './search.js'
import { filterQueue, QUEUE_DEFAULTS } from './queue.js'

/** @typedef {{ n: number, color: string, tags: string[] }} Row */
/** @type {import('./filter-builder.js').Field<Row>[]} */
const FIELDS = [
  oneOf(
    'color',
    'Color',
    [
      ['red', 'Red'],
      ['blue', 'Blue'],
    ],
    r => r.color
  ),
  { key: 'tag', label: 'Tag', multi: true, options: () => [], values: r => r.tags },
]
/** @type {Row[]} */
const ROWS = [
  { n: 1, color: 'red', tags: ['a', 'b'] },
  { n: 2, color: 'blue', tags: ['a'] },
  { n: 3, color: 'red', tags: [] },
]
const kept = (/** @type {import('./filter-builder.js').Block} */ b) =>
  filterWhere(ROWS, b, FIELDS).map(r => r.n)

describe('the filter builder', () => {
  it('joins conditions by AND or OR, nesting blocks the other way', () => {
    const red = { field: 'color', is: /** @type {const} */ ('any'), values: ['red'] }
    const tagB = { field: 'tag', is: /** @type {const} */ ('any'), values: ['b'] }
    expect(kept({ op: 'and', items: [red, tagB] })).toEqual([1])
    expect(kept({ op: 'or', items: [red, tagB] })).toEqual([1, 3])
    // Blue, or red with no b: (color = blue) OR (red AND tag none of b).
    expect(
      kept({
        op: 'or',
        items: [
          { field: 'color', is: 'any', values: ['blue'] },
          { op: 'and', items: [red, { ...tagB, is: 'none' }] },
        ],
      })
    ).toEqual([2, 3])
  })

  it('has all of the values only when a row has every one', () => {
    expect(kept({ op: 'and', items: [{ field: 'tag', is: 'all', values: ['a', 'b'] }] })).toEqual([1])
    expect(kept({ op: 'and', items: [{ field: 'tag', is: 'none', values: ['a'] }] })).toEqual([3])
  })

  it('words how a condition holds by how many values are ticked', () => {
    expect(isWords('any', false, 1)).toBe('is')
    expect(isWords('any', false, 2)).toBe('is any of')
    expect(isWords('none', false, 0)).toBe('is not')
    expect(isWords('none', false, 3)).toBe('is none of')
    expect(isWords('any', true, 1)).toBe('has')
    expect(isWords('any', true, 2)).toBe('has any of')
    expect(isWords('none', true, 1)).toBe('does not have')
    expect(isWords('none', true, 2)).toBe('has none of')
    expect(isWords('all', true, 2)).toBe('has all of')
  })

  it('leaves out a condition with nothing ticked, an unknown field and an empty block', () => {
    const blank = { field: 'color', is: /** @type {const} */ ('any'), values: [] }
    // In an OR, a condition left out does not let every row through.
    expect(kept({ op: 'or', items: [blank, { field: 'tag', is: 'any', values: ['b'] }] })).toEqual([1])
    expect(
      kept({ op: 'and', items: [blank, { field: 'gone', is: 'any', values: ['x'] }, emptyBlock()] })
    ).toEqual([1, 2, 3])
    expect(counts({ op: 'and', items: [blank, emptyBlock()] })).toBe(false)
  })

  it('reads its blocks back from their text, and nothing else', () => {
    const block = {
      op: /** @type {const} */ ('or'),
      items: [{ field: 'color', is: /** @type {const} */ ('any'), values: ['red'] }],
    }
    expect(parseWhere(whereText(block))).toEqual(block)
    expect(whereText(emptyBlock())).toBe('')
    for (const bad of ['{', '[]', '{"op":"xor","items":[]}', '{"field":"x","is":"any","values":[]}', 42])
      expect(parseWhere(bad)).toEqual(emptyBlock())
    expect(acceptWhere('')).toBe(true)
    expect(acceptWhere(JSON.stringify(block))).toBe(true)
    expect(acceptWhere('{"op":"and","items":[{"field":1}]}')).toBe(false)
    // Deeper than three blocks is refused.
    const deep = {
      op: 'and',
      items: [{ op: 'or', items: [{ op: 'and', items: [{ op: 'or', items: [] }] }] }],
    }
    expect(acceptWhere(JSON.stringify(deep))).toBe(false)
    // "is none of" and "has all of" are blocks too; anything that is not text is not.
    const held = {
      op: /** @type {const} */ ('and'),
      items: [
        { field: 'tag', is: /** @type {const} */ ('none'), values: ['a'] },
        { field: 'tag', is: /** @type {const} */ ('all'), values: ['a', 'b'] },
      ],
    }
    expect(parseWhere(JSON.stringify(held))).toEqual(held)
    expect(acceptWhere(42)).toBe(false)
    expect(conditionCount({ field: 'color', is: 'any', values: [] })).toBe(0)
  })

  it('fits blocks from elsewhere to the fields the page offers, and drops the rest', () => {
    const specs = [
      {
        key: 'color',
        label: 'Color',
        multi: false,
        options: /** @type {[string, string][]} */ ([['red', 'Red']]),
      },
      { key: 'tag', label: 'Tag', multi: true, options: /** @type {[string, string][]} */ ([['a', 'A']]) },
    ]
    expect(fitBlock({ op: 'xor', items: [] }, specs)).toBeNull()
    expect(fitBlock({ op: 'and', items: 'no' }, specs)).toBeNull()
    expect(fitBlock({ op: 'and' }, specs)).toBeNull()
    expect(
      fitBlock(
        {
          op: 'or',
          items: [
            null,
            1,
            [],
            { field: 'color', is: 'any', values: ['red'] },
            { field: 'missing', is: 'any', values: ['red'] },
          ],
        },
        specs
      )
    ).toEqual({ op: 'or', items: [{ field: 'color', is: 'any', values: ['red'] }] })
  })

  it('starts from the filter bar: its filters ANDed, those at all left out', () => {
    expect(
      seedBlock([
        ['color', ['red']],
        ['tag', null],
      ])
    ).toEqual({ op: 'and', items: [{ field: 'color', is: 'any', values: ['red'] }] })
    expect(inboxSeed(INBOX_DEFAULTS)).toEqual({
      op: 'and',
      items: [{ field: 'dismissed', is: 'any', values: ['no'] }],
    })
  })

  it('keeps the same Review queue PRs as the filter bar it starts from', () => {
    /** @type {import('./queue.js').QueueRow[]} */
    const rows = [1, 2, 3, 4].map(n => ({
      number: n,
      title: '',
      url: '',
      author: n % 2 === 0 ? 'bob' : 'alice',
      readyAt: '2026-10-20T00:00:00Z',
      isDraft: n === 4,
      headRefName: `h${n}`,
      baseRefName: 'develop',
      labels: n === 1 ? ['Bug'] : [],
      additions: 0,
      deletions: 0,
      requested: n === 2,
      reviewers: [],
      canvas: n === 3 ? 'Ready' : 'Pending',
      codeRabbit: 'Pending',
      health: { ci: n === 1 ? 'failing' : 'passing', failing: 0, stuck: null, conflict: false },
    }))
    const on = { codeRabbit: true, vercel: false, canvas: true }
    const fields = queueFields({ on, branches: [{ name: 'develop', color: 'green' }] })
    for (const f of [
      { ...QUEUE_DEFAULTS },
      {
        ...QUEUE_DEFAULTS,
        state: /** @type {import('./pulls.js').StateFilter} */ (['open', 'draft', 'queued']),
        labels: ['bug', ':none'],
        authors: ['alice'],
      },
      { ...QUEUE_DEFAULTS, reviews: ['requested'] },
      { ...QUEUE_DEFAULTS, github: ['failing'], canvas: ['Ready'] },
    ]) {
      const bar = filterQueue(rows, f, true, false, true).map(r => r.number)
      const built = filterWhere(rows, queueSeed(f, { on, bases: null, stack: '' }), fields).map(r => r.number)
      expect(built).toEqual(bar)
    }
  })
})

const SHELL = `
<button type="button" id="builder-toggle" aria-pressed="false"><span id="builder-label">Builder</span></button>
<div id="bar-filters"></div>
<dialog id="filter-builder">
<button type="button" id="builder-chat-toggle" aria-pressed="false" aria-controls="builder-chat">Ask AI</button>
<button type="button" id="builder-close">Close</button>
<section id="builder-chat" hidden>
<ol id="builder-talk" hidden></ol>
<textarea id="builder-ask-input"></textarea>
<button type="button" id="builder-ask">Send</button>
<p id="builder-ask-error" hidden></p>
</section>
<div id="filter-builder-root"></div>
<button type="button" id="builder-off" hidden>Use the filter bar instead</button>
<span id="builder-shown"></span>
<button type="button" id="builder-done">Done</button>
</dialog>`

/** @param {string} id */
const byId = id => {
  const node = document.getElementById(id)
  if (node === null) throw new Error(id)
  return node
}

/**
 * @param {{ html?: string, filters?: { builder: boolean, where: string },
 *   fields?: () => readonly import('./filter-builder.js').Field<Row>[],
 *   seed?: (f: { builder: boolean, where: string }) => import('./filter-builder.js').Block,
 *   saved?: () => { name: string, filters: { builder: boolean, where: string } }[],
 *   groups?: () => { name: string, logins: string[] }[],
 *   ask?: (body: { page: string, messages: { from: 'you' | 'claude', text: string }[],
 *     fields: { key: string, label: string, multi: boolean, options: string[][] }[],
 *     current: import('./filter-builder.js').Block }) => Promise<{ reply: string, blocks: import('./filter-builder.js').Block | null }> }} [partial]
 */
const mount = (partial = {}) => {
  document.body.innerHTML = partial.html ?? SHELL
  let filters = { builder: false, where: '', ...partial.filters }
  /** @type {{ builder?: boolean, where?: string }[]} */
  const changes = []
  const wired = wireFilterBuilder(document, {
    fields: partial.fields ?? (() => FIELDS),
    rows: () => ROWS,
    filters: () => filters,
    change: next => {
      filters = { ...filters, ...next }
      changes.push(next)
      wired.render()
    },
    seed: partial.seed ?? (() => emptyBlock()),
    ...(partial.ask === undefined ? {} : { ask: partial.ask }),
    ...(partial.saved === undefined ? {} : { saved: partial.saved }),
    ...(partial.groups === undefined ? {} : { groups: partial.groups }),
  })
  wired.render()
  return {
    get filters() {
      return filters
    },
    set filters(next) {
      filters = next
    },
    changes,
    wired,
    /** @param {string} id */
    click(id) {
      const node = byId(id)
      if (!(node instanceof HTMLElement)) throw new Error(id)
      node.click()
    },
  }
}

const root = () => byId('filter-builder-root')

/** @param {ParentNode} scope @param {string} words */
const buttonNamed = (scope, words) => {
  const node = [...scope.querySelectorAll('button')].find(b => b.textContent === words)
  if (!(node instanceof HTMLButtonElement)) throw new Error(words)
  return node
}

/**
 * Picks a choice from a condition's field or "is" menu, opening it first.
 * @param {ParentNode} scope @param {'field' | 'is'} part @param {string} value
 */
const pickFrom = (scope, part, value) => {
  const opener = /** @type {HTMLButtonElement} */ (scope.querySelector(`.builder-${part}`))
  if (opener.getAttribute('aria-expanded') !== 'true') opener.click()
  const item = [...root().querySelectorAll('.builder-menu .menu-item')].find(i =>
    /** @type {HTMLElement} */ (i).dataset['focus']?.endsWith(`:${value}`)
  )
  if (!(item instanceof HTMLButtonElement)) throw new Error(value)
  item.click()
}

/** The words of the choices in the open menu. */
const menuItems = () => [...root().querySelectorAll('.builder-menu .menu-item')].map(i => i.textContent)

/** The fields with a typed Search field first, matching a row by its tags. */
const WITH_SEARCH = /** @type {import('./filter-builder.js').Field<Row>[]} */ ([
  {
    key: 'search',
    label: 'Search',
    options: () => [],
    values: () => [],
    text: (r, words) => words.split(' OR ').some(w => r.tags.includes(w)),
  },
  ...FIELDS,
])

describe('a typed field, such as Search', () => {
  /** @param {readonly import('./filter-builder.js').Node[]} items */
  const keptBy = items => filterWhere(ROWS, { op: 'and', items: [...items] }, WITH_SEARCH).map(r => r.n)

  it('keeps the rows that match its words, or with none those that do not, and is left out while empty', () => {
    expect(keptBy([{ field: 'search', is: 'any', values: ['b'] }])).toEqual([1])
    expect(keptBy([{ field: 'search', is: 'any', values: ['b OR a'] }])).toEqual([1, 2])
    expect(keptBy([{ field: 'search', is: 'none', values: ['a'] }])).toEqual([3])
    expect(keptBy([{ field: 'search', is: 'any', values: ['  '] }])).toEqual([1, 2, 3])
    expect(
      keptBy([
        { field: 'search', is: 'any', values: ['a'] },
        { field: 'color', is: 'any', values: ['blue'] },
      ])
    ).toEqual([2])
  })

  it('takes Claude’s words as they are, trimmed, the first value only, never "all"', () => {
    const specs = [{ key: 'search', label: 'Search', multi: false, options: [], text: true }]
    expect(
      fitBlock(
        {
          op: 'and',
          items: [
            { field: 'search', is: 'all', values: ['  login OR auth ', 'more'] },
            { field: 'search', is: 'none', values: ['   '] },
            { field: 'search', is: 'none', values: [7] },
            { field: 'search', is: 'none', values: ['x'.repeat(400)] },
          ],
        },
        specs
      )
    ).toEqual({
      op: 'and',
      items: [
        { field: 'search', is: 'any', values: ['login OR auth'] },
        { field: 'search', is: 'none', values: ['x'.repeat(300)] },
      ],
    })
  })
})

describe('the filter builder’s modal', () => {
  it('types a Search condition’s words in a box on its line, and Done keeps them', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const page = mount({ fields: () => WITH_SEARCH })
    page.click('builder-toggle')
    buttonNamed(byId('filter-builder'), '+ Condition').click()
    pickFrom(root(), 'field', 'search')
    // No list of values: the cursor goes in the words' box.
    expect(root().querySelector('.builder-values-button')).toBeNull()
    const box = /** @type {HTMLInputElement} */ (root().querySelector('.builder-text'))
    expect(document.activeElement).toBe(box)
    expect(root().querySelector('.builder-is')?.textContent).toContain('matches')
    box.value = 'b OR a'
    box.dispatchEvent(new Event('input'))
    // The words count once typing pauses, the line redrawn with the cursor still in the box.
    vi.advanceTimersByTime(SEARCH_DELAY_MS - 1)
    expect(byId('builder-shown').textContent).toBe('3 matches')
    vi.advanceTimersByTime(1)
    expect(document.activeElement).toBe(root().querySelector('.builder-text'))
    expect(byId('builder-shown').textContent).toBe('2 matches')
    pickFrom(root(), 'is', 'none')
    expect(byId('builder-shown').textContent).toBe('1 match')
    // Words still waiting are taken when the box is left, as a click on Done does first.
    const again = /** @type {HTMLInputElement} */ (root().querySelector('.builder-text'))
    again.value = 'b'
    again.dispatchEvent(new Event('input'))
    again.dispatchEvent(new Event('blur'))
    expect(byId('builder-shown').textContent).toBe('2 matches')
    page.click('builder-done')
    vi.useRealTimers()
    expect(JSON.parse(String(page.changes.at(-1)?.where))).toEqual({
      op: 'and',
      items: [{ field: 'search', is: 'none', values: ['b'] }],
    })
  })

  it('tells Ask AI which field takes typed words, and sends a saved search as a Search condition', async () => {
    /** @type {{ fields: { key: string, text?: boolean }[], saved: unknown[] }[]} */
    const sent = []
    const page = mount({
      fields: () => WITH_SEARCH,
      saved: () => [
        { name: 'Login', filters: /** @type {any} */ ({ builder: false, where: '', q: 'login' }) },
        { name: 'Plain', filters: /** @type {any} */ ({ builder: false, where: '', q: '' }) },
      ],
      seed: () => ({ op: 'and', items: [{ field: 'color', is: 'any', values: ['red'] }] }),
      ask: async body => {
        sent.push(/** @type {any} */ (body))
        return {
          reply: 'Done.',
          blocks: { op: 'and', items: [{ field: 'search', is: 'any', values: ['a'] }] },
        }
      },
    })
    page.click('builder-toggle')
    page.click('builder-chat-toggle')
    const input = /** @type {HTMLTextAreaElement} */ (byId('builder-ask-input'))
    input.value = 'saved filter Login, with tag a'
    page.click('builder-ask')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]?.fields.map(f => [f.key, f.text === true])).toEqual([
      ['search', true],
      ['color', false],
      ['tag', false],
    ])
    expect(sent[0]?.saved).toEqual([
      {
        name: 'Login',
        blocks: {
          op: 'and',
          items: [
            { field: 'color', is: 'any', values: ['red'] },
            { field: 'search', is: 'any', values: ['login'] },
          ],
        },
      },
      { name: 'Plain', blocks: { op: 'and', items: [{ field: 'color', is: 'any', values: ['red'] }] } },
    ])
    await vi.waitFor(() => expect(root().querySelector('.builder-text')).not.toBeNull())
    expect(/** @type {HTMLInputElement} */ (root().querySelector('.builder-text')).value).toBe('a')
  })

  it('says nothing is filtered while Builder is on with no condition, and Done writes that', () => {
    const page = mount({ filters: { builder: true, where: '' } })
    expect(byId('builder-label').textContent).toBe('Builder · nothing')
    expect(page.wired.filtered()).toBe(false)
    expect(page.wired.keep(ROWS)).toEqual(ROWS)
    page.filters = { builder: false, where: '' }
    page.wired.render()
    expect(byId('builder-label').textContent).toBe('Builder')
    expect(page.wired.keep(ROWS)).toBeNull()
    // Done before the modal opens applies the blocks the page already has.
    page.click('builder-done')
    expect(page.changes.at(-1)).toEqual({ builder: true, where: '' })
  })

  it('does nothing for the parts of the modal the page left out', () => {
    const page = mount({
      html: `<button type="button" id="builder-toggle"></button>
<button type="button" id="builder-done"></button>
<button type="button" id="builder-chat-toggle"></button>
<button type="button" id="builder-ask"></button>`,
    })
    page.click('builder-toggle')
    page.click('builder-chat-toggle')
    page.click('builder-ask')
    page.click('builder-done')
    expect(page.changes.at(-1)).toEqual({ builder: true, where: '' })
  })

  it('opens by setting the attribute where a dialog cannot show itself', () => {
    const page = mount()
    const dialog = /** @type {HTMLDialogElement} */ (byId('filter-builder'))
    Object.defineProperty(dialog, 'showModal', { configurable: true, value: undefined })
    page.click('builder-toggle')
    expect(dialog.getAttribute('open')).toBe('')
    expect(byId('filter-builder-root').textContent).toContain('No conditions: every row shows.')
    page.click('builder-close')
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  it('nests a block the other way, its first field to pick, and edits a condition inside it', () => {
    const page = mount()
    page.click('builder-toggle')
    const dialog = byId('filter-builder')
    const block = () => {
      const node = dialog.querySelector('.builder-block')
      if (node === null) throw new Error('block')
      return node
    }
    buttonNamed(block(), '+ Block').click()
    const inner = () => {
      const node = block().querySelector('.builder-block')
      if (node === null) throw new Error('inner')
      return node
    }
    expect(inner().getAttribute('aria-label')).toBe('Any condition may hold')
    expect(buttonNamed(inner(), 'Remove block').textContent).toBe('Remove block')
    // Its first condition's field is focused to pick, its menu closed, nothing else on its line yet.
    const field = /** @type {HTMLButtonElement} */ (inner().querySelector('.builder-field'))
    expect(field.textContent).toBe('Pick a field▾')
    expect(field.getAttribute('aria-label')).toBe('Field: Pick a field')
    expect(field.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(field)
    field.click()
    expect(menuItems()).toEqual(['Color', 'Tag'])
    expect(document.activeElement).toBe(inner().querySelector('.builder-menu .menu-item'))
    expect(inner().querySelector('.builder-is')).toBeNull()
    expect(inner().querySelector('.builder-remove')?.getAttribute('aria-label')).toBe(
      'Remove the new condition'
    )
    expect(byId('builder-shown').textContent).toBe('3 matches')
    pickFrom(inner(), 'field', 'color')
    // The menu closes and its values open, the first focused.
    expect(inner().querySelector('.builder-menu')).toBeNull()
    expect(inner().querySelector('.builder-field')?.textContent).toBe('Color▾')
    const box = () => /** @type {HTMLInputElement} */ (document.activeElement)
    expect(box().closest('.builder-values-panel')).not.toBeNull()
    expect(box().parentElement?.textContent).toBe(' Red2')
    box().checked = true
    box().dispatchEvent(new Event('change'))
    expect(byId('builder-shown').textContent).toBe('2 matches')
    expect(inner().querySelector('.builder-values-button .builder-values-text')?.textContent).toBe('Red')
    expect(inner().querySelector('.builder-is')?.textContent).toBe('is▾')
    const blue = /** @type {HTMLInputElement} */ (inner().querySelectorAll('.builder-options input')[1])
    blue.checked = true
    blue.dispatchEvent(new Event('change'))
    expect(inner().querySelector('.builder-values-button .builder-values-text')?.textContent).toBe(
      'Red, Blue'
    )
    expect(inner().querySelector('.builder-is')?.textContent).toBe('is any of▾')
    // Picking the field it has only closes the menu; the values stay.
    pickFrom(inner(), 'field', 'color')
    expect(inner().querySelector('.builder-values-button .builder-values-text')?.textContent).toBe(
      'Red, Blue'
    )
    expect(document.activeElement).toBe(inner().querySelector('.builder-field'))
    buttonNamed(inner(), '+ Block').click()
    expect(inner().querySelector(':scope .builder-block .builder-field')).toBe(document.activeElement)
    expect(inner().querySelector('.builder-menu')).toBeNull()
    expect(inner().querySelector('.builder-block')?.getAttribute('aria-label')).toBe(
      'Every condition must hold'
    )
    // The block inside it goes first, then the block itself.
    buttonNamed(inner(), 'Remove block').click()
    expect(inner().querySelector('.builder-block')).toBeNull()
    buttonNamed(inner(), 'Remove block').click()
    expect(dialog.querySelector('.builder-block .builder-block')).toBeNull()
    page.click('builder-done')
    expect(page.filters.builder).toBe(true)
  })

  it('reads a block as a sentence: Where, then the join, which switches the block', () => {
    const page = mount({
      filters: {
        builder: false,
        where: JSON.stringify({
          op: 'and',
          items: [
            { field: 'color', is: 'any', values: ['red'] },
            { field: 'tag', is: 'none', values: ['b'] },
          ],
        }),
      },
    })
    page.click('builder-toggle')
    const lead = () =>
      [...byId('filter-builder').querySelectorAll('.builder-item')].map(i => i.firstElementChild)
    expect(lead().map(n => n?.textContent)).toEqual(['Where', 'AND'])
    const ways = () => [...byId('filter-builder').querySelectorAll('.builder-is')].map(b => b.textContent)
    expect(ways()).toEqual(['is▾', 'does not have▾'])
    // Color offers no "is all of": a row has one color.
    ;/** @type {HTMLButtonElement} */ (byId('filter-builder').querySelector('.builder-is')).click()
    expect(menuItems()).toEqual(['is', 'is not'])
    // A field a row can have several of reads "has", and offers "has all of".
    const tag = /** @type {HTMLElement} */ (byId('filter-builder').querySelectorAll('.builder-cond')[1])
    ;/** @type {HTMLButtonElement} */ (tag.querySelector('.builder-is')).click()
    expect(menuItems()).toEqual(['has', 'does not have', 'has all of'])
    expect(root().querySelector('.builder-menu [aria-checked="true"]')?.textContent).toBe('does not have')
    expect(document.activeElement).toBe(root().querySelector('.builder-menu [aria-checked="true"]'))
    pickFrom(byId('filter-builder').querySelectorAll('.builder-cond')[1] ?? root(), 'is', 'all')
    expect(ways()).toEqual(['is▾', 'has all of▾'])
    pickFrom(byId('filter-builder').querySelectorAll('.builder-cond')[1] ?? root(), 'is', 'none')
    expect(byId('builder-shown').textContent).toBe('1 match')
    ;/** @type {HTMLButtonElement} */ (lead()[1]).click()
    expect(lead().map(n => n?.textContent)).toEqual(['Where', 'OR'])
    expect(byId('filter-builder').querySelector('.builder-block')?.getAttribute('aria-label')).toBe(
      'Any condition may hold'
    )
    expect(byId('builder-shown').textContent).toBe('3 matches')
  })

  it('picks the values of a field of two choices from its list, as any other', () => {
    const size = oneOf(
      'size',
      'Size',
      [
        ['s', 'Small'],
        ['l', 'Large'],
      ],
      /** @param {Row} r */ r => (r.n === 1 ? 's' : 'l')
    )
    const page = mount({ fields: () => [...FIELDS, size] })
    page.click('builder-toggle')
    buttonNamed(byId('filter-builder'), '+ Condition').click()
    const cond = () => /** @type {HTMLElement} */ (byId('filter-builder').querySelector('.builder-cond'))
    pickFrom(cond(), 'field', 'size')
    // Nothing ticked to start, its list open with each choice's count.
    expect(cond().querySelector('.builder-is')?.textContent).toBe('is▾')
    const boxes = () => /** @type {HTMLInputElement[]} */ ([
      ...cond().querySelectorAll('.builder-options input'),
    ])
    expect(boxes().map(b => b.parentElement?.textContent)).toEqual([' Small1', ' Large2'])
    expect(boxes().map(b => b.checked)).toEqual([false, false])
    expect(byId('builder-shown').textContent).toBe('3 matches')
    // Both ticked keep either.
    for (const box of [0, 1]) {
      const b = boxes()[box]
      if (b === undefined) throw new Error('box')
      b.checked = true
      b.dispatchEvent(new Event('change'))
    }
    expect(cond().querySelector('.builder-values-button .builder-values-text')?.textContent).toBe(
      'Small, Large'
    )
    expect(byId('builder-shown').textContent).toBe('3 matches')
    pickFrom(cond(), 'is', 'none')
    expect(byId('builder-shown').textContent).toBe('0 matches')
    page.click('builder-done')
    expect(parseWhere(page.filters.where)).toEqual({
      op: 'and',
      items: [{ field: 'size', is: 'none', values: ['s', 'l'] }],
    })
  })

  it('keeps a list of values open until its button or Escape in it closes it, before the modal', () => {
    const page = mount({
      filters: {
        builder: false,
        where: JSON.stringify({ op: 'and', items: [{ field: 'color', is: 'any', values: [] }] }),
      },
    })
    page.click('builder-toggle')
    const dialog = byId('filter-builder')
    const values = () => /** @type {HTMLButtonElement} */ (dialog.querySelector('.builder-values-button'))
    expect(values().textContent).toBe('Pick values▾')
    expect(values().title).toBe('Pick a value; until then this condition is left out')
    values().click()
    expect(values().getAttribute('aria-expanded')).toBe('true')
    // A click in the list keeps it open.
    dialog.querySelector('.builder-options')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(dialog.querySelector('.builder-values-panel')).not.toBeNull()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(escape)
    expect(escape.defaultPrevented).toBe(true)
    expect(dialog.querySelector('.builder-values-panel')).toBeNull()
    expect(document.activeElement).toBe(values())
    // The modal stays for this Escape; the next one closes it.
    const cancel = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(cancel)
    expect(cancel.defaultPrevented).toBe(true)
    const again = new Event('cancel', { cancelable: true })
    dialog.dispatchEvent(again)
    expect(again.defaultPrevented).toBe(false)
    const quiet = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    values().dispatchEvent(quiet)
    expect(quiet.defaultPrevented).toBe(false)
    // A click elsewhere leaves it open, and so does + Condition; its button closes it.
    values().click()
    dialog.querySelector('.builder-where')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(dialog.querySelector('.builder-values-panel')).not.toBeNull()
    buttonNamed(dialog, '+ Condition').click()
    expect(dialog.querySelector('.builder-values-panel')).not.toBeNull()
    expect(dialog.querySelectorAll('.builder-cond')).toHaveLength(2)
    values().click()
    expect(dialog.querySelector('.builder-values-panel')).toBeNull()
    root().dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }))
  })

  it('opens one menu at a time beside open lists, closes it on a click elsewhere or Escape, and moves with the arrows', () => {
    const page = mount({
      filters: {
        builder: false,
        where: JSON.stringify({
          op: 'and',
          items: [
            { field: 'color', is: 'any', values: ['red'] },
            { field: 'tag', is: 'any', values: [] },
          ],
        }),
      },
    })
    page.click('builder-toggle')
    const dialog = byId('filter-builder')
    const fields = () => /** @type {HTMLButtonElement[]} */ ([...dialog.querySelectorAll('.builder-field')])
    const lists = () => [...dialog.querySelectorAll('.builder-values-panel')]
    const valueButtons = () => /** @type {HTMLButtonElement[]} */ ([
      ...dialog.querySelectorAll('.builder-values-button'),
    ])
    // Both lines' lists open at once.
    valueButtons()[0]?.click()
    valueButtons()[1]?.click()
    expect(lists()).toHaveLength(2)
    // A field's menu opens with them open.
    fields()[1]?.click()
    expect(lists()).toHaveLength(2)
    expect(fields()[1]?.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement?.textContent).toBe('Tag')
    // A click in the menu that picks nothing keeps it open.
    dialog.querySelector('.builder-menu')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(dialog.querySelector('.builder-menu')).not.toBeNull()
    const key = (/** @type {string} */ k) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      document.activeElement?.dispatchEvent(event)
      return event
    }
    expect(key('ArrowDown').defaultPrevented).toBe(true)
    expect(document.activeElement?.textContent).toBe('Color')
    key('ArrowUp')
    expect(document.activeElement?.textContent).toBe('Tag')
    // Escape closes it, the focus back on its button.
    expect(key('Escape').defaultPrevented).toBe(true)
    expect(dialog.querySelector('.builder-menu')).toBeNull()
    expect(document.activeElement).toBe(fields()[1])
    root().dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }))
    // A click elsewhere closes it; one with nothing open does nothing.
    fields()[0]?.click()
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(dialog.querySelector('.builder-menu')).toBeNull()
    const before = fields()[0]
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(fields()[0]).toBe(before)
    // Its button closes it again; the lists stayed open throughout.
    fields()[0]?.click()
    fields()[0]?.click()
    expect(dialog.querySelector('.builder-menu')).toBeNull()
    expect(lists()).toHaveLength(2)
    // Escape in a list closes that one alone.
    ;/** @type {HTMLInputElement} */ (lists()[0]?.querySelector('input'))?.focus()
    key('Escape')
    expect(lists()).toHaveLength(1)
    expect(valueButtons().map(v => v.getAttribute('aria-expanded'))).toEqual(['false', 'true'])
    root().dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape' }))
    // Removing the first line keeps the other's list open, as it moves up.
    valueButtons()[0]?.click()
    expect(lists()).toHaveLength(2)
    ;/** @type {HTMLButtonElement} */ (dialog.querySelector('.builder-remove')).click()
    expect(dialog.querySelectorAll('.builder-cond')).toHaveLength(1)
    expect(lists()).toHaveLength(1)
  })

  it('changing a field opens its values, its search and ticks starting over', () => {
    const page = mount({
      filters: {
        builder: false,
        where: JSON.stringify({ op: 'and', items: [{ field: 'tag', is: 'any', values: ['b'] }] }),
      },
    })
    page.click('builder-toggle')
    pickFrom(root(), 'field', 'color')
    expect(byId('filter-builder').querySelector('.builder-values-panel')).not.toBeNull()
    expect(document.activeElement?.closest('.builder-values-panel')).not.toBeNull()
    expect(
      [
        .../** @type {NodeListOf<HTMLInputElement>} */ (root().querySelectorAll('.builder-options input')),
      ].map(b => b.checked)
    ).toEqual([false, false])
    // Removing the condition closes what was open.
    ;/** @type {HTMLButtonElement} */ (byId('filter-builder').querySelector('.builder-remove')).click()
    expect(byId('filter-builder').textContent).toContain('No conditions: every row shows.')
  })

  it('adds no condition when the page has no field, and leaves a new one’s field menu closed', () => {
    const page = mount({ fields: () => [] })
    page.click('builder-toggle')
    expect(buttonNamed(byId('filter-builder'), '+ Condition').disabled).toBe(true)
    expect(buttonNamed(byId('filter-builder'), '+ Block').disabled).toBe(true)
    mount()
    page.click('builder-toggle')
    buttonNamed(byId('filter-builder'), '+ Condition').click()
    buttonNamed(byId('filter-builder'), '+ Condition').click()
    const fields = [...byId('filter-builder').querySelectorAll('.builder-field')]
    expect(fields.map(f => f.getAttribute('aria-expanded'))).toEqual(['false', 'false'])
    expect(byId('filter-builder').querySelector('.builder-menu')).toBeNull()
    expect(document.activeElement).toBe(fields[1])
  })

  it('lists a field’s values under their headings, those with none first', () => {
    const page = mount({
      fields: () => [
        {
          key: 'who',
          label: 'Who',
          options: () => [
            ['nobody', 'Nobody'],
            ['ann', 'ann', 'People'],
            ['bot', 'bot', 'Bots'],
            ['bob', 'bob', 'People'],
          ],
          values: () => [],
        },
      ],
      filters: {
        builder: false,
        where: JSON.stringify({ op: 'and', items: [{ field: 'who', is: 'any', values: [] }] }),
      },
    })
    page.click('builder-toggle')
    ;/** @type {HTMLButtonElement} */ (byId('filter-builder').querySelector('.builder-values-button')).click()
    const list = /** @type {HTMLElement} */ (byId('filter-builder').querySelector('.builder-options'))
    expect([...list.children].map(li => li.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Nobody0',
      'People ann0 bob0',
      'Bots bot0',
    ])
    const group = list.querySelector('[role="group"]')
    expect(group?.getAttribute('aria-labelledby')).toBe('builder-group-0-0')
    expect(document.getElementById('builder-group-0-0')?.textContent).toBe('People')
  })

  it('searches a long list, keeps a ticked value no row has, and an unknown field’s values', () => {
    const letters = Array.from({ length: SEARCHABLE_CHOICES + 2 }, (_, i) => {
      const value = `v${i}`
      return /** @type {[string, string]} */ ([value, `Name ${value}`])
    })
    const last = letters.at(-1)?.[0] ?? ''
    const page = mount({
      fields: () => [
        {
          key: 'tag',
          label: 'Tag',
          multi: true,
          options: () => letters,
          values: row => row.tags,
        },
      ],
      filters: {
        builder: false,
        where: JSON.stringify({
          op: 'and',
          items: [
            { field: 'tag', is: 'any', values: [last, 'left'] },
            { field: 'gone', is: 'any', values: ['g0', 'g1'] },
          ],
        }),
      },
    })
    page.click('builder-toggle')
    const dialog = byId('filter-builder')
    const conds = () => [...dialog.querySelectorAll('.builder-cond')]
    const open = (/** @type {number} */ at) =>
      /** @type {HTMLButtonElement | null | undefined} */ (
        conds()[at]?.querySelector('.builder-values-button')
      )?.click()
    expect(conds()[0]?.querySelector('.builder-values-button .builder-values-text')?.textContent).toBe(
      'Name v9, left'
    )
    expect(conds()[1]?.querySelector('.builder-field')?.textContent).toContain('gone (off)')
    open(1)
    // Few values: no search; an unknown field's values show as they are, without counts.
    expect(dialog.querySelector('.builder-search')).toBeNull()
    expect(dialog.querySelector('[aria-label="gone values"]')?.textContent).toBe(' g0 g1')
    open(1)
    open(0)
    expect(dialog.querySelector('[aria-label="gone values"]')).toBeNull()
    const search = () => /** @type {HTMLInputElement} */ (dialog.querySelector('.builder-search'))
    expect(document.activeElement).toBe(search())
    expect(search().placeholder).toBe('Search tag')
    expect(dialog.querySelectorAll('.builder-options li')).toHaveLength(SEARCHABLE_CHOICES + 3)
    search().value = 'v1'
    search().dispatchEvent(new Event('input'))
    expect([...dialog.querySelectorAll('.builder-options li')].map(l => l.textContent)).toEqual([' Name v10'])
    search().value = 'zzz'
    search().setSelectionRange(2, 2)
    search().dispatchEvent(new Event('input'))
    expect(dialog.textContent).toContain('No values match.')
    // The search keeps its focus and caret as the list draws again.
    expect(document.activeElement).toBe(search())
    expect(search().selectionStart).toBe(2)
  })

  it('sends the saved filters as their blocks, those from the bar as the bar seeds them, and the saved groups', async () => {
    /** @type {unknown[]} */
    const sent = []
    const reds = {
      op: /** @type {const} */ ('and'),
      items: [{ field: 'color', is: /** @type {const} */ ('any'), values: ['red'] }],
    }
    const page = mount({
      seed: f => ({
        op: 'or',
        items: f.where === 'bar' ? [] : [{ field: 'color', is: 'none', values: ['blue'] }],
      }),
      saved: () => [
        { name: 'Reds', filters: { builder: true, where: JSON.stringify(reds) } },
        { name: 'Bar', filters: { builder: false, where: 'bar' } },
      ],
      groups: () => [{ name: 'Team', logins: ['ann', 'ben'] }],
      ask: async body => {
        sent.push(body)
        return { reply: 'Reds.', blocks: null }
      },
    })
    page.click('builder-toggle')
    page.click('builder-chat-toggle')
    const input = /** @type {HTMLTextAreaElement} */ (byId('builder-ask-input'))
    input.value = 'saved filter Reds'
    page.click('builder-ask')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({
      saved: [
        { name: 'Reds', blocks: reds },
        { name: 'Bar', blocks: { op: 'or', items: [] } },
      ],
      groups: [{ name: 'Team', logins: ['ann', 'ben'] }],
    })
  })

  it('asks without a page named, and reports a failure that is not an error', async () => {
    /** @type {unknown[]} */
    const sent = []
    let fail = false
    const page = mount({
      ask: async body => {
        sent.push(body)
        if (fail) throw 'nope'
        return { reply: 'Which color?', blocks: null }
      },
    })
    page.click('builder-toggle')
    page.click('builder-chat-toggle')
    const input = /** @type {HTMLTextAreaElement} */ (byId('builder-ask-input'))
    input.value = '   '
    page.click('builder-ask')
    expect(sent).toEqual([])
    input.value = 'reds'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))
    expect(sent).toEqual([])
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ page: '', messages: [{ from: 'you', text: 'reds' }] })
    expect(byId('builder-talk').textContent).toContain('Which color?')
    fail = true
    input.value = 'again'
    page.click('builder-ask')
    await vi.waitFor(() => expect(byId('builder-ask-error').textContent).toBe('nope'))
    expect(input.value).toBe('again')
    page.click('builder-chat-toggle')
    expect(byId('builder-chat').hidden).toBe(true)
  })

  it('confirms in a dialog, and still opens where the dialog API is missing', async () => {
    document.body.innerHTML = ''
    const first = confirmRemove(document, { title: 'Delete saved filter?', text: 'Gone.', confirm: 'Delete' })
    byId('confirm-ok').click()
    await expect(first).resolves.toBe(true)
    const dialog = /** @type {HTMLDialogElement} */ (byId('confirm-dialog'))
    Object.defineProperty(dialog, 'showModal', { configurable: true, value: undefined })
    Object.defineProperty(dialog, 'close', { configurable: true, value: undefined })
    const second = confirmRemove(document, {
      title: 'Delete saved filter?',
      text: 'Gone.',
      confirm: 'Delete',
    })
    expect(dialog.getAttribute('open')).toBe('')
    byId('confirm-cancel').click()
    await expect(second).resolves.toBe(false)
    expect(dialog.hasAttribute('open')).toBe(false)
  })
})
