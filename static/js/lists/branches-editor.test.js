// @ts-check
// @vitest-environment happy-dom
import { listsMain } from '../../../src/server/lists-html.ts'
import { wireBranchesEditor } from './branches-editor.js'
import { MAX_BRANCHES } from './branches.js'

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
          branches: [
            { name: 'main', color: 'green' },
            { name: 'develop', color: 'blue' },
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
      tab: 'pulls',
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
  wireBranchesEditor(document)
  const click = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id)).click()
  click('branches-open')
  await flush()
  const dialog = /** @type {HTMLDialogElement} */ (document.getElementById('branches-dialog'))
  const rows = () => [...dialog.querySelectorAll('.branch-row')]
  const nameInput = (/** @type {number} */ i) =>
    /** @type {HTMLInputElement} */ (rows()[i]?.querySelector('.branch-name'))
  const byLabel = (/** @type {string} */ label) =>
    /** @type {HTMLButtonElement} */ (dialog.querySelector(`[aria-label="${label}"]`))
  return {
    dialog,
    rows,
    nameInput,
    names: () => rows().map((_, i) => nameInput(i).value),
    pills: () => rows().map(r => r.querySelector('.branch-pill')?.textContent),
    colors: () =>
      rows().map(r => r.querySelector('.swatch[aria-checked="true"]')?.getAttribute('aria-label')),
    byLabel,
    error: () => /** @type {HTMLElement} */ (document.getElementById('branches-error')),
    add: () => /** @type {HTMLButtonElement} */ (document.getElementById('branch-add')),
    click,
    type: (/** @type {number} */ i, /** @type {string} */ value) => {
      const input = nameInput(i)
      input.value = value
      input.dispatchEvent(new Event('input'))
    },
  }
}

describe('the base branches editor', () => {
  it('opens with the saved branches, each with its name, colors, pill and remove', async () => {
    const e = await open()
    expect(requests[0]?.url).toBe('/r/acme/widgets/api/lists-branches')
    expect(e.dialog.open).toBe(true)
    expect(e.error().hidden).toBe(true)
    expect(e.names()).toEqual(['main', 'develop'])
    expect(e.pills()).toEqual(['main', 'develop'])
    expect(e.colors()).toEqual(['Green', 'Blue'])
    const input = e.nameInput(0)
    expect([input.placeholder, input.maxLength, input.getAttribute('aria-label')]).toEqual([
      'branch name',
      100,
      'Name of base branch 1',
    ])
    expect(e.byLabel('Remove main').disabled).toBe(false)
    expect(e.byLabel('Remove main').title).toBe('Remove')
  })

  it('renames, recolors, adds with an unused color and removes branches, then saves and reloads the table', async () => {
    const e = await open()
    const synced = vi.fn()
    document.querySelector('main[data-page]')?.addEventListener('pr-greenlight:synced', synced)
    e.type(1, ' release ')
    expect(e.pills()).toEqual(['main', 'release'])
    // An empty name keeps a placeholder pill.
    e.type(1, '  ')
    expect(e.pills()).toEqual(['main', 'branch'])
    e.type(1, 'release')
    const swatch = /** @type {HTMLElement} */ (e.rows()[1]?.querySelector('.swatch[aria-label="Purple"]'))
    swatch.click()
    expect(e.colors()).toEqual(['Green', 'Purple'])
    // Focus stays on the swatch picked after the rows are drawn again.
    expect(document.activeElement?.getAttribute('data-focus')).toBe('purple-1')
    e.click('branch-add')
    // The first color no branch has: red.
    expect(e.colors()).toEqual(['Green', 'Purple', 'Red'])
    expect(e.byLabel('Color of branch 3')).not.toBeNull()
    expect(document.activeElement).toBe(e.nameInput(2))
    e.type(2, 'hotfix')
    e.byLabel('Remove main').click()
    expect(e.names()).toEqual(['release', 'hotfix'])
    e.click('branches-save')
    await flush()
    const put = requests.at(-1)
    expect([put?.url, put?.init?.method]).toEqual(['/r/acme/widgets/api/lists-branches', 'PUT'])
    expect(JSON.parse(String(put?.init?.body))).toEqual({
      branches: [
        { name: 'release', color: 'purple' },
        { name: 'hotfix', color: 'red' },
      ],
    })
    expect(e.dialog.open).toBe(false)
    expect(synced).toHaveBeenCalledTimes(1)
  })

  it('keeps the last branch, and stops adding at the most a repo can list, then reuses the first color', async () => {
    respond = () => Response.json({ branches: [{ name: 'main', color: 'green' }] })
    const e = await open()
    const remove = e.byLabel('Remove main')
    expect(remove.disabled).toBe(true)
    expect(remove.title).toBe('A repo keeps at least one base branch')
    for (let i = 1; i < MAX_BRANCHES; i++) e.click('branch-add')
    expect(e.rows()).toHaveLength(MAX_BRANCHES)
    expect(e.add().disabled).toBe(true)
    // Past five branches, every color is taken: a new one starts green.
    expect(e.colors().slice(4, 6)).toEqual(['Blue', 'Green'])
    // Removing the last row puts focus on the one now last.
    const last = /** @type {HTMLButtonElement} */ (
      e.rows().at(-1)?.querySelector('[aria-label="Remove this branch"]')
    )
    last.click()
    expect(e.rows()).toHaveLength(MAX_BRANCHES - 1)
    expect(e.add().disabled).toBe(false)
    expect(document.activeElement).toBe(e.nameInput(MAX_BRANCHES - 2))
  })

  it('says why a list is not saved, or why a save or load failed, and closes on Cancel or ×', async () => {
    const e = await open()
    e.type(1, 'main')
    e.click('branches-save')
    expect(e.error().hidden).toBe(false)
    expect(e.error().textContent).toBe('Not saved: "main" is listed twice.')
    expect(requests).toHaveLength(1)
    e.type(1, 'develop')
    respond = () => Response.json({ error: { code: 'X', message: 'disk full' } }, { status: 500 })
    e.click('branches-save')
    await flush()
    expect(e.error().textContent).toBe('Not saved: disk full')
    expect(e.dialog.open).toBe(true)
    e.click('branches-cancel')
    expect(e.dialog.open).toBe(false)

    respond = () => Response.json({ error: { code: 'X', message: 'down' } }, { status: 500 })
    e.click('branches-open')
    await flush()
    expect(e.error().textContent).toBe('Could not load the branches: down')
    expect(e.rows()).toHaveLength(0)
    expect(e.dialog.open).toBe(true)
    // Nothing to save: the note says so.
    e.click('branches-save')
    expect(e.error().textContent).toBe('Not saved: Keep at least one base branch.')
    e.click('branches-close')
    expect(e.dialog.open).toBe(false)
  })

  it('shows a failure that is not an Error, on load and on save', async () => {
    const garbled = () => /** @type {Response} */ (
      /** @type {unknown} */ ({
        json: async () => null,
        get ok() {
          throw 'connection reset'
        },
      })
    )
    respond = garbled
    const e = await open()
    expect(e.error().textContent).toBe('Could not load the branches: connection reset')
    e.click('branch-add')
    e.type(0, 'main')
    e.click('branches-save')
    await flush()
    expect(e.error().textContent).toBe('Not saved: connection reset')
  })

  it('opens and closes without showModal and close too', async () => {
    const show = HTMLDialogElement.prototype.showModal
    const close = HTMLDialogElement.prototype.close
    // @ts-expect-error: a browser without modal dialogs.
    HTMLDialogElement.prototype.showModal = undefined
    // @ts-expect-error: and without close.
    HTMLDialogElement.prototype.close = undefined
    try {
      const e = await open()
      expect(e.dialog.hasAttribute('open')).toBe(true)
      e.click('branches-cancel')
      expect(e.dialog.hasAttribute('open')).toBe(false)
    } finally {
      HTMLDialogElement.prototype.showModal = show
      HTMLDialogElement.prototype.close = close
    }
  })

  it('does nothing on a page without the dialog or any of its parts', () => {
    document.body.innerHTML = '<main></main>'
    expect(wireBranchesEditor(document)).toBeUndefined()
    document.body.innerHTML = '<dialog id="branches-dialog"><ul id="branch-rows"></ul></dialog>'
    expect(wireBranchesEditor(document)).toBeUndefined()
  })
})
