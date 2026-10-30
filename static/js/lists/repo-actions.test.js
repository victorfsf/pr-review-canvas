// @ts-check
// @vitest-environment happy-dom
import { rowSyncButton, wireSyncNow } from './repo-actions.js'

/** @type {(url: string, init: RequestInit | undefined) => Response | Promise<Response>} */
let respond
/** @type {{ url: string, method: string | undefined }[]} */
let asked

/** A reply whose status cannot be read, so the call fails with something that is not an Error. */
const garbled = () => /** @type {Response} */ (
  /** @type {unknown} */ ({
    json: async () => null,
    get ok() {
      throw 'connection reset'
    },
  })
)

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  asked = []
  respond = () => Response.json({ state: { fetchedAt: null, error: null } })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
      asked.push({ url, method: init?.method })
      return respond(url, init)
    })
  )
})

afterEach(() => vi.unstubAllGlobals())

/** @param {string} page */
const render = page => {
  document.body.innerHTML = `<main data-page="${page}" data-base="/r/acme/widgets/"><button id="sync-now"></button></main>`
  wireSyncNow(document)
  return /** @type {HTMLButtonElement} */ (document.getElementById('sync-now'))
}

describe('Sync now', () => {
  it("syncs the queue on the queue's page, and the pulls on any other, then says how it went", async () => {
    const synced = vi.fn()
    let button = render('queue')
    document.querySelector('main')?.addEventListener('pr-greenlight:synced', synced)
    button.click()
    // While it runs, the button spins and takes no second click.
    expect(button.disabled).toBe(true)
    expect(button.classList.contains('syncing')).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Syncing…')
    await flush()
    expect(asked).toEqual([{ url: '/r/acme/widgets/api/lists/queue/sync', method: 'POST' }])
    expect(button.title).toBe('Sync now · Not synced yet')
    expect(button.disabled).toBe(false)
    expect(button.classList.contains('syncing')).toBe(false)
    expect(button.getAttribute('aria-label')).toBe('Sync now')
    expect(synced).toHaveBeenCalledTimes(1)

    respond = () => Response.json({ state: { fetchedAt: null, error: 'rate limited' } })
    button = render('pulls')
    button.click()
    await flush()
    expect(asked.at(-1)?.url).toBe('/r/acme/widgets/api/lists/pulls/sync')
    expect(button.title).toBe('Sync now · Last sync failed: rate limited')
  })

  it('shows a failure in its tooltip, an Error or not, and still lets the table reload', async () => {
    const button = render('pulls')
    const synced = vi.fn()
    document.querySelector('main')?.addEventListener('pr-greenlight:synced', synced)
    respond = () => Response.json({ error: { code: 'INTERNAL', message: 'forge down' } }, { status: 500 })
    button.click()
    await flush()
    expect(button.title).toBe('Sync now · forge down')
    respond = garbled
    button.click()
    await flush()
    expect(button.title).toBe('Sync now · connection reset')
    expect(synced).toHaveBeenCalledTimes(2)
  })

  it('wires nothing without its button or a page to name the list', () => {
    document.body.innerHTML = '<main><button id="sync-now"></button></main>'
    wireSyncNow(document)
    document.getElementById('sync-now')?.click()
    document.body.innerHTML = '<main data-page="pulls"><span id="sync-now"></span></main>'
    wireSyncNow(document)
    document.getElementById('sync-now')?.click()
    expect(asked).toEqual([])
  })
})

describe('a row’s sync button', () => {
  /** @param {string} html what the body holds before the button joins it */
  const row = (html = '<main data-page="queue" data-base="/r/acme/widgets/"></main>') => {
    document.body.innerHTML = html
    const button = rowSyncButton(document, 'queue', 42)
    ;(document.querySelector('main') ?? document.body).append(button)
    return button
  }

  it('is a small refresh icon named for its PR', () => {
    const button = row()
    expect(button.type).toBe('button')
    expect(button.className).toBe('icon-button small-icon-button row-sync')
    expect(button.title).toBe('Sync #42')
    expect(button.getAttribute('aria-label')).toBe('Sync #42')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('reads just its PR, spinning meanwhile, then has the table load again', async () => {
    const button = row()
    const synced = vi.fn()
    document.querySelector('main')?.addEventListener('pr-greenlight:synced', synced)
    button.click()
    expect(button.disabled).toBe(true)
    expect(button.classList.contains('syncing')).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Syncing #42…')
    await flush()
    expect(asked).toEqual([{ url: '/r/acme/widgets/api/lists/queue/42/sync', method: 'POST' }])
    expect(button.disabled).toBe(false)
    expect(button.classList.contains('syncing')).toBe(false)
    expect(button.title).toBe('Sync #42')
    expect(button.getAttribute('aria-label')).toBe('Sync #42')
    expect(synced).toHaveBeenCalledTimes(1)
  })

  it('shows a failure, an Error or not, until a try succeeds, and reloads nothing meanwhile', async () => {
    const button = row()
    const synced = vi.fn()
    document.querySelector('main')?.addEventListener('pr-greenlight:synced', synced)
    respond = () => Response.json({ error: { code: 'INTERNAL', message: 'forge down' } }, { status: 500 })
    button.click()
    await flush()
    expect(button.classList.contains('bad')).toBe(true)
    expect(button.title).toBe('Sync #42 · failed: forge down')
    expect(button.getAttribute('aria-label')).toBe('Sync #42 · failed: forge down')
    expect(button.disabled).toBe(false)
    expect(button.classList.contains('syncing')).toBe(false)

    respond = garbled
    button.click()
    // A new try clears the last failure while it runs.
    expect(button.classList.contains('bad')).toBe(false)
    await flush()
    expect(button.title).toBe('Sync #42 · failed: connection reset')
    expect(synced).not.toHaveBeenCalled()

    respond = () => Response.json({ rows: [] })
    button.click()
    await flush()
    expect(button.classList.contains('bad')).toBe(false)
    expect(button.title).toBe('Sync #42')
    expect(synced).toHaveBeenCalledTimes(1)
  })

  it('syncs with no page to tell', async () => {
    const button = row('<div></div>')
    button.click()
    await flush()
    expect(asked).toEqual([{ url: '/api/lists/queue/42/sync', method: 'POST' }])
    expect(button.title).toBe('Sync #42')
  })
})
