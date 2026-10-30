// @ts-check
// @vitest-environment happy-dom
import { resetLeaving } from './api.js'
import { canvasAction, canvasCell, generating, pointsCell } from './canvas-cell.js'
import { openGenerateDialog } from './generate-dialog.js'

// The dialog has its own tests; here it only has to be asked to open.
vi.mock('./generate-dialog.js', () => ({ openGenerateDialog: vi.fn(async () => undefined) }))

/** @type {{ url: string, method: string | undefined, body: unknown }[]} */
let requests
/** @type {(url: string, init?: RequestInit) => Response | Promise<Response>} */
let respond
/** How many times the page was told to load its table again. @type {number} */
let reloads = 0

beforeEach(() => {
  requests = []
  reloads = 0
  resetLeaving()
  vi.mocked(openGenerateDialog).mockClear()
  respond = () => Response.json({ ok: true })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
      requests.push({
        url,
        method: init?.method,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      })
      return respond(url, init)
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * The page's main, naming the project; `agent` says an agent can run here.
 * @param {{ agent?: boolean, named?: boolean }} [o]
 */
function page({ agent = true, named = true } = {}) {
  document.body.replaceChildren()
  const main = document.createElement('main')
  main.dataset['base'] = '/r/acme/widgets/'
  main.dataset['agent'] = agent ? 'true' : 'false'
  if (named) main.dataset['page'] = 'pulls'
  main.addEventListener('pr-greenlight:synced', () => reloads++)
  document.body.append(main)
  return main
}

/** What a badge shows: its class, words and title. @param {HTMLElement} badge */
const shows = badge => [badge.className, badge.textContent?.trim(), badge.getAttribute('title')]

describe('canvasCell', () => {
  it('says the canvas status in one badge, with nothing to act on', () => {
    page()
    expect(shows(canvasCell(document, { number: 1, canvas: 'Ready' }))).toEqual([
      'badge ok canvas-state',
      'Ready',
      'A canvas stands for its head commit',
    ])
    expect(shows(canvasCell(document, { number: 2, canvas: 'Stale' }))).toEqual([
      'badge warn canvas-state',
      'Stale',
      'Its canvas is for other commits than its head',
    ])
    const pending = canvasCell(document, { number: 3, canvas: 'Pending' })
    expect(shows(pending)).toEqual(['badge muted canvas-state', 'Pending', 'No canvas yet'])
    expect(pending.children).toHaveLength(0)
    // No status reads as Pending; so does one the cell does not know, such as the old Outdated.
    expect(shows(canvasCell(document, { number: 4 }))).toEqual([
      'badge muted canvas-state',
      'Pending',
      'No canvas yet',
    ])
    expect(shows(canvasCell(document, { number: 5, canvas: 'Outdated' }))).toEqual([
      'badge muted canvas-state',
      'Pending',
      'No canvas yet',
    ])
  })

  it('shows a running generation as Generating, with its phase and start in the tooltip', () => {
    page()
    const startedAt = '2026-10-30T12:00:00Z'
    const since = new Date(startedAt).toLocaleTimeString()
    const cell = canvasCell(document, {
      number: 4,
      canvas: 'Stale',
      generation: { state: 'running', phase: 'checkout', startedAt },
    })
    expect(shows(cell)).toEqual([
      'badge acc canvas-state canvas-running',
      'Generating',
      `Checking out the head, since ${since}`,
    ])
    expect(cell.querySelector('svg')).not.toBeNull()
    // A phase the cell does not name reads as Generating.
    const other = canvasCell(document, {
      number: 4,
      generation: { state: 'running', phase: 'thinking', startedAt },
    })
    expect(other.title).toBe(`Generating, since ${since}`)
  })

  it('names every phase in a few words', () => {
    page()
    const words = ['preparing', 'checkout', 'generating', 'publishing', 'repairing'].map(
      phase =>
        canvasCell(document, {
          number: 1,
          generation: { state: 'running', phase, startedAt: '2026-10-30T12:00:00Z' },
        }).title.split(', since')[0]
    )
    expect(words).toEqual([
      'Preparing the diff',
      'Checking out the head',
      'The agent is writing the canvas',
      'Publishing',
      'Fixing what publish rejected',
    ])
  })

  it('turns the badge bad after a failed generation, saying why beside what its status means', () => {
    page()
    const failed = /** @type {const} */ ({ state: 'failed', message: 'the agent stopped', endedAt: null })
    expect(shows(canvasCell(document, { number: 5, canvas: 'Stale', generation: failed }))).toEqual([
      'badge bad canvas-state',
      'Stale',
      'Its canvas is for other commits than its head. The last generation failed: the agent stopped',
    ])
    expect(shows(canvasCell(document, { number: 6, generation: failed }))).toEqual([
      'badge bad canvas-state',
      'Pending',
      'No canvas yet. The last generation failed: the agent stopped',
    ])
    expect(shows(canvasCell(document, { number: 7, canvas: 'Ready', generation: failed }))[0]).toBe(
      'badge bad canvas-state'
    )
  })
})

describe('pointsCell', () => {
  it('shows a dash while there is no canvas to count', () => {
    expect(shows(pointsCell(document, undefined))).toEqual([
      'muted points-cell',
      '—',
      'No canvas to count its attention points',
    ])
  })

  it('splits the open points between the author and the reviewer, each muted at none', () => {
    const pill = pointsCell(document, { author: 2, reviewer: 0 })
    expect(pill.className).toBe('badge pending-pill points-cell')
    expect([...pill.children].map(c => [c.className, c.textContent, c.getAttribute('title')])).toEqual([
      ['pending-count', '2', '2 for the author'],
      ['pending-divider', '', null],
      ['pending-count muted', '0', '0 for the reviewer'],
    ])
    expect(pill.querySelector('.pending-divider')?.getAttribute('aria-hidden')).toBe('true')
    const other = pointsCell(document, { author: 0, reviewer: 3 })
    expect([...other.querySelectorAll('.pending-count')].map(c => [c.className, c.textContent])).toEqual([
      ['pending-count muted', '0'],
      ['pending-count', '3'],
    ])
  })
})

describe('canvasAction', () => {
  /** What an action shows: its tag, class, words, title, link and label. @param {HTMLElement} a */
  const looks = a => [
    a.tagName,
    a.className,
    a.textContent?.trim(),
    a.getAttribute('title'),
    a.getAttribute('href'),
    a.getAttribute('aria-label'),
  ]
  /** How Open looks for PR `n` under `base`. */
  const open = (/** @type {number} */ n, base = '/r/acme/widgets/') => [
    'A',
    'button small-button canvas-action',
    'Open',
    `Open #${n} in the canvas, in a new tab`,
    `${base}review/${n}`,
    null,
  ]
  const failed = /** @type {const} */ ({ state: 'failed', message: 'the agent stopped', endedAt: null })
  const RUNNING = /** @type {const} */ ({
    state: 'running',
    phase: 'generating',
    startedAt: '2026-10-30T12:00:00Z',
  })

  it('offers Generate for a PR with no canvas, and Regenerate for a stale one', () => {
    page()
    const generate = canvasAction(document, { number: 3, canvas: 'Pending' })
    expect(looks(generate)).toEqual([
      'BUTTON',
      'button small-button canvas-action',
      'Generate',
      'Generate its canvas',
      null,
      'Generate its canvas: #3',
    ])
    expect(generate.querySelector('svg')).not.toBeNull()
    // No status reads as none.
    expect(canvasAction(document, { number: 4 }).textContent?.trim()).toBe('Generate')
    const regenerate = canvasAction(document, { number: 5, canvas: 'Stale' })
    expect(looks(regenerate)).toEqual([
      'BUTTON',
      'button small-button canvas-action',
      'Regenerate',
      'Generate a canvas for its head commit',
      null,
      'Generate a canvas for its head commit: #5',
    ])
    expect(regenerate.querySelector('svg')).not.toBeNull()
  })

  it('opens a ready canvas in a new tab, even after a failed regeneration', () => {
    page()
    const ready = canvasAction(document, { number: 1, canvas: 'Ready' })
    expect(looks(ready)).toEqual(open(1))
    // The canvas's mark goes before its word.
    expect(ready.firstElementChild?.tagName.toLowerCase()).toBe('svg')
    expect([ready.getAttribute('target'), ready.getAttribute('rel')]).toEqual([
      '_blank',
      'noopener noreferrer',
    ])
    expect(looks(canvasAction(document, { number: 1, canvas: 'Ready', generation: failed }))).toEqual(open(1))
  })

  it('offers Generate or Regenerate again after a failure, as the retry', () => {
    page()
    const pending = canvasAction(document, { number: 1, canvas: 'Pending', generation: failed })
    expect(pending.textContent?.trim()).toBe('Generate')
    const stale = canvasAction(document, { number: 2, canvas: 'Stale', generation: failed })
    expect(stale.textContent?.trim()).toBe('Regenerate')
  })

  it('only opens where no agent can run, or on a page with no main', () => {
    page({ agent: false })
    expect(looks(canvasAction(document, { number: 3, canvas: 'Pending' }))).toEqual(open(3))
    expect(looks(canvasAction(document, { number: 4, canvas: 'Stale', generation: failed }))).toEqual(open(4))
    document.body.replaceChildren()
    expect(looks(canvasAction(document, { number: 5, canvas: 'Pending' }))).toEqual(open(5, '/'))
  })

  it('stops a running generation, then loads the table again', async () => {
    const main = page()
    const stop = /** @type {HTMLButtonElement} */ (
      canvasAction(document, { number: 3, canvas: 'Pending', generation: RUNNING })
    )
    main.append(stop)
    expect(looks(stop)).toEqual([
      'BUTTON',
      'button small-button canvas-action',
      'Stop',
      'Stop the generation',
      null,
      'Stop the generation: #3',
    ])
    expect(stop.querySelector('svg')).not.toBeNull()
    stop.click()
    expect(stop.disabled).toBe(true)
    await flush()
    expect(requests).toEqual([
      { url: '/r/acme/widgets/api/lists-generate/3', method: 'DELETE', body: undefined },
    ])
    expect(reloads).toBe(1)
    expect(openGenerateDialog).not.toHaveBeenCalled()
  })

  it('loads the table again even when Stop fails, and Stop wins over a ready canvas', async () => {
    page()
    const stop = /** @type {HTMLButtonElement} */ (
      canvasAction(document, { number: 4, canvas: 'Ready', generation: RUNNING })
    )
    expect([stop.textContent?.trim(), stop.title]).toEqual(['Stop', 'Stop the generation'])
    respond = () => Response.json({ error: { message: 'gone' } }, { status: 404 })
    stop.click()
    await flush()
    expect(requests.map(r => [r.url, r.method])).toEqual([['/r/acme/widgets/api/lists-generate/4', 'DELETE']])
    expect(reloads).toBe(1)
  })

  it('stops even where no agent can run, and tells no page to load again where the main names none', async () => {
    page({ agent: false, named: false })
    const stop = /** @type {HTMLButtonElement} */ (canvasAction(document, { number: 3, generation: RUNNING }))
    expect(stop.textContent?.trim()).toBe('Stop')
    stop.click()
    await flush()
    expect(requests).toHaveLength(1)
    expect(reloads).toBe(0)
  })

  it('opens the generate dialog on Generate, whose end loads the table again', async () => {
    page()
    const go = /** @type {HTMLButtonElement} */ (canvasAction(document, { number: 3, canvas: 'Pending' }))
    go.click()
    await flush()
    expect(openGenerateDialog).toHaveBeenCalledTimes(1)
    const [doc, number, ended] = vi.mocked(openGenerateDialog).mock.calls[0] ?? []
    expect([doc, number]).toEqual([document, 3])
    // The table asks nothing of the server itself; the dialog starts the job.
    expect(requests).toEqual([])
    expect(reloads).toBe(0)
    ended?.()
    expect(reloads).toBe(1)
    expect(go.classList.contains('bad')).toBe(false)
  })

  it('opens the dialog for a stale PR on Regenerate the same way', async () => {
    page()
    const go = /** @type {HTMLButtonElement} */ (canvasAction(document, { number: 6, canvas: 'Stale' }))
    go.click()
    await flush()
    expect(vi.mocked(openGenerateDialog).mock.calls.map(c => c[1])).toEqual([6])
  })

  it('says why the dialog could not open in the button', async () => {
    page()
    vi.mocked(openGenerateDialog).mockRejectedValueOnce(new Error('no such PR in the lists'))
    const go = /** @type {HTMLButtonElement} */ (canvasAction(document, { number: 3, canvas: 'Pending' }))
    go.click()
    await flush()
    expect(go.title).toBe('Could not open the dialog: no such PR in the lists')
    expect(go.classList.contains('bad')).toBe(true)
    expect(reloads).toBe(0)
  })

  it('says a refusal that is no Error as it is', async () => {
    page()
    vi.mocked(openGenerateDialog).mockRejectedValueOnce('odd failure')
    const go = /** @type {HTMLButtonElement} */ (canvasAction(document, { number: 3, canvas: 'Pending' }))
    go.click()
    await flush()
    expect(go.title).toBe('Could not open the dialog: odd failure')
  })
})

describe('generating', () => {
  it('counts a running generation as under way, and a failed one or none as not', () => {
    expect(generating({ generation: { state: 'running', phase: 'checkout', startedAt: '' } })).toBe(true)
    expect(generating({ generation: { state: 'failed', message: 'x', endedAt: null } })).toBe(false)
    expect(generating({})).toBe(false)
  })
})
