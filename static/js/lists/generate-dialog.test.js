// @ts-check
// @vitest-environment happy-dom
// Generate and Regenerate on the tables open the review page's generate dialog for one PR, made
// once per PR, from what `lists-generate/<n>/dialog` answers; the job it starts is polled under the
// project's base until it ends.
import { setApiBase } from '../api.js'
import { GENERATE_DIALOG_ID, GENERATION_POLL_MS } from '../generate.js'
import { resetLeaving } from './api.js'
import { openGenerateDialog, resetGenerateDialogs } from './generate-dialog.js'

const BASE = '/r/acme/widgets/'

/** What the lists route answers for the dialog: the start screen's facts, without the PR's diff. */
const DIALOG = {
  local: false,
  status: 'missing',
  skillCommand: '/pr-review-canvas 3',
  chat: { enabled: true, acpx: true, agent: 'claude', model: null },
  canvasComment: true,
}

/** A job of PR 3 in `phase`. @param {string} phase */
const job = phase => ({
  key: 3,
  force: false,
  agent: 'claude',
  model: 'opus',
  skill: { source: 'default', version: '1.4.0' },
  phase,
  round: 1,
  maxRounds: 4,
  startedAt: '2026-10-30T12:00:00.000Z',
  activity: [],
  ...(phase === 'done' ? { endedAt: '2026-10-30T12:04:00.000Z', sharing: { status: 'local' } } : {}),
})

/** @type {{ method: string, url: string }[]} */
let calls
/** The job each GET of the job answers, in turn; the last one repeats. @type {unknown[]} */
let polls

beforeEach(() => {
  calls = []
  polls = [null]
  resetLeaving()
  // A new body each time: the dialog sides of earlier tests listen on the old one.
  document.documentElement.replaceChild(document.createElement('body'), document.body)
  const main = document.createElement('main')
  main.dataset['base'] = BASE
  main.dataset['page'] = 'pulls'
  document.body.append(main)
  let polled = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
      const method = init?.method ?? 'GET'
      calls.push({ method, url })
      if (url === `${BASE}api/lists-generate/3/dialog` || url === `${BASE}api/lists-generate/4/dialog`) {
        return Response.json({ ...DIALOG, skillCommand: `/pr-review-canvas ${url.split('/').at(-2)}` })
      }
      if (url === `${BASE}api/lists-generate/9/dialog`) {
        return Response.json(
          { error: { code: 'NOT_FOUND', message: '#9 is not in the lists' } },
          { status: 404 }
        )
      }
      if (url === `${BASE}api/generate/skill`)
        return Response.json({ skill: { source: 'default', version: '1.4.0' } })
      if (url === `${BASE}api/prs/3/generate` && method === 'POST') {
        return Response.json({ job: job('preparing') }, { status: 202 })
      }
      if (url === `${BASE}api/prs/3/generate`) {
        const next = polls[Math.min(polled, polls.length - 1)]
        polled += 1
        return Response.json({ job: next })
      }
      return Response.json({ error: { code: 'NOT_FOUND', message: 'unexpected' } }, { status: 404 })
    })
  )
})

afterEach(() => {
  resetGenerateDialogs()
  setApiBase('/')
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** Lets the fetches under fake timers answer. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0)
}

const dialog = () => document.getElementById(GENERATE_DIALOG_ID)

describe('openGenerateDialog', () => {
  it('opens the start screen from the lists route, reading the skill under the project base', async () => {
    await openGenerateDialog(document, 3, () => undefined)
    expect(dialog()?.hasAttribute('open')).toBe(true)
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Generate the canvas')
    await flush()
    expect(calls).toEqual([
      { method: 'GET', url: `${BASE}api/lists-generate/3/dialog` },
      { method: 'GET', url: `${BASE}api/generate/skill` },
    ])
    // The dialog sits in a box of its PR's own, in the page's body beside the table's main.
    expect(dialog()?.parentElement?.dataset['generateFor']).toBe('3')
    expect(dialog()?.parentElement?.parentElement).toBe(document.body)
  })

  it('makes one dialog side per PR, and the same one again on a later opening', async () => {
    await openGenerateDialog(document, 3, () => undefined)
    await openGenerateDialog(document, 3, () => undefined)
    await openGenerateDialog(document, 4, () => undefined)
    await flush()
    // One dialog per PR, each in its own box: a later opening of #3 reuses #3's.
    expect(
      [...document.querySelectorAll('[data-generate-for]')].map(b => b.getAttribute('data-generate-for'))
    ).toEqual(['3', '4'])
    expect(calls.filter(c => c.url.endsWith('/dialog')).map(c => c.url)).toEqual([
      `${BASE}api/lists-generate/3/dialog`,
      `${BASE}api/lists-generate/3/dialog`,
      `${BASE}api/lists-generate/4/dialog`,
    ])
  })

  it('starts the job from the dialog, tells the table at once, polls it, and tells it again once it ends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    polls = [job('generating'), job('done')]
    const ended = vi.fn()
    const started = vi.fn()
    await openGenerateDialog(document, 3, ended, started)
    document
      .querySelector(`#${GENERATE_DIALOG_ID} [data-gen="start"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(calls).toContainEqual({ method: 'POST', url: `${BASE}api/prs/3/generate` })
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Preparing the diff')
    // The row shows the job without waiting for a poll.
    expect(started).toHaveBeenCalledTimes(1)
    expect(ended).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(GENERATION_POLL_MS)
    await settle()
    expect(started).toHaveBeenCalledTimes(1)
    expect(ended).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(GENERATION_POLL_MS)
    await settle()
    expect(ended).toHaveBeenCalledTimes(1)
    expect(calls.filter(c => c.url === `${BASE}api/prs/3/generate` && c.method === 'GET')).toHaveLength(2)
    // An ended job polls no more.
    await vi.advanceTimersByTimeAsync(GENERATION_POLL_MS * 3)
    expect(calls.filter(c => c.url === `${BASE}api/prs/3/generate` && c.method === 'GET')).toHaveLength(2)
  })

  it('stops polling the dialogs it made once reset', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    polls = [job('generating')]
    const ended = vi.fn()
    await openGenerateDialog(document, 3, ended)
    document
      .querySelector(`#${GENERATE_DIALOG_ID} [data-gen="start"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await settle()
    expect(calls).toContainEqual({ method: 'POST', url: `${BASE}api/prs/3/generate` })
    resetGenerateDialogs()
    await vi.advanceTimersByTimeAsync(GENERATION_POLL_MS * 3)
    expect(calls.filter(c => c.url === `${BASE}api/prs/3/generate` && c.method === 'GET')).toHaveLength(0)
    expect(ended).not.toHaveBeenCalled()
  })

  // Each PR's dialog side listens on its own box, so Start in #3's dialog starts #3 alone.
  it('starts only the PR its dialog shows, though another PR’s dialog was opened before', async () => {
    await openGenerateDialog(document, 4, () => undefined)
    await openGenerateDialog(document, 3, () => undefined)
    document
      .querySelector(`[data-generate-for="3"] [data-gen="start"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flush()
    expect(calls.filter(c => c.method === 'POST').map(c => c.url)).toEqual([`${BASE}api/prs/3/generate`])
  })

  it('rejects with the server’s reason when the PR is not in the lists', async () => {
    await expect(openGenerateDialog(document, 9, () => undefined)).rejects.toThrow('#9 is not in the lists')
    expect(dialog()?.hasAttribute('open') ?? false).toBe(false)
  })
})
