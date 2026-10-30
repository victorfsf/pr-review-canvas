// @ts-check
// @vitest-environment happy-dom
import { listsMain } from '../../../src/server/lists-html.ts'
import { cleanSections, previewText, wireSectionsEditor } from './sections-editor.js'

/** @type {{ url: string, init: RequestInit | undefined }[]} */
let requests
/** @type {(url: string, init?: RequestInit) => Response} */
let respond

beforeEach(() => {
  requests = []
  respond = (url, init) =>
    init?.method === 'PUT'
      ? Response.json(JSON.parse(String(init.body)))
      : Response.json({
          sections: [
            { name: 'Critical', labels: ['Critical'] },
            { name: 'Bugs', labels: ['bug'] },
            { name: 'Tasks', labels: [] },
          ],
          pulls: [
            { number: 1, title: 'A', labels: ['bug', 'Critical'] },
            { number: 2, title: 'B', labels: ['bug', 'security'] },
            { number: 3, title: 'C', labels: [] },
          ],
        })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
      requests.push({ url, init })
      return respond(url, init)
    })
  )
})

afterEach(() => vi.unstubAllGlobals())

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

async function open() {
  const markup = String(
    await listsMain({
      tab: 'queue',
      owner: 'acme',
      repo: 'widgets',
      base: '/r/acme/widgets/',
      forge: 'GitHub',
      nounShort: 'PR',
      canGenerate: false,
      savedFilters: {},
    })
  )
  document.body.innerHTML = new DOMParser().parseFromString(markup, 'text/html').body.innerHTML
  wireSectionsEditor(document)
  const opener = /** @type {HTMLButtonElement} */ (document.querySelector('[data-open-sections]'))
  opener.click()
  await flush()
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('sections-dialog'))
  const rows = () => [...dialog.querySelectorAll('.section-row')]
  const names = () =>
    rows().map(r => /** @type {HTMLInputElement} */ (r.querySelector('.section-name')).value)
  const byLabel = (/** @type {string} */ label) =>
    /** @type {HTMLElement} */ (dialog.querySelector(`[aria-label="${label}"]`))
  return {
    dialog,
    rows,
    names,
    byLabel,
    preview: () => document.getElementById('section-preview')?.textContent,
    error: () => /** @type {HTMLElement} */ (document.getElementById('sections-error')),
    click: (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id)).click(),
  }
}

describe('previewText and cleanSections', () => {
  it('counts the PRs in each section, a PR two sections claim in the first', () => {
    const sections = [
      { name: 'Critical', labels: ['critical'] },
      { name: '', labels: ['bug'] },
      { name: 'Tasks', labels: [] },
    ]
    expect(previewText(sections, [{ number: 4, title: 'x', labels: ['Bug', 'CRITICAL'] }])).toBe(
      'Critical 1 · Unnamed 0 · Tasks 0.'
    )
  })

  it('trims names, drops repeated labels and the catch-all’s, and refuses an empty name', () => {
    expect(
      cleanSections([
        { name: ' Bugs ', labels: ['bug', ' Bug ', '', 'regression'] },
        { name: 'Rest', labels: ['x'] },
      ])
    ).toEqual({
      sections: [
        { name: 'Bugs', labels: ['bug', 'regression'] },
        { name: 'Rest', labels: [] },
      ],
    })
    expect(cleanSections([{ name: '  ', labels: [] }])).toEqual({ error: 'Every section needs a name.' })
  })
})

describe('the sections editor', () => {
  it('opens with the sections, label suggestions and a preview', async () => {
    const e = await open()
    expect(requests[0]?.url).toBe('/r/acme/widgets/api/lists-sections')
    expect(e.dialog.open).toBe(true)
    expect(e.names()).toEqual(['Critical', 'Bugs', 'Tasks'])
    expect(e.rows()[2]?.textContent).toContain('Can be renamed, not moved or deleted.')
    expect(
      [...document.querySelectorAll('#label-options option')].map(
        o => /** @type {HTMLOptionElement} */ (o).label
      )
    ).toEqual(['bug · 2 open PRs', 'Critical · 1 open PR', 'security · 1 open PR'])
    expect(e.preview()).toBe('Critical 1 · Bugs 1 · Tasks 1.')
    expect(/** @type {HTMLButtonElement} */ (e.byLabel('Move Critical up')).disabled).toBe(true)
    expect(/** @type {HTMLButtonElement} */ (e.byLabel('Move Bugs down')).disabled).toBe(true)
  })

  it('moves, renames, labels, adds and deletes sections, then saves', async () => {
    const e = await open()
    e.byLabel('Move Bugs up').click()
    expect(e.names()).toEqual(['Bugs', 'Critical', 'Tasks'])
    e.byLabel('Move Bugs down').click()
    expect(e.names()).toEqual(['Critical', 'Bugs', 'Tasks'])
    const name = /** @type {HTMLInputElement} */ (e.rows()[1]?.querySelector('.section-name'))
    name.value = 'Defects'
    name.dispatchEvent(new Event('input'))
    expect(e.preview()).toContain('Defects 1')
    e.click('section-add')
    expect(e.names()).toEqual(['Critical', 'Defects', '', 'Tasks'])
    const label = /** @type {HTMLInputElement} */ (e.byLabel('Add label to section 3'))
    label.value = 'security'
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    const named = /** @type {HTMLInputElement} */ (e.rows()[2]?.querySelector('.section-name'))
    named.value = 'Security'
    named.dispatchEvent(new Event('input'))
    const typed = /** @type {HTMLInputElement} */ (e.byLabel('Add label to Defects'))
    typed.value = 'regression'
    typed.dispatchEvent(new Event('change'))
    typed.value = '  '
    typed.dispatchEvent(new Event('change'))
    e.byLabel('Remove label bug').click()
    // The rename survives label edits.
    expect(e.names()).toEqual(['Critical', 'Defects', 'Security', 'Tasks'])
    e.byLabel('Delete section Critical').click()
    expect(e.names()).toEqual(['Defects', 'Security', 'Tasks'])
    e.byLabel('Add label to Defects').dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    /** @type {string | null} */
    let saved = null
    document.addEventListener('pr-greenlight:sections', event => {
      saved = JSON.stringify(/** @type {CustomEvent} */ (event).detail)
    })
    e.click('sections-save')
    await flush()
    expect(requests.at(-1)?.init?.method).toBe('PUT')
    expect(requests.at(-1)?.url).toBe('/r/acme/widgets/api/lists-sections')
    expect(JSON.parse(String(requests.at(-1)?.init?.body))).toEqual({
      sections: [
        { name: 'Defects', labels: ['regression'], color: 'yellow' },
        { name: 'Security', labels: ['security'], color: 'purple' },
        { name: 'Tasks', labels: [], color: 'gray' },
      ],
    })
    expect(e.dialog.open).toBe(false)
    expect(saved).toBe(
      '[{"name":"Defects","labels":["regression"],"color":"yellow"},{"name":"Security","labels":["security"],"color":"purple"},{"name":"Tasks","labels":[],"color":"gray"}]'
    )
  })

  it('shows each section in its color, the catch-all too, and saves the colors picked', async () => {
    const e = await open()
    const checked = () =>
      e.rows().map(r => r.querySelector('.swatch[aria-checked="true"]')?.getAttribute('aria-label'))
    // Saved without colors: each takes the one its place gives.
    expect(checked()).toEqual(['Red', 'Yellow', 'Gray'])
    const pick = (/** @type {number} */ row, /** @type {string} */ color) => {
      const swatch = e.rows()[row]?.querySelector(`.swatch[aria-label="${color}"]`)
      if (swatch instanceof HTMLElement) swatch.click()
    }
    pick(1, 'Blue')
    pick(2, 'Green')
    expect(checked()).toEqual(['Red', 'Blue', 'Green'])
    // A color stays with its section when the section moves.
    e.byLabel('Move Bugs up').click()
    expect(checked()).toEqual(['Blue', 'Red', 'Green'])
    e.click('section-add')
    expect(checked()).toEqual(['Blue', 'Red', 'Yellow', 'Green'])
    e.click('sections-reset')
    expect(checked()).toEqual(['Red', 'Yellow', 'Gray'])
    pick(0, 'Purple')
    e.click('sections-save')
    await flush()
    expect(
      JSON.parse(String(requests.at(-1)?.init?.body)).sections.map(
        (/** @type {{ color: string }} */ s) => s.color
      )
    ).toEqual(['purple', 'yellow', 'gray'])
  })

  it('stops at twelve sections, resets, cancels, and says why a save failed', async () => {
    const e = await open()
    for (let i = 0; i < 12; i++) e.click('section-add')
    expect(e.names()).toHaveLength(12)
    expect(/** @type {HTMLButtonElement} */ (document.getElementById('section-add')).disabled).toBe(true)
    e.click('sections-save')
    expect(e.error().textContent).toBe('Every section needs a name.')
    e.click('sections-reset')
    expect(e.names()).toEqual(['Critical', 'Bugs', 'Tasks'])
    respond = () => Response.json({ error: { code: 'X', message: 'disk full' } }, { status: 500 })
    e.click('sections-save')
    await flush()
    expect(e.error().textContent).toBe('Not saved: disk full')
    e.click('sections-cancel')
    expect(e.dialog.open).toBe(false)
    respond = () => Response.json({ error: { code: 'X', message: 'down' } }, { status: 500 })
    const opener = /** @type {HTMLButtonElement} */ (document.querySelector('[data-open-sections]'))
    opener.click()
    await flush()
    expect(e.error().textContent).toBe('Could not load the sections: down')
    expect(e.names()).toEqual(['Critical', 'Bugs', 'Tasks'])
    e.click('sections-close')
    expect(e.dialog.open).toBe(false)
  })

  it('opens without showModal too', async () => {
    const show = HTMLDialogElement.prototype.showModal
    const close = HTMLDialogElement.prototype.close
    // @ts-expect-error: a browser without modal dialogs.
    HTMLDialogElement.prototype.showModal = undefined
    // @ts-expect-error: and without close.
    HTMLDialogElement.prototype.close = undefined
    try {
      const e = await open()
      expect(e.dialog.hasAttribute('open')).toBe(true)
      e.click('sections-cancel')
      expect(e.dialog.hasAttribute('open')).toBe(false)
    } finally {
      HTMLDialogElement.prototype.showModal = show
      HTMLDialogElement.prototype.close = close
    }
  })

  it('shows the colors the sections were saved with', async () => {
    respond = () =>
      Response.json({
        sections: [
          { name: 'Bugs', labels: ['bug'], color: 'blue' },
          { name: 'Tasks', labels: [], color: 'green' },
        ],
        pulls: [],
      })
    const e = await open()
    expect(
      e.rows().map(r => r.querySelector('.swatch[aria-checked="true"]')?.getAttribute('aria-label'))
    ).toEqual(['Blue', 'Green'])
  })

  it('does nothing on a page without the dialog', () => {
    document.body.innerHTML = '<main></main>'
    expect(wireSectionsEditor(document)).toBeUndefined()
  })
})
