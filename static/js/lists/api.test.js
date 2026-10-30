// @ts-check
// @vitest-environment happy-dom
import { api, projectBase, resetLeaving } from './api.js'

afterEach(() => {
  vi.unstubAllGlobals()
  resetLeaving()
})

const settled = async (/** @type {Promise<unknown>} */ call) => {
  let done = false
  call.then(
    () => (done = true),
    () => (done = true)
  )
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
  return done
}

describe('an API call', () => {
  it('says the server did not answer, or that its answer was cut off', async () => {
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(api('x')).rejects.toThrow('the review server did not answer')
    vi.stubGlobal('fetch', async () => new Response('{"half', { status: 200 }))
    await expect(api('x')).rejects.toThrow('the answer from the review server was cut off')
  })

  it('shows no failure once the page has started to leave, as Run here does', async () => {
    window.dispatchEvent(new Event('beforeunload'))
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')))
    expect(await settled(api('x'))).toBe(false)
    vi.stubGlobal('fetch', async () => new Response('{"half', { status: 200 }))
    expect(await settled(api('x'))).toBe(false)
    // A refusal the server sent is still one.
    vi.stubGlobal('fetch', async () =>
      Response.json({ error: { code: 'BAD_REQUEST', message: 'no' } }, { status: 400 })
    )
    await expect(api('x')).rejects.toThrow('no')
    // Back from the cache, the page fails out loud again.
    window.dispatchEvent(new Event('pageshow'))
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')))
    await expect(api('x')).rejects.toThrow('the review server did not answer')
  })
})

describe('projectBase', () => {
  afterEach(() => document.body.replaceChildren())

  it("is the base the page's main names, the root without one, and where calls go", async () => {
    document.body.innerHTML = '<main></main>'
    expect(projectBase()).toBe('/')
    document.body.innerHTML = '<main data-base="/r/acme/widgets/"></main>'
    expect(projectBase()).toBe('/r/acme/widgets/')
    /** @type {string[]} */
    const asked = []
    vi.stubGlobal('fetch', async (/** @type {string} */ url) => {
      asked.push(url)
      return Response.json({ ok: true })
    })
    await api('lists-sections')
    expect(asked).toEqual(['/r/acme/widgets/api/lists-sections'])
  })
})

describe('projectBase outside a page', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is the root where there is no document', () => {
    vi.stubGlobal('document', undefined)
    expect(projectBase()).toBe('/')
  })
})
