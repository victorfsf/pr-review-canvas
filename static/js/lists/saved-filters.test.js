// @ts-check
// @vitest-environment happy-dom
import { flushSavedFilters, resetSavedFilters, savePresets } from './filters.js'
import { QUEUE_ACCEPT, QUEUE_DEFAULTS } from './queue.js'
import { wireSavedFilters } from './saved-filters.js'

const REPO = { owner: 'acme', name: 'widgets' }

const PRESETS = `
<button type="button" id="presets-button" aria-expanded="false"><span id="presets-label">None</span></button>
<section id="presets-panel" hidden>
<input id="presets-search" />
<ul id="presets-list"></ul>
<input id="presets-name" />
<button type="button" id="presets-save">Save</button>
</section>`

/** @param {string} id */
const byId = id => {
  const node = document.getElementById(id)
  if (node === null) throw new Error(id)
  return node
}

beforeEach(() => {
  localStorage.clear()
  resetSavedFilters()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}))
  )
  document.body.innerHTML = PRESETS
})

afterEach(async () => {
  flushSavedFilters()
  await new Promise(resolve => setTimeout(resolve, 0))
  vi.unstubAllGlobals()
})

describe('saved filters', () => {
  it('saves a page that has no builder, replacing a name, and ignores a blank name, the defaults and any key but Enter', () => {
    /** @type {{ state: string, authors: string[] | null }} */
    let current = { state: 'open', authors: null }
    const saved = wireSavedFilters(document, {
      repo: REPO,
      page: 'inbox',
      defaults: { state: 'open', authors: null },
      accept: {
        state: value => value === 'open' || value === 'draft' || value === 'both',
        authors: value => Array.isArray(value) && value.every(v => typeof v === 'string'),
      },
      current: () => current,
      apply: () => undefined,
    })
    saved.render()
    const name = /** @type {HTMLInputElement} */ (byId('presets-name'))
    const save = /** @type {HTMLButtonElement} */ (byId('presets-save'))
    name.value = '  '
    save.click()
    name.value = 'Nope'
    save.click()
    expect(byId('presets-list').textContent).toContain('No saved filters yet.')
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(byId('presets-list').textContent).toContain('No saved filters yet.')
    current = { state: 'draft', authors: null }
    name.value = 'Drafts'
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    current = { state: 'both', authors: ['ann'] }
    name.value = 'Both'
    save.click()
    current = { state: 'open', authors: ['bob'] }
    name.value = 'Drafts'
    save.click()
    const text = [...byId('presets-list').querySelectorAll('.saved-search')].map(p =>
      p.textContent?.replace(/\s+/g, ' ')
    )
    expect(text).toEqual(['Drafts 1 filter', 'Both 2 filters'])
  })

  it('names a builder filter by how many conditions it has, and says when the page cannot open the builder', () => {
    const where = (/** @type {number} */ n) =>
      JSON.stringify({
        op: 'and',
        items: Array.from({ length: n }, (_, i) => ({ field: 'author', is: 'any', values: [`p${i}`] })),
      })
    savePresets(REPO, 'queue', [
      { name: 'Two', filters: { ...QUEUE_DEFAULTS, builder: true, where: where(2) } },
      { name: 'One', filters: { ...QUEUE_DEFAULTS, builder: true, where: where(1) } },
      { name: 'Zero', filters: { ...QUEUE_DEFAULTS, builder: true, where: where(0) } },
    ])
    const saved = wireSavedFilters(document, {
      repo: REPO,
      page: 'queue',
      defaults: QUEUE_DEFAULTS,
      accept: QUEUE_ACCEPT,
      current: () => ({ ...QUEUE_DEFAULTS }),
      apply: () => undefined,
    })
    saved.render()
    const picks = [...byId('presets-list').querySelectorAll('.saved-search')]
    expect(picks.map(p => p.textContent?.replace(/\s+/g, ' '))).toEqual([
      'Two Builder 2 conditions',
      'One Builder 1 condition',
      'Zero Builder 0 conditions',
    ])
    for (const [i, pick] of picks.entries()) {
      if (!(pick instanceof HTMLElement)) throw new Error('pick')
      expect(pick.title).toBe(
        `${['Two', 'One', 'Zero'][i]} · Built with the filter builder: turn it on in Settings → Experimental to use it`
      )
    }
  })

  it('renames a saved filter, refusing a blank or taken name, and updates one to the page’s filters once confirmed', async () => {
    savePresets(REPO, 'inbox', [
      { name: 'Drafts', filters: { state: 'draft', authors: null } },
      { name: 'Ann', filters: { state: 'open', authors: ['ann'] } },
    ])
    /** @type {{ state: string, authors: string[] | null }} */
    let current = { state: 'open', authors: null }
    const saved = wireSavedFilters(document, {
      repo: REPO,
      page: 'inbox',
      defaults: { state: 'open', authors: null },
      accept: {
        state: value => value === 'open' || value === 'draft' || value === 'both',
        authors: value => Array.isArray(value) && value.every(v => typeof v === 'string'),
      },
      current: () => current,
      apply: () => undefined,
    })
    saved.render()
    const flush = () => new Promise(resolve => setTimeout(resolve, 0))
    const press = (/** @type {string} */ label) =>
      /** @type {HTMLButtonElement} */ (byId('presets-list').querySelector(`[aria-label="${label}"]`)).click()
    const names = () =>
      [...byId('presets-list').querySelectorAll('.saved-search strong')].map(s => s.textContent)
    const dialog = () => /** @type {HTMLDialogElement} */ (byId('confirm-dialog'))
    const field = () => /** @type {HTMLInputElement} */ (byId('confirm-name'))
    const submit = () => byId('confirm-ok').click()

    // Rename: a blank name or another's says why and keeps the dialog open.
    press('Rename saved filter Drafts')
    expect(field().value).toBe('Drafts')
    field().value = '  '
    submit()
    expect(dialog().textContent).toContain('Give it a name.')
    field().value = 'Ann'
    submit()
    expect(dialog().textContent).toContain('There is already a saved filter named “Ann”.')
    field().value = '  My drafts '
    submit()
    await flush()
    expect(names()).toEqual(['My drafts', 'Ann'])
    // Cancel, or the same name, changes nothing.
    press('Rename saved filter Ann')
    byId('confirm-cancel').click()
    await flush()
    press('Rename saved filter Ann')
    submit()
    await flush()
    expect(names()).toEqual(['My drafts', 'Ann'])

    // Update: off while the page has no filters, or has this one's.
    const update = (/** @type {string} */ name) =>
      /** @type {HTMLButtonElement} */ (
        byId('presets-list').querySelector(
          `[aria-label="Update saved filter ${name} to the current filters"]`
        )
      )
    expect(update('Ann').disabled).toBe(true)
    expect(update('Ann').title).toBe('Pick some filters first')
    current = { state: 'open', authors: ['ann'] }
    saved.render()
    expect([update('Ann').disabled, update('Ann').title]).toEqual([
      true,
      'It has the current filters already',
    ])
    current = { state: 'both', authors: ['bob'] }
    saved.render()
    expect(update('Ann').disabled).toBe(false)
    update('Ann').click()
    expect(byId('confirm-text').textContent).toBe(
      '“Ann” will keep the filters on the page now in place of its own.'
    )
    expect(byId('confirm-ok').className).toContain('primary-button')
    byId('confirm-cancel').click()
    await flush()
    expect(update('Ann').disabled).toBe(false)
    update('Ann').click()
    byId('confirm-ok').click()
    await flush()
    // The page's filters are Ann's now, so Ann shows applied, and stays named Ann.
    expect(byId('presets-label').textContent).toBe('Ann')
    expect(names()).toEqual(['My drafts', 'Ann'])
    expect(update('Ann').disabled).toBe(true)
  })
})
