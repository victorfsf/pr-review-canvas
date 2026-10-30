// @ts-check
// @vitest-environment happy-dom
import { listsMain, projectTabs } from '../../../src/server/lists-html.ts'
import { makeReviewer } from '../../../src/lists/testing.ts'
import { resetLeaving } from './api.js'
import { RELOAD_EVERY_MS, SYNCING_RELOAD_MS } from './dom.js'
import { flushSavedFilters, resetSavedFilters } from './filters.js'
import { resetGenerateDialogs } from './generate-dialog.js'
import { SEARCH_DELAY_MS } from './search.js'
import { wirePullsPage } from './pulls-page.js'

/** The project's base path, as the server names it in `main`. */
const BASE = '/r/acme/widgets/'

/** A health with no checks and no conflict: nothing to show in Status. */
const NO_CHECKS = { ci: /** @type {const} */ ('none'), failing: 0, stuck: null, conflict: false }

/**
 * A row as `GET <base>api/lists/pulls` sends it: the PR, then what its cells show.
 * @typedef {import('./pulls.js').Pull & { health: import('./health.js').Health,
 *   canvas: 'Ready' | 'Stale' | 'Pending', pending: number, waiting: number,
 *   points?: { author: number, reviewer: number },
 *   stack?: { name: string, position: number, total: number, base?: string },
 *   generation?: import('./canvas-cell.js').RowGeneration }} Row
 */

/** @param {Partial<Row>} o @returns {Row} */
const pull = o => ({
  number: 1,
  title: 'Synthetic change',
  url: 'https://github.com/acme/widgets/pull/1',
  isDraft: false,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  headRefName: 'feature',
  baseRefName: 'develop',
  reviewDecision: /** @type {const} */ ('APPROVED'),
  author: 'me',
  /** @type {import('./reviewers.js').Reviewer[]} */
  reviewers: [],
  health: NO_CHECKS,
  canvas: 'Pending',
  pending: 0,
  waiting: 0,
  ...o,
})

/**
 * A reviewer by login, the rest of it as `o` says.
 * @param {string} login
 * @param {Parameters<typeof makeReviewer>[0]} [o]
 */
const reviewer = (login, o = {}) => makeReviewer({ ...o, login })

/**
 * Puts the page's markup in the document, as the server renders Your PRs.
 * @param {{ canGenerate?: boolean | undefined, savedFilters?: Record<string, unknown> | undefined }} [o]
 */
async function mount(o = {}) {
  // Each page reads the filters it arrived with once.
  resetSavedFilters()
  const markup = String(
    await listsMain({
      tab: 'pulls',
      owner: 'acme',
      repo: 'widgets',
      base: BASE,
      forge: 'GitHub',
      nounShort: 'PR',
      canGenerate: o.canGenerate === true,
      savedFilters: o.savedFilters ?? {},
    })
  )
  // The page shell's tab bar holds the tabs' counts.
  const tabs = String(await projectTabs({ base: BASE, nounShort: 'PR', tab: 'pulls' }))
  document.body.innerHTML = tabs + markup
}

/** @type {{ url: string, init: RequestInit | undefined }[]} */
let requests
/** @type {(url: string, init?: RequestInit) => Response | Promise<Response>} */
let respond
/** @type {Map<string, string>} */
let store

beforeEach(() => {
  requests = []
  store = new Map()
  resetLeaving()
  history.replaceState(null, '', BASE)
  respond = () => Response.json({})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit | undefined} */ init) => {
      requests.push({ url, init })
      return respond(url, init)
    })
  )
  vi.stubGlobal('localStorage', {
    getItem: (/** @type {string} */ k) => store.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => store.set(k, v),
    removeItem: (/** @type {string} */ k) => store.delete(k),
  })
})

afterEach(() => {
  // A filter save waits a second. Send it while fetch is still the stub, so it cannot land in the
  // next test or on the real network.
  flushSavedFilters()
  resetGenerateDialogs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * Ticks State to `state` as a person would: the boxes to tick first, then those to untick, since
 * the only box ticked cannot be unticked.
 * @param {'open' | 'draft' | 'queued' | 'both'} state
 */
const pickState = state => {
  const boxes = /** @type {HTMLInputElement[]} */ ([...document.querySelectorAll('input[data-state]')])
  const want = (/** @type {HTMLInputElement} */ box) => state === 'both' || box.dataset['state'] === state
  for (const box of boxes) if (want(box) && !box.checked) box.click()
  for (const box of boxes) if (!want(box) && box.checked) box.click()
}

/** The list's answer, as the server sends it. */
const answer = (
  /** @type {Row[]} */ rows,
  /** @type {{ fetchedAt: string | null, error: string | null, syncing?: boolean }} */ state,
  /** @type {import('./branches.js').MainBranch[] | undefined} */ branches,
  /** @type {Record<string, unknown>} */ extra = {}
) => ({ rows, viewer: 'me', state, sections: undefined, branches, ...extra })

async function loadPulls(
  /** @type {Row[]} */ pulls,
  /** @type {{ fetchedAt: string | null, error: string | null, syncing?: boolean }} */
  state = { fetchedAt: new Date().toISOString(), error: null },
  /** @type {import('./branches.js').MainBranch[]} */
  branches = [{ name: 'develop', color: 'green' }],
  /** @type {{ canGenerate?: boolean, savedFilters?: Record<string, unknown>, sections?: unknown }} */
  extra = {}
) {
  const { canGenerate, savedFilters, ...rest } = extra
  await mount({ canGenerate, savedFilters })
  respond = () => Response.json(answer(pulls, state, branches, rest))
  await wirePullsPage(document)
  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id))
  return {
    rows: () => [...document.querySelectorAll('#pull-table tr.queue-row')],
    titles: () => [...document.querySelectorAll('.pull-title')].map(a => a.textContent),
    pickState,
    /** Whether State has just the states `s` ticked. */
    stateIs: (/** @type {string[]} */ s) =>
      [...document.querySelectorAll('input[data-state]')].every(
        box =>
          /** @type {HTMLInputElement} */ (box).checked === s.includes(box.getAttribute('data-state') ?? '')
      ),
    empty: get('pulls-empty'),
    reset: get('reset-filters'),
    table: get('pull-table'),
    error: get('sync-error'),
    stale: get('sync-stale'),
  }
}

describe('the Pull requests page', () => {
  it('lists the PRs with links, review badges and counts', async () => {
    store.set('pr-greenlight:filters:v1:acme/widgets:pulls', '{"state":"both"}')
    const page = await loadPulls([
      pull({ number: 2, isDraft: true, title: 'Draft one' }),
      pull({ number: 1 }),
    ])
    expect(requests[0]?.url).toBe('/r/acme/widgets/api/lists/pulls')
    expect(page.titles()).toEqual(['Draft one #2', 'Synthetic change #1'])
    // The title opens a menu: the PR's canvas first, then the forge, each in a new tab.
    const title = /** @type {HTMLButtonElement} */ (document.querySelector('button.pull-title'))
    title.click()
    const items = [...(title.parentElement?.querySelectorAll('[role="menuitem"]') ?? [])]
    expect(items.map(i => i.textContent)).toEqual(['Canvas', 'GitHub'])
    const [here, github] = /** @type {HTMLAnchorElement[]} */ (items)
    expect([
      new URL(here?.href ?? '').pathname,
      here?.target,
      here?.querySelector('.menu-out') !== null,
    ]).toEqual(['/r/acme/widgets/review/2', '_blank', true])
    expect([github?.href, github?.target]).toEqual(['https://github.com/acme/widgets/pull/1', '_blank'])
    // Actions opens its canvas; with no agent to run here, there is nothing to generate. Each row
    // can also change who it asks to review it, and be read again on its own.
    expect(
      [...document.querySelectorAll('.row-actions')].map(a =>
        [...a.children].map(
          c =>
            c.querySelector('.review-open')?.getAttribute('aria-label') ??
            (c.textContent?.trim() || c.getAttribute('title'))
        )
      )
    ).toEqual([
      ['Open', 'Reviewers of #2', 'Sync #2'],
      ['Open', 'Reviewers of #1', 'Sync #1'],
    ])
    const open = document.querySelector('.row-actions a')
    expect([open?.getAttribute('href'), open?.getAttribute('target')]).toEqual([
      '/r/acme/widgets/review/2',
      '_blank',
    ])
    // A draft has no pill: its state's mark says so. Review keeps its decision, Canvas its status;
    // with no canvas here, Attention points has no count.
    expect(
      page
        .rows()
        .map(r =>
          [...r.querySelectorAll(':scope > td > .badge, :scope > td > .muted')].map(b => b.textContent)
        )
    ).toEqual([
      ['—', 'Approved', 'Pending'],
      ['—', 'Approved', 'Pending'],
    ])
    // Without an agent, neither column offers Generate.
    expect(document.querySelector('#pull-table button.canvas-action')).toBeNull()
    expect(document.querySelector('.pull-state')?.getAttribute('aria-label')).toBe('Draft')
    expect(document.querySelector('[data-count="open"]')?.textContent).toBe('1')
    expect(document.querySelector('[data-count="draft"]')?.textContent).toBe('1')
    expect(document.getElementById('nav-pull-count')?.textContent).toBe('2')
    expect(document.querySelector('.pull-branch')?.textContent).toBe('develop← from feature · +0 −0')
    // After the size, the title menu's ways out as icons, each named by its tooltip.
    const quick = [...(document.querySelector('.pull-branch .quick-links')?.children ?? [])]
    expect(quick.map(q => q.getAttribute('title'))).toEqual(['Open the canvas', 'Open on GitHub'])
    expect([quick[0]?.getAttribute('href'), quick[0]?.getAttribute('target')]).toEqual([
      '/r/acme/widgets/review/2',
      '_blank',
    ])
    expect([quick[1]?.getAttribute('target'), quick[1]?.getAttribute('aria-label')]).toEqual([
      '_blank',
      'Open on GitHub: #2',
    ])
    expect(document.querySelector('.branch-pill')?.className).toBe('branch-pill pill-green')
    expect(document.querySelector('.branch-arrow')?.getAttribute('aria-hidden')).toBe('true')
    expect(page.empty.hidden).toBe(true)
  })

  it('offers Generate or Regenerate in Actions where an agent can run, and Open otherwise', async () => {
    const { rows: page } = await loadPulls(
      [
        pull({ number: 4, canvas: 'Pending' }),
        pull({ number: 3, canvas: 'Stale' }),
        pull({ number: 2, canvas: 'Ready' }),
        pull({
          number: 1,
          canvas: 'Pending',
          generation: { state: 'running', phase: 'generating', startedAt: '2026-10-30T12:00:00Z' },
        }),
      ],
      undefined,
      undefined,
      { canGenerate: true }
    )
    // The title menu only opens: generating is the Actions column's.
    const title = /** @type {HTMLButtonElement} */ (document.querySelector('button.pull-title'))
    title.click()
    const items = /** @type {HTMLAnchorElement[]} */ ([
      ...(title.parentElement?.querySelectorAll('[role="menuitem"]') ?? []),
    ])
    expect(items.map(i => i.textContent)).toEqual(['Canvas', 'GitHub'])
    // Generate for #4 with none, Regenerate for #3's stale one, Open for #2's ready one, and Stop
    // for #1, whose generation is under way.
    expect(
      [...document.querySelectorAll('.row-actions')].map(a =>
        [...a.children].map(c => [c.tagName, c.textContent?.trim(), c.getAttribute('href')])
      )
    ).toEqual([
      [
        ['BUTTON', 'Generate', null],
        ['SPAN', '', null],
        ['BUTTON', '', null],
      ],
      [
        ['BUTTON', 'Regenerate', null],
        ['SPAN', '', null],
        ['BUTTON', '', null],
      ],
      [
        ['A', 'Open', '/r/acme/widgets/review/2'],
        ['SPAN', '', null],
        ['BUTTON', '', null],
      ],
      [
        ['BUTTON', 'Stop', null],
        ['SPAN', '', null],
        ['BUTTON', '', null],
      ],
    ])
    // The Canvas column only says where each stands, in one badge with nothing to click.
    expect(page().map(r => [...r.querySelectorAll('.canvas-state')].map(c => c.textContent?.trim()))).toEqual(
      [['Pending'], ['Stale'], ['Ready'], ['Generating']]
    )
    expect(document.querySelector('td:not(.queue-actions) .canvas-action')).toBeNull()
  })

  it('shows each PR’s CI and conflict problems as icons in its Status column', async () => {
    await loadPulls([
      pull({ number: 1, health: { ci: 'failing', failing: 2, stuck: 'no checks started', conflict: true } }),
      pull({ number: 2, health: { ci: 'passing', failing: 0, stuck: null, conflict: false } }),
      pull({ number: 3 }),
    ])
    const status = (/** @type {number} */ n) =>
      [...(document.querySelectorAll('#pull-table tbody .health')[n]?.children ?? [])].map(m =>
        m.getAttribute('aria-label')
      )
    expect(status(0)).toEqual([
      'CI failing: 2 checks failed',
      'CI stuck: no checks started',
      'Merge conflict with its base branch',
    ])
    expect(status(1)).toEqual(['Checks passing'])
    // No checks and no conflict: nothing to say.
    expect(status(2)).toEqual([])
    expect(document.querySelector('#pull-table thead')?.textContent).toContain('Status')
    // The Status filter starts with every choice ticked, and keeps a PR with any ticked choice,
    // from any section; the ticked ones go in the address.
    const box = (/** @type {string} */ key) =>
      /** @type {HTMLInputElement} */ (document.querySelector(`input[data-section="github"][value="${key}"]`))
    const set = (/** @type {boolean} */ on, /** @type {string[]} */ ...keys) => {
      for (const key of keys) {
        box(key).checked = on
        box(key).dispatchEvent(new Event('change'))
      }
    }
    const numbers = () => [...document.querySelectorAll('#pull-table .pull-number')].map(n => n.textContent)
    expect(
      [...document.querySelectorAll('input[data-section]')].every(
        b => /** @type {HTMLInputElement} */ (b).checked
      )
    ).toBe(true)
    expect(document.getElementById('integrations-label')?.textContent).toBe('All')
    const help = document.getElementById('filters-help')?.textContent ?? ''
    expect(help).toContain('passes every filter')
    // None unticks every choice, and keeps nothing.
    document.getElementById('integrations-none')?.click()
    expect(numbers()).toEqual([])
    expect(document.getElementById('integrations-label')?.textContent).toBe('None')
    // #1 fails and is stuck: its CI counts as failing, the state it shows first.
    set(true, 'stuck')
    expect(numbers()).toEqual([])
    expect(new URLSearchParams(location.search).getAll('github')).toEqual(['stuck'])
    set(true, 'failing')
    expect(numbers()).toEqual(['#1'])
    set(true, 'passing')
    expect(numbers()).toEqual(['#1', '#2'])
    // Choices of different kinds still add: CI stuck or no conflicts.
    set(false, 'failing', 'passing')
    set(true, 'noConflict')
    expect(numbers()).toEqual(['#2', '#3'])
    set(true, 'conflict')
    expect(numbers()).toEqual(['#1', '#2', '#3'])
    expect(document.getElementById('integrations-label')?.textContent).toBe('3 of 9')
    document.getElementById('integrations-all')?.click()
    expect(numbers()).toHaveLength(3)
    expect(new URLSearchParams(location.search).has('github')).toBe(false)
  })

  it('colors the base pill by the repo branches, gray for any other base', async () => {
    await loadPulls(
      [
        pull({ number: 3, baseRefName: 'hotfix' }),
        pull({ number: 2, baseRefName: 'feature-a' }),
        pull({ number: 1 }),
      ],
      undefined,
      [
        { name: 'develop', color: 'green' },
        { name: 'hotfix', color: 'red' },
      ]
    )
    const pills = (/** @type {string} */ list) =>
      [...document.querySelectorAll(`#${list} .branch-pill`)].map(p => [p.textContent, p.className])
    expect(pills('pull-table')).toEqual([
      ['hotfix', 'branch-pill pill-red'],
      ['develop', 'branch-pill pill-green'],
    ])
    expect(pills('stacked-body')).toEqual([['feature-a', 'branch-pill pill-gray']])
    expect(document.getElementById('stacked-section')?.hidden).toBe(false)
    expect(document.getElementById('stacked-count')?.textContent).toBe('1')
  })

  it('hides the stacked table when no PR is stacked', async () => {
    await loadPulls([pull({})])
    expect(document.getElementById('stacked-section')?.hidden).toBe(true)
  })

  it('says when every PR shown is stacked', async () => {
    const page = await loadPulls([pull({ number: 1, baseRefName: 'main' })], undefined, [
      { name: 'develop', color: 'green' },
      { name: 'hotfix', color: 'red' },
    ])
    expect(page.table.hidden).toBe(true)
    expect(page.empty.textContent).toBe('None of these PRs target develop or hotfix.')
    expect(document.querySelectorAll('#stacked-body tr.queue-row')).toHaveLength(1)
  })

  it('falls back to the default branches when the server sends none', async () => {
    await loadPulls([pull({})])
    const onMain = pull({ baseRefName: 'main' })
    respond = () => Response.json(answer([onMain], { fetchedAt: null, error: null }, undefined))
    document.querySelector('main')?.dispatchEvent(new Event('pr-greenlight:synced'))
    await flush()
    expect(document.querySelector('.branch-pill')?.className).toBe('branch-pill pill-green')
  })

  it('reads one PR again from its row’s sync, then loads the list again', async () => {
    const page = await loadPulls([pull({ number: 1 }), pull({ number: 2, title: 'Other change' })])
    const before = requests.length
    respond = () =>
      Response.json(
        answer(
          [pull({ number: 1, title: 'Renamed' }), pull({ number: 2 })],
          { fetchedAt: null, error: null },
          [{ name: 'develop', color: 'green' }]
        )
      )
    const button = /** @type {HTMLButtonElement} */ (page.rows()[0]?.querySelector('.row-actions .row-sync'))
    expect(button.title).toBe('Sync #1')
    button.click()
    await flush()
    await flush()
    const after = requests.slice(before)
    expect(after[0]).toMatchObject({ url: `${BASE}api/lists/pulls/1/sync`, init: { method: 'POST' } })
    expect(after.slice(1).some(r => r.url === `${BASE}api/lists/pulls` && r.init?.method !== 'POST')).toBe(
      true
    )
    expect(page.titles().some(t => t?.startsWith('Renamed'))).toBe(true)
  })

  it('shows who reviewed each PR', async () => {
    await loadPulls([pull({ reviewers: [reviewer('alice', { approvals: 1, comments: 2 })] })])
    expect(document.querySelector('.reviewers .reviewer-pill')?.getAttribute('aria-label')).toBe(
      'alice: 1 approval, 2 comments'
    )
  })

  it('shows a title only as text', async () => {
    const page = await loadPulls([pull({ title: '<img src=x onerror=alert(1)>' })])
    expect(page.rows()[0]?.querySelector('img')).toBeNull()
    expect(page.titles()[0]).toContain('<img src=x')
  })

  it('shows the Canvas column always, filters by it, and offers no CodeRabbit or Vercel', async () => {
    await loadPulls([pull({ number: 1, canvas: 'Ready' }), pull({ number: 2, canvas: 'Stale' })])
    const row = (/** @type {number} */ n) =>
      /** @type {Element} */ (document.querySelector(`[aria-label="Open #${n}"]`)?.closest('.queue-row'))
    expect(
      [...row(1).querySelectorAll(':scope > td > .badge, .canvas-state')].map(b => b.textContent)
    ).toEqual(['Approved', 'Ready'])
    const head = /** @type {Element} */ (document.querySelector('#pull-table thead'))
    expect(head.textContent).toContain('Canvas ↕')
    expect(head.textContent).not.toContain('CodeRabbit')
    expect(document.querySelector('main')?.classList.contains('no-canvas')).toBe(false)
    // Status has Checks and Canvas only.
    expect([
      ...new Set(
        [...document.querySelectorAll('input[data-section]')].map(b => b.getAttribute('data-section'))
      ),
    ]).toEqual(['github', 'canvas'])
    const box = (/** @type {string} */ value) =>
      /** @type {HTMLInputElement} */ (
        document.querySelector(`input[data-section="canvas"][value="${value}"]`)
      )
    expect(box('Stale').parentElement?.textContent?.trim()).toBe('Stale1')
    document.getElementById('integrations-none')?.click()
    box('Stale').checked = true
    box('Stale').dispatchEvent(new Event('change'))
    expect([...document.querySelectorAll('#pull-table .pull-number')].map(n => n.textContent)).toEqual(['#2'])
    box('Ready').checked = true
    box('Ready').dispatchEvent(new Event('change'))
    expect(document.querySelectorAll('#pull-table tr.queue-row')).toHaveLength(2)
    expect(document.getElementById('integrations-label')?.textContent).toBe('2 of 9')
  })

  it('sorts by stacked columns from the header, keeps the sort through Reset, and clears it', async () => {
    const page = await loadPulls([
      pull({ number: 3, reviewDecision: 'APPROVED', canvas: 'Pending' }),
      pull({ number: 2, reviewDecision: 'CHANGES_REQUESTED' }),
      pull({ number: 1, reviewDecision: 'APPROVED', canvas: 'Ready' }),
    ])
    const numbers = () => [...document.querySelectorAll('#pull-table .pull-number')].map(n => n.textContent)
    const header = (/** @type {string} */ words) =>
      /** @type {HTMLButtonElement} */ (
        [...document.querySelectorAll('#pull-table .sort-button')].find(b => b.textContent?.startsWith(words))
      )
    expect(numbers()).toEqual(['#3', '#2', '#1'])
    header('Review').click()
    expect(numbers()).toEqual(['#2', '#3', '#1'])
    header('Canvas').click()
    expect(numbers()).toEqual(['#2', '#1', '#3'])
    expect([header('Review').textContent, header('Canvas').textContent]).toEqual(['Review ↑1', 'Canvas ↑2'])
    header('Pull request').click()
    header('Pull request').click()
    expect(new URLSearchParams(location.search).getAll('sort')).toEqual(['review', 'canvas', '-pr'])
    // Reset clears filters, not the sort; Clear sort clears the sort.
    pickState('draft')
    page.reset.click()
    expect(numbers()).toEqual(['#2', '#1', '#3'])
    const clear = /** @type {HTMLButtonElement} */ (document.getElementById('clear-sort'))
    expect(clear.hidden).toBe(false)
    clear.click()
    expect(numbers()).toEqual(['#3', '#2', '#1'])
    expect(clear.hidden).toBe(true)
    header('Reviewed by').click()
    expect(header('Reviewed by').textContent).toBe('Reviewed by ↑')
  })

  it('keeps the PRs with author or reviewer attention points open, from Only PRs with', async () => {
    await loadPulls([
      pull({ number: 4, canvas: 'Ready', points: { author: 2, reviewer: 0 } }),
      pull({ number: 3, canvas: 'Ready', points: { author: 0, reviewer: 1 } }),
      pull({ number: 2, canvas: 'Ready', points: { author: 1, reviewer: 1 } }),
      pull({ number: 1 }),
    ])
    const numbers = () => [...document.querySelectorAll('#pull-table .pull-number')].map(n => n.textContent)
    const box = (/** @type {string} */ name) =>
      /** @type {HTMLInputElement} */ (document.querySelector(`#review-filter [data-filter="${name}"]`))
    expect(box('authorPoints').parentElement?.textContent?.trim()).toBe('Author attention points')
    expect(box('reviewerPoints').parentElement?.textContent?.trim()).toBe('Reviewer attention points')
    expect(document.querySelector('#review-filter [data-filter="pending"]')).toBeNull()
    box('authorPoints').click()
    expect(numbers()).toEqual(['#4', '#2'])
    box('reviewerPoints').click()
    expect(numbers()).toEqual(['#2'])
    box('authorPoints').click()
    expect(numbers()).toEqual(['#3', '#2'])
    box('reviewerPoints').click()
    expect(numbers()).toEqual(['#4', '#3', '#2', '#1'])
    // There is no Pending column to sort by.
    expect(
      [...document.querySelectorAll('#pull-table .sort-button')].some(b =>
        b.textContent?.startsWith('Pending')
      )
    ).toBe(false)
  })

  it('counts Open and Draft from what the other filters keep', async () => {
    await loadPulls([
      pull({ number: 3, isDraft: true }),
      pull({ number: 2 }),
      pull({ number: 1, health: { ci: 'failing', failing: 1, stuck: null, conflict: false } }),
    ])
    const count = (/** @type {string} */ name) =>
      document.querySelector(`[data-count="${name}"]`)?.textContent
    expect([count('open'), count('draft')]).toEqual(['2', '1'])
    const failing = /** @type {HTMLInputElement} */ (
      document.querySelector('input[data-section="github"][value="failing"]')
    )
    document.getElementById('integrations-none')?.click()
    failing.checked = true
    failing.dispatchEvent(new Event('change'))
    expect([count('open'), count('draft')]).toEqual(['1', '0'])
    // The tab still counts every open PR.
    expect(document.getElementById('nav-pull-count')?.textContent).toBe('3')
  })

  it('marks a PR in the merge queue, and shows how long it has been ready or queued', async () => {
    const hours = (/** @type {number} */ h) => new Date(Date.now() - h * 3_600_000).toISOString()
    const page = await loadPulls([
      pull({ number: 3, queuedAt: hours(1) }),
      pull({ number: 2, isDraft: true }),
      pull({ number: 1, readyAt: hours(5) }),
    ])
    // Open and Queued show to start; the draft waits for Draft.
    expect(page.titles()).toEqual(['Synthetic change #3', 'Synthetic change #1'])
    const marks = [...document.querySelectorAll('#pull-table .pull-state')].map(m => [
      m.getAttribute('aria-label'),
      m.getAttribute('class'),
    ])
    expect(marks).toEqual([
      ['Queued', 'pull-state warn'],
      ['Open', 'pull-state ok'],
    ])
    const ready = [...document.querySelectorAll('#pull-table tr.queue-row')].map(
      r => r.children[5]?.textContent
    )
    expect(ready).toEqual(['1h', '5h'])
    expect(document.querySelector('#pull-table .ready-queued')?.getAttribute('title')).toBe(
      'Open merge queue'
    )
    expect(document.querySelector('[data-count="queued"]')?.textContent).toBe('1')
    page.pickState('queued')
    expect(page.titles()).toEqual(['Synthetic change #3'])
  })

  it('filters by state, saves the filter to the server, and resets it', async () => {
    const page = await loadPulls([pull({ number: 2, isDraft: true }), pull({ number: 1 })])
    // Open is the default: drafts wait for Draft to be ticked.
    expect(page.reset.hidden).toBe(true)
    expect(page.titles()).toEqual(['Synthetic change #1'])
    expect(page.stateIs(['open', 'queued'])).toBe(true)
    expect(document.getElementById('state-button')?.hasAttribute('data-changed')).toBe(false)
    page.pickState('draft')
    expect(page.titles()).toEqual(['Synthetic change #2'])
    expect(page.stateIs(['draft'])).toBe(true)
    // Off its default, State's value shows in the info color; the untouched Reviews does not.
    expect(document.getElementById('state-button')?.hasAttribute('data-changed')).toBe(true)
    expect(document.getElementById('review-filter-button')?.hasAttribute('data-changed')).toBe(false)
    const saved =
      '{"state":["draft"],"needsUpdate":false,"reviews":null,"authorPoints":false,"reviewerPoints":false,"reviewers":null,"bases":null,"stack":"","sort":[],"codeRabbit":null,"vercel":null,"github":null,"canvas":null,"builder":false,"where":"","q":"","v":2}'
    expect(store.get('pr-greenlight:filters:v1:acme/widgets:pulls')).toBe(saved)
    // The server keeps them too, in one PUT for the burst of clicks.
    flushSavedFilters()
    const put = requests.filter(r => r.init?.method === 'PUT')
    expect(put.map(r => r.url)).toEqual(['/r/acme/widgets/api/lists-filters/pulls'])
    expect(JSON.parse(String(put[0]?.init?.body))).toEqual({ value: JSON.parse(saved) })
    expect(page.reset.hidden).toBe(false)
    page.reset.click()
    expect(page.titles()).toEqual(['Synthetic change #1'])
    expect(store.has('pr-greenlight:filters:v1:acme/widgets:pulls')).toBe(false)
    flushSavedFilters()
    expect(JSON.parse(String(requests.at(-1)?.init?.body))).toEqual({ value: null })
  })

  it('saves the filters by name and applies them, keeping the sort', async () => {
    const page = await loadPulls([pull({ number: 2, isDraft: true }), pull({ number: 1 })])
    const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id))
    page.pickState('draft')
    ;/** @type {HTMLInputElement} */ (get('presets-name')).value = 'Drafts'
    get('presets-save').click()
    expect(get('presets-label').textContent).toBe('Drafts')
    page.reset.click()
    // A sort set after saving stays when the saved filters come back.
    const sortButton = /** @type {HTMLButtonElement} */ (document.querySelector('th[data-col="pr"] button'))
    sortButton.click()
    const sorted = new URL(location.href).searchParams.getAll('sort')
    expect(sorted).not.toEqual([])
    ;/** @type {HTMLButtonElement} */ (get('presets-list').querySelector('.saved-search')).click()
    expect(page.titles()).toEqual(['Synthetic change #2'])
    expect(new URL(location.href).searchParams.getAll('sort')).toEqual(sorted)
    expect(JSON.parse(store.get('pr-greenlight:presets:v1:acme/widgets') ?? '')).toEqual({
      pulls: [
        {
          name: 'Drafts',
          filters: {
            state: ['draft'],
            needsUpdate: false,
            reviews: null,
            authorPoints: false,
            reviewerPoints: false,
            reviewers: null,
            bases: null,
            stack: '',
            codeRabbit: null,
            vercel: null,
            github: null,
            canvas: null,
            builder: false,
            where: '',
            q: '',
            v: 2,
          },
        },
      ],
    })
  })

  it('opens with the saved filter', async () => {
    store.set('pr-greenlight:filters:v1:acme/widgets:pulls', '{"state":"both"}')
    const page = await loadPulls([pull({ number: 2, isDraft: true }), pull({ number: 1 })])
    expect(page.titles()).toEqual(['Synthetic change #2', 'Synthetic change #1'])
  })

  it('opens with the filters the server saved, ahead of this browser’s', async () => {
    store.set('pr-greenlight:filters:v1:acme/widgets:pulls', '{"state":["open"],"v":2}')
    const page = await loadPulls(
      [pull({ number: 2, isDraft: true }), pull({ number: 1 })],
      undefined,
      undefined,
      {
        savedFilters: { pulls: { state: ['draft'], v: 2 } },
      }
    )
    expect(page.titles()).toEqual(['Synthetic change #2'])
  })

  it('says why the list is empty, or that the first sync is still running', async () => {
    const synced = await loadPulls([])
    expect(synced.table.hidden).toBe(true)
    expect(synced.empty.textContent).toBe('You have no open PRs in acme/widgets.')
    const drafts = await loadPulls([pull({ number: 2, isDraft: true })])
    expect(drafts.empty.textContent).toBe('No open PRs of yours that are ready for review.')
    const fresh = await loadPulls([], { fetchedAt: null, error: null })
    expect(fresh.empty.textContent).toBe('Syncing…')
    fresh.pickState('draft')
    expect(fresh.empty.textContent).toBe('Syncing…')
  })

  it('shows a failed sync, and a stale one', async () => {
    const failed = await loadPulls([pull({})], { fetchedAt: null, error: 'gh is not logged in' })
    expect(failed.error.hidden).toBe(false)
    expect(failed.error.textContent).toBe('Last sync failed: gh is not logged in')
    const stale = await loadPulls([pull({})], {
      fetchedAt: new Date(Date.now() - 3_600_000).toISOString(),
      error: null,
    })
    expect(stale.stale.hidden).toBe(false)
    expect(stale.stale.textContent).toBe('Last synced 1h ago.')
  })

  it('reports a list it could not load', async () => {
    await mount()
    respond = () =>
      Response.json({ error: { code: 'NOT_FOUND', message: 'no project here' } }, { status: 404 })
    await wirePullsPage(document)
    expect(document.getElementById('sync-error')?.textContent).toBe('Last sync failed: no project here')
  })

  it('reports an error answer that is not JSON by its status', async () => {
    await mount()
    respond = () => new Response('Bad gateway', { status: 502 })
    await wirePullsPage(document)
    expect(document.getElementById('sync-error')?.textContent).toBe('Last sync failed: request failed (502)')
  })

  it('reloads when a sync finishes', async () => {
    await loadPulls([pull({})])
    const before = requests.filter(r => r.url.endsWith('/lists/pulls')).length
    document.querySelector('main')?.dispatchEvent(new Event('pr-greenlight:synced'))
    await flush()
    expect(requests.filter(r => r.url.endsWith('/lists/pulls')).length).toBe(before + 1)
  })

  it('loads again every minute while the tab shows', async () => {
    /** @type {(() => void)[]} */
    const every = []
    const view = /** @type {Window} */ (document.defaultView)
    const setInterval = view.setInterval.bind(view)
    vi.spyOn(view, 'setInterval').mockImplementation(
      /** @type {any} */ (
        (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
          if (ms !== RELOAD_EVERY_MS) return setInterval(fn, ms)
          every.push(fn)
          return 0
        }
      )
    )
    await loadPulls([pull({ number: 1 })])
    expect(every).toHaveLength(1)
    respond = () =>
      Response.json(
        answer([pull({ number: 2 })], { fetchedAt: null, error: null }, [{ name: 'develop', color: 'green' }])
      )
    every[0]?.()
    await flush()
    expect([...document.querySelectorAll('#pull-table .pull-number')].map(n => n.textContent)).toEqual(['#2'])
  })

  it('loads again while the server is still reading the list behind its answer', async () => {
    /** @type {(() => void)[]} */
    const later = []
    const view = /** @type {Window} */ (document.defaultView)
    const setTimeout = view.setTimeout.bind(view)
    vi.spyOn(view, 'setTimeout').mockImplementation(
      /** @type {any} */ (
        (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
          if (ms !== SYNCING_RELOAD_MS) return setTimeout(fn, ms)
          later.push(fn)
          return 0
        }
      )
    )
    const page = await loadPulls([], { fetchedAt: null, error: null, syncing: true })
    expect(page.empty.textContent).toBe('Syncing…')
    expect(later).toHaveLength(1)
    respond = () =>
      Response.json(
        answer([pull({ number: 4 })], { fetchedAt: new Date().toISOString(), error: null }, [
          { name: 'develop', color: 'green' },
        ])
      )
    later[0]?.()
    await flush()
    expect(page.titles()).toEqual(['Synthetic change #4'])
    // Read whole, it waits for the next minute.
    expect(later).toHaveLength(1)
  })

  it('opens the generate dialog from Generate in its Actions', async () => {
    await loadPulls([pull({ number: 1, canvas: 'Pending' })], undefined, undefined, { canGenerate: true })
    const list = respond
    respond = (url, init) =>
      url.endsWith('/lists-generate/1/dialog')
        ? Response.json({
            local: false,
            status: 'missing',
            skillCommand: '/pr-review-canvas 1',
            chat: { enabled: true, acpx: true, agent: 'claude', model: null },
            canvasComment: true,
          })
        : list(url, init)
    const go = /** @type {HTMLButtonElement} */ (
      document.querySelector('#pull-table .row-actions .canvas-action')
    )
    expect([go.tagName, go.textContent?.trim()]).toEqual(['BUTTON', 'Generate'])
    go.click()
    await flush()
    await flush()
    expect(requests.map(r => r.url)).toContain('/r/acme/widgets/api/lists-generate/1/dialog')
    // Nothing starts from the table: the dialog's Start does.
    expect(requests.filter(r => r.init?.method === 'POST')).toEqual([])
    const dialog = document.getElementById('generate-dialog')
    expect(dialog?.hasAttribute('open')).toBe(true)
    expect(dialog?.querySelector('h2')?.textContent).toBe('Generate the canvas')
    expect(go.classList.contains('bad')).toBe(false)
  })

  it('shows a failed generation in its Canvas badge, and offers to try again', async () => {
    const generation = /** @type {const} */ ({ state: 'failed', message: 'the agent stopped', endedAt: null })
    await loadPulls([pull({ number: 3, canvas: 'Stale', generation })], undefined, undefined, {
      canGenerate: true,
    })
    const badge = document.querySelector('#pull-table .canvas-state')
    expect([badge?.className, badge?.textContent, badge?.getAttribute('title')]).toEqual([
      'badge bad canvas-state',
      'Stale',
      'Its canvas is for other commits than its head. The last generation failed: the agent stopped',
    ])
    expect(document.querySelector('#pull-table .row-actions .canvas-action')?.textContent?.trim()).toBe(
      'Regenerate'
    )
    // Generate missing is gone from the page.
    expect(document.getElementById('generate-missing')).toBeNull()
  })

  it('stops a running generation from its Actions, then loads the list again', async () => {
    const generation = /** @type {const} */ ({
      state: 'running',
      phase: 'generating',
      startedAt: '2026-10-30T12:00:00Z',
    })
    await loadPulls([pull({ number: 5, canvas: 'Pending', generation })], undefined, undefined, {
      canGenerate: true,
    })
    const before = requests.filter(r => r.url.endsWith('/lists/pulls')).length
    const stop = /** @type {HTMLButtonElement} */ (
      document.querySelector('#pull-table .row-actions .canvas-action')
    )
    expect(stop.textContent?.trim()).toBe('Stop')
    stop.click()
    await flush()
    await flush()
    expect(requests.filter(r => r.init?.method === 'DELETE').map(r => r.url)).toEqual([
      '/r/acme/widgets/api/lists-generate/5',
    ])
    expect(requests.filter(r => r.url.endsWith('/lists/pulls')).length).toBe(before + 1)
  })

  it('shows and sorts by each PR’s open attention points, a dash with no canvas here', async () => {
    await loadPulls([
      pull({ number: 3, canvas: 'Ready', points: { author: 1, reviewer: 1 } }),
      pull({ number: 2 }),
      pull({ number: 1, canvas: 'Ready', points: { author: 0, reviewer: 0 } }),
    ])
    const cells = () => [...document.querySelectorAll('#pull-table tr.queue-row')].map(r => r.children[2])
    const counts = () => cells().map(c => c?.textContent)
    expect(counts()).toEqual(['11', '—', '00'])
    expect(
      [...(cells()[0]?.querySelectorAll('.pending-count') ?? [])].map(c => c.getAttribute('title'))
    ).toEqual(['1 for the author', '1 for the reviewer'])
    const header = () =>
      /** @type {HTMLButtonElement} */ (
        [...document.querySelectorAll('#pull-table .sort-button')].find(b =>
          b.textContent?.startsWith('Attention points')
        )
      )
    header().click()
    expect(counts()).toEqual(['—', '00', '11'])
    header().click()
    expect(counts()).toEqual(['11', '00', '—'])
  })

  it('loads again while a canvas generation is under way, and stops once it ends', async () => {
    /** @type {(() => void)[]} */
    const later = []
    const view = /** @type {Window} */ (document.defaultView)
    const setTimeout = view.setTimeout.bind(view)
    vi.spyOn(view, 'setTimeout').mockImplementation(
      /** @type {any} */ (
        (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
          if (ms !== SYNCING_RELOAD_MS) return setTimeout(fn, ms)
          later.push(fn)
          return 0
        }
      )
    )
    const generation = /** @type {const} */ ({
      state: 'running',
      phase: 'preparing',
      startedAt: '2026-10-30T12:00:00Z',
    })
    await loadPulls([pull({ number: 4, generation })], undefined, undefined, { canGenerate: true })
    expect(document.querySelector('#pull-table .canvas-state')?.textContent?.trim()).toBe('Generating')
    expect(later).toHaveLength(1)
    respond = () =>
      Response.json(
        answer([pull({ number: 4, canvas: 'Ready' })], { fetchedAt: new Date().toISOString(), error: null }, [
          { name: 'develop', color: 'green' },
        ])
      )
    later[0]?.()
    await flush()
    expect(document.querySelector('#pull-table .canvas-state')?.textContent).toBe('Ready')
    // Ended, it waits for the next minute.
    expect(later).toHaveLength(1)
  })

  it('does nothing on another page', async () => {
    document.body.innerHTML = '<main></main>'
    expect(await wirePullsPage(document)).toBeUndefined()
  })
})

describe('the review filter on the Pull requests page', () => {
  const people = [reviewer('alice', { approvals: 1 })]
  const canvas = reviewer('Canvas', { kind: 'canvas', comments: 2 })
  const bots = reviewer('Bots', { kind: 'bots', members: ['coderabbitai[bot]'], comments: 4 })

  it('keeps PRs with a ticked review state and, checked, open attention points; saves it, and resets', async () => {
    const page = await loadPulls([
      pull({ number: 3, title: 'Approved one', reviewers: people, points: { author: 0, reviewer: 2 } }),
      pull({ number: 2, title: 'Canvas one', reviewers: [canvas], points: { author: 1, reviewer: 0 } }),
      pull({ number: 1, title: 'Bot one', reviewers: [bots] }),
    ])
    const box = (/** @type {string} */ k) =>
      /** @type {HTMLInputElement} */ (document.querySelector(`#review-filter [data-filter="${k}"]`))
    const button = /** @type {HTMLElement} */ (document.getElementById('review-filter-button'))
    button.click()
    expect(document.getElementById('review-filter')?.hidden).toBe(false)
    // Only the attention point flags are left beside the states: canvas and bot reviews are Status's.
    expect(
      [...document.querySelectorAll('#review-filter [data-filter]')].map(b => b.getAttribute('data-filter'))
    ).toEqual(['authorPoints', 'reviewerPoints'])
    box('authorPoints').click()
    expect(page.titles()).toEqual(['Canvas one #2'])
    expect(document.getElementById('review-filter-label')?.textContent).toBe('All · Author points')
    expect(JSON.parse(store.get('pr-greenlight:filters:v1:acme/widgets:pulls') ?? '')).toMatchObject({
      authorPoints: true,
      reviewerPoints: false,
    })
    box('authorPoints').click()
    box('reviewerPoints').click()
    expect(page.titles()).toEqual(['Approved one #3'])
    expect(document.getElementById('review-filter-label')?.textContent).toBe('All · Reviewer points')
    box('reviewerPoints').click()
    // The review states start ticked; each unticked one hides its PRs.
    const state = (/** @type {string} */ k) =>
      /** @type {HTMLInputElement} */ (document.querySelector(`#review-filter [data-review="${k}"]`))
    expect(['approved', 'changesRequested', 'commented', 'none'].every(k => state(k).checked)).toBe(true)
    state('none').click()
    expect(page.titles()).toEqual(['Approved one #3'])
    expect(document.getElementById('review-filter-label')?.textContent).toBe('3 of 4')
    state('approved').click()
    expect(page.empty.textContent).toBe('No PRs match these filters.')
    document.getElementById('reviews-all')?.click()
    expect(page.titles()).toHaveLength(3)
    document.getElementById('reviews-none')?.click()
    expect(page.titles()).toEqual([])
    expect(document.getElementById('review-filter-label')?.textContent).toBe('None')
    page.reset.click()
    expect(page.titles()).toHaveLength(3)
    expect(state('changesRequested').checked).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.getElementById('review-filter')?.hidden).toBe(true)
  })
})

describe('the Labels column', () => {
  it('shows each PR’s labels and sorts by them', async () => {
    store.set('pr-greenlight:filters:v1:acme/widgets:pulls', '{"sort":["labels"]}')
    await loadPulls([
      pull({ number: 1, title: 'Docs', labels: ['docs'] }),
      pull({ number: 2, title: 'Api', labels: ['api', 'auth'] }),
      pull({ number: 3, title: 'None' }),
    ])
    const head = document.querySelector('#pull-table thead [data-col="labels"]')
    expect(head?.textContent?.startsWith('Labels')).toBe(true)
    const cells = [...document.querySelectorAll('#pull-table .queue-labels')].map(c =>
      [...c.children].map(b => b.textContent)
    )
    expect(cells).toEqual([[], ['api', 'auth'], ['docs']])
  })
})

describe('the Base filter', () => {
  const TWO = [
    { name: 'develop', color: /** @type {const} */ ('blue') },
    { name: 'main', color: /** @type {const} */ ('green') },
  ]
  const filter = () => /** @type {HTMLElement} */ (document.getElementById('bases-filter'))
  const box = (/** @type {string} */ name) =>
    /** @type {HTMLInputElement} */ (document.querySelector(`#bases-options input[value="${name}"]`))

  it('hides while the repo has one base branch', async () => {
    store.set('pr-greenlight:filters:v1:acme/widgets:pulls', '{"bases":["main"]}')
    const page = await loadPulls([pull({ number: 1 })])
    expect(filter().hidden).toBe(true)
    // A base picked before still filters nothing, so there is nothing to reset.
    expect(page.titles()).toEqual(['Synthetic change #1'])
    expect(page.reset.hidden).toBe(true)
  })

  it('keeps the PRs on the bases picked, those on another PR under Stacked branches', async () => {
    const page = await loadPulls(
      [
        pull({
          number: 1,
          title: 'On develop',
          headRefName: 'feature/a',
          stack: { name: 'feature/a', position: 1, total: 2, base: 'develop' },
        }),
        pull({ number: 2, title: 'Hotfix', headRefName: 'hotfix/b', baseRefName: 'main' }),
        pull({
          number: 3,
          title: 'On a',
          headRefName: 'feature/c',
          baseRefName: 'feature/a',
          stack: { name: 'feature/a', position: 2, total: 2, base: 'develop' },
        }),
      ],
      undefined,
      TWO
    )
    expect(filter().hidden).toBe(false)
    const counts = [...document.querySelectorAll('#bases-options label')].map(l => l.textContent?.trim())
    // As the tables split them: the stack's root on develop, the PR on it stacked.
    expect(counts).toEqual(['develop1', 'main1', 'Stacked branches1', 'Other branches0'])
    expect(document.getElementById('bases-label')?.textContent).toBe('All')

    for (const name of ['develop', ':stacked', ':other']) {
      box(name).checked = false
      box(name).dispatchEvent(new Event('change'))
    }
    expect(page.titles()).toEqual(['Hotfix #2'])
    expect(document.getElementById('bases-label')?.textContent).toBe('main')
    expect(JSON.parse(store.get('pr-greenlight:filters:v1:acme/widgets:pulls') ?? '{}').bases).toEqual([
      'main',
    ])

    box('main').checked = false
    box('main').dispatchEvent(new Event('change'))
    box(':stacked').checked = true
    box(':stacked').dispatchEvent(new Event('change'))
    expect(page.titles()).toEqual(['On a #3'])
    expect(document.getElementById('bases-label')?.textContent).toBe('Stacked branches')

    page.reset.click()
    expect(page.titles()).toHaveLength(3)
    expect(document.getElementById('bases-label')?.textContent).toBe('All')
    document.getElementById('bases-none')?.click()
    expect(page.titles()).toEqual([])
  })
})

describe('stack positions', () => {
  it('names each stacked PR’s place, and filters by its stack on a click, for the open page only', async () => {
    await loadPulls([
      pull({
        number: 2,
        headRefName: 'limits-2',
        baseRefName: 'limits-1',
        stack: { name: 'limits-1', position: 2, total: 2 },
      }),
      pull({ number: 1, headRefName: 'limits-1', stack: { name: 'limits-1', position: 1, total: 2 } }),
      pull({ number: 3, headRefName: 'readme' }),
    ])
    // The place follows the branches: the stack icon and its numbers, the name in its tooltip.
    const places = /** @type {HTMLButtonElement[]} */ ([
      ...document.querySelectorAll('.pull-branch > .branch-head + .stack-pos'),
    ])
    expect(places.map(b => b.textContent)).toEqual(['1/2', '2/2'])
    expect(places[1]?.getAttribute('aria-label')).toBe('Stack limits-1, 2 of 2: filter by stack')
    expect(places[1]?.title).toBe('Filter by stack limits-1')
    places[1]?.click()
    expect(document.getElementById('stack-label')?.textContent).toBe('limits-1')
    expect([...document.querySelectorAll('#pull-table .pull-number')].map(n => n.textContent)).toEqual([
      '#1',
      '#2',
    ])
    // Nothing keeps it: not the saved filters, not the address.
    expect(store.get('pr-greenlight:filters:v1:acme/widgets:pulls') ?? '').not.toContain('limits-1')
    expect(new URLSearchParams(location.search).get('stack')).toBeNull()
    // Filters says one is on.
    expect(document.getElementById('filters-count')?.textContent).toBe('1')
  })
})

describe('the search box', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    history.replaceState(null, '', BASE)
  })

  const PULLS = [
    pull({ number: 3, title: 'Cache the widgets', headRefName: 'cache-widgets' }),
    pull({ number: 2, title: 'Fix the login', headRefName: 'feat/login' }),
    pull({ number: 1, title: 'Tidy docs', headRefName: 'docs' }),
  ]
  const box = () => /** @type {HTMLInputElement} */ (document.getElementById('pr-search'))
  /** Types into the box and lets the words settle. @param {string} text */
  const type = text => {
    box().value = text
    box().dispatchEvent(new Event('input'))
    vi.advanceTimersByTime(SEARCH_DELAY_MS)
  }

  it('narrows the rows by title, branch and number, marking what matched', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const page = await loadPulls(PULLS)
    expect(box().placeholder).toBe('Title, branch or #123')
    expect(document.getElementById('search-count')?.hidden).toBe(true)
    // The rows wait for a pause in typing; the box follows each key.
    box().value = 'LOG'
    box().dispatchEvent(new Event('input'))
    vi.advanceTimersByTime(SEARCH_DELAY_MS - 1)
    expect(page.titles()).toHaveLength(3)
    expect(location.search).toBe('')
    expect(document.getElementById('pr-search-clear')?.hidden).toBe(false)
    type('LOGIN')
    expect(page.titles()).toEqual(['Fix the login #2'])
    expect([...document.querySelectorAll('#pull-table mark')].map(m => m.textContent)).toEqual([
      'login',
      'login',
    ])
    expect(new URLSearchParams(location.search).get('q')).toBe('LOGIN')
    expect(document.getElementById('search-count')?.textContent).toBe('1 of 3 PRs')
    type('#1')
    expect(page.titles()).toEqual(['Tidy docs #1'])
    type('cache')
    expect(page.titles()).toEqual(['Cache the widgets #3'])
    // No keys to find a PR by here, so no row says which one did.
    expect(document.querySelector('#pull-table .search-key-chip')).toBeNull()
    // Open and Draft count what the search keeps too.
    expect(document.querySelector('[data-count="open"]')?.textContent).toBe('1')
    // Escape clears the box, then leaves it.
    box().focus()
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect([box().value, page.titles().length, location.search]).toEqual(['', 3, ''])
  })

  it('opens the one match on Enter, and / puts the cursor in the box outside any field', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await loadPulls(PULLS)
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))
    expect(document.activeElement).toBe(box())
    type('widgets')
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(assign).toHaveBeenCalledWith('/r/acme/widgets/review/3')
    type('e')
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('reads the search from the address, and says when the filters hide what matches', async () => {
    history.replaceState(null, '', '/r/acme/widgets/?q=docs&state=draft')
    const page = await loadPulls(PULLS)
    expect(box().value).toBe('docs')
    expect(page.titles()).toEqual([])
    expect(page.empty.textContent).toBe(
      'No PRs match “docs”. Clear search · 1 more PR matches with your filters reset. Reset filters'
    )
    const [, resetFilters] = /** @type {HTMLButtonElement[]} */ ([...page.empty.querySelectorAll('button')])
    resetFilters?.click()
    expect(page.titles()).toEqual(['Tidy docs #1'])
  })

  it('keeps PRs matching any alternative of OR, and colors AND and OR in the box', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const page = await loadPulls(PULLS)
    const searchBox = /** @type {HTMLElement} */ (document.querySelector('.search-box'))
    type('cache OR login')
    expect(page.titles()).toEqual(['Cache the widgets #3', 'Fix the login #2'])
    expect(searchBox.classList.contains('has-syntax')).toBe(true)
    expect(searchBox.querySelector('.search-mirror')?.textContent).toBe('cache OR login')
    expect([...searchBox.querySelectorAll('.search-op')].map(s => s.textContent)).toEqual(['OR'])
    type('fix AND login')
    expect(page.titles()).toEqual(['Fix the login #2'])
    // In lower case, "or" is a word to find, and nothing is colored.
    type('cache or login')
    expect(page.titles()).toEqual([])
    expect(searchBox.classList.contains('has-syntax')).toBe(false)
  })

  it('saves the search with the filters by name, but never as the page’s own', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const page = await loadPulls(PULLS)
    const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id))
    type('docs OR login')
    // In the address, but not among the filters the page remembers.
    expect(new URLSearchParams(location.search).get('q')).toBe('docs OR login')
    expect(store.get('pr-greenlight:filters:v1:acme/widgets:pulls')).toBeUndefined()
    // Reset leaves the search; the box's own × clears it.
    expect(page.reset.hidden).toBe(true)
    ;/** @type {HTMLInputElement} */ (get('presets-name')).value = 'Docs or login'
    get('presets-save').click()
    expect(get('presets-label').textContent).toBe('Docs or login')
    expect(JSON.parse(store.get('pr-greenlight:presets:v1:acme/widgets') ?? '{}').pulls[0].filters.q).toBe(
      'docs OR login'
    )
    get('pr-search-clear').click()
    expect([box().value, page.titles().length, get('presets-label').textContent]).toEqual(['', 3, 'None'])
    // Applying it puts the search back in the box.
    ;/** @type {HTMLButtonElement} */ (get('presets-list').querySelector('.saved-search')).click()
    expect(box().value).toBe('docs OR login')
    expect(page.titles()).toEqual(['Fix the login #2', 'Tidy docs #1'])
  })
})

describe('the Stack filter', () => {
  it('shows only the stack a link names, with every state, and leaves the saved filters alone', async () => {
    store.set('pr-greenlight:filters:v1:acme/widgets:pulls', '{"state":"draft","v":2}')
    history.replaceState(null, '', '/r/acme/widgets/?stack=limits-1&state=both')
    const page = await loadPulls([
      pull({ number: 3 }),
      pull({
        number: 2,
        isDraft: true,
        headRefName: 'limits-2',
        baseRefName: 'limits-1',
        stack: { name: 'limits-1', position: 2, total: 2 },
      }),
      pull({ number: 1, headRefName: 'limits-1', stack: { name: 'limits-1', position: 1, total: 2 } }),
    ])
    // One stack, whole and in its order, though #2 is on another branch and the sort says otherwise.
    expect(page.titles()).toEqual(['Synthetic change #1', 'Synthetic change #2'])
    expect(document.getElementById('stacked-section')?.hidden).toBe(true)
    expect(document.querySelector('#pull-table .section-row')).toBeNull()
    expect(store.get('pr-greenlight:filters:v1:acme/widgets:pulls')).toBe('{"state":"draft","v":2}')
    expect(document.getElementById('stack-label')?.textContent).toBe('limits-1')
    // The table is named after the stack, with its icon.
    const title = () => document.querySelector('#pulls-main-heading .fold-title')
    const showAll = /** @type {HTMLElement} */ (document.getElementById('pulls-show-all'))
    expect(title()?.textContent?.trim()).toBe('Stack: limits-1')
    expect(title()?.querySelector('svg')).not.toBeNull()
    expect(showAll.hidden).toBe(false)
    const items = /** @type {HTMLElement[]} */ ([...document.querySelectorAll('#stack-options .menu-item')])
    expect(items.map(i => i.getAttribute('aria-checked'))).toEqual(['false', 'true'])
    items[0]?.click()
    expect(page.titles()).toHaveLength(3)
    expect(document.getElementById('stack-label')?.textContent).toBe('All')
    expect(title()?.textContent).toBe('On base branches')
    expect(showAll.hidden).toBe(true)
    history.replaceState(null, '', BASE)
  })

  it('shows a linked stack whole, drafts too, keeps it out of the address, and Show all PRs clears it alone', async () => {
    history.replaceState(null, '', '/r/acme/widgets/?stack=limits-1&state=open')
    const page = await loadPulls([
      pull({ number: 3 }),
      pull({
        number: 2,
        isDraft: true,
        headRefName: 'limits-2',
        baseRefName: 'limits-1',
        stack: { name: 'limits-1', position: 2, total: 2 },
      }),
      pull({ number: 1, headRefName: 'limits-1', stack: { name: 'limits-1', position: 1, total: 2 } }),
    ])
    // The draft #2 shows with its stack though State keeps open PRs only.
    expect(page.titles()).toEqual(['Synthetic change #1', 'Synthetic change #2'])
    expect(new URLSearchParams(location.search).get('stack')).toBeNull()
    expect(store.get('pr-greenlight:filters:v1:acme/widgets:pulls') ?? '').not.toContain('limits-1')
    expect(document.querySelector('#pulls-main-heading .fold-title')?.textContent?.trim()).toBe(
      'Stack: limits-1'
    )
    document.getElementById('pulls-show-all')?.click()
    expect(page.titles()).toEqual(['Synthetic change #3', 'Synthetic change #1'])
    expect(document.querySelector('#pulls-main-heading .fold-title')?.textContent).toBe('On base branches')
    history.replaceState(null, '', BASE)
  })
})

describe('sections on Pull requests', () => {
  it('groups your PRs into the repo’s sections, hiding empty ones', async () => {
    await loadPulls(
      [pull({ number: 3, labels: ['docs'] }), pull({ number: 2, labels: ['BUG'] }), pull({ number: 1 })],
      undefined,
      undefined,
      {
        sections: [
          { name: 'Critical', labels: ['Critical'] },
          { name: 'Bugs', labels: ['bug'] },
          { name: 'Other', labels: [] },
        ],
      }
    )
    const order = [...document.querySelectorAll('#pull-table tbody > tr')].map(n =>
      n.classList.contains('section-row') ? n.textContent : n.querySelector('.pull-number')?.textContent
    )
    expect(order).toEqual(['Bugs · 1 PR', '#2', 'Other · 2 PRs', '#3', '#1'])
    expect(document.querySelector('#pull-table .section-row')?.className).toBe('section-row warn')
    // Section rows stick under the column header, as far down as it is tall.
    expect(document.getElementById('pull-table')?.style.getPropertyValue('--head-height')).toMatch(
      /^[\d.]+px$/
    )
  })

  it('folds a section from its row and the main table from its heading', async () => {
    const pulls = [pull({ number: 2, labels: ['bug'] }), pull({ number: 1 })]
    const extra = {
      sections: [
        { name: 'Bugs', labels: ['bug'] },
        { name: 'Other', labels: [] },
      ],
    }
    await loadPulls(pulls, undefined, undefined, extra)
    const order = () =>
      [...document.querySelectorAll('#pull-table tbody > tr')].map(n =>
        n.classList.contains('section-row') ? n.textContent : n.querySelector('.pull-number')?.textContent
      )
    expect(document.querySelector('#pulls-main-heading .fold-button')?.textContent?.trim()).toBe(
      'On base branches 2'
    )
    const sectionFold = /** @type {HTMLElement} */ (document.querySelector('#pull-table .section-fold'))
    sectionFold.click()
    expect(order()).toEqual(['Bugs · 1 PR', 'Other · 1 PR', '#1'])
    const tableFold = /** @type {HTMLElement} */ (document.querySelector('#pulls-main-heading .fold-button'))
    tableFold.click()
    expect(document.getElementById('pulls-main-body')?.hidden).toBe(true)
    // The table's fold is in the address; the section's stays saved only.
    expect(new URLSearchParams(location.search).getAll('fold')).toEqual(['main'])
    // Both stay folded on the next visit.
    await loadPulls(pulls, undefined, undefined, extra)
    expect(order()).toEqual(['Bugs · 1 PR', 'Other · 1 PR', '#1'])
    expect(document.getElementById('pulls-main-body')?.hidden).toBe(true)
    expect(new URLSearchParams(location.search).getAll('fold')).toEqual(['main'])
  })

  it('opens every table a link names with an empty fold, ahead of the ones saved shut', async () => {
    store.set('pr-greenlight:folds:v1:acme/widgets', JSON.stringify({ pulls: ['main', 'stacked'] }))
    history.replaceState(null, '', '/r/acme/widgets/?stack=limits-1&state=both&fold=')
    await loadPulls([
      pull({ number: 2, headRefName: 'limits-2', baseRefName: 'limits-1' }),
      pull({ number: 1, stack: { name: 'limits-1', position: 1, total: 2 } }),
    ])
    expect(document.getElementById('pulls-main-body')?.hidden).toBe(false)
    expect(document.getElementById('stacked-body')?.hidden).toBe(false)
    const params = new URLSearchParams(location.search)
    // The stack is the open page's alone: the address drops it once read.
    // An older link's Both is every state now.
    expect([params.get('stack'), params.getAll('state'), params.getAll('fold')]).toEqual([
      null,
      ['open', 'draft', 'queued'],
      [''],
    ])
    document.querySelector('#pulls-main-heading .fold-button')?.dispatchEvent(new MouseEvent('click'))
    expect(new URLSearchParams(location.search).getAll('fold')).toEqual(['main'])
    expect(JSON.parse(store.get('pr-greenlight:folds:v1:acme/widgets') ?? '{}')).toEqual({ pulls: ['main'] })
  })
})

describe('slim rows on Pull requests', () => {
  it('shows each PR on one line, opens the rest under it, and keeps the view for the repo', async () => {
    const pulls = [
      pull({
        number: 2,
        labels: ['bug', 'auth', 'api'],
        reviewers: [reviewer('alice', { approvals: 1 }), reviewer('bob', { comments: 2 })],
      }),
      pull({ number: 1, labels: ['docs'] }),
    ]
    const page = await loadPulls(pulls)
    const view = /** @type {HTMLButtonElement} */ (document.getElementById('slim-rows'))
    const foldAll = /** @type {HTMLButtonElement} */ (document.getElementById('fold-rows'))
    // Whole, as before: no arrows, and nothing for Expand all to do.
    expect([view.getAttribute('aria-pressed'), view.title]).toEqual(['false', 'Compact view'])
    expect(foldAll.hidden).toBe(true)
    expect(document.querySelectorAll('.row-arrow')).toHaveLength(0)
    expect(page.rows()[0]?.querySelector('.pull-branch')).not.toBeNull()

    view.click()
    expect([view.getAttribute('aria-pressed'), view.title]).toEqual(['true', 'Full view'])
    expect(document.querySelector('#pull-table table')?.classList.contains('slim')).toBe(true)
    const row = () => /** @type {Element} */ (page.rows()[0])
    // One line: no branch line; nothing for the marks beside the title; the first label and +2.
    expect(row().querySelector('.pull-branch')).toBeNull()
    expect(row().querySelector('.slim-marks')?.children).toHaveLength(0)
    expect(row().querySelector('.queue-labels > .label-badge')?.textContent).toBe('bug')
    // "+2" opens a popup of the rest, as Reviewed by's "+N" does; its label says them in words.
    const more = row().querySelector('.label-more')
    expect([more?.textContent, more?.getAttribute('aria-label'), more?.hasAttribute('title')]).toEqual([
      '+2',
      '2 more labels: auth, api',
      false,
    ])
    expect([...row().querySelectorAll('.label-popup li')].map(l => l.textContent)).toEqual(['auth', 'api'])
    expect(row().querySelector('.label-popup')?.getAttribute('aria-hidden')).toBe('true')
    const arrow = /** @type {HTMLButtonElement} */ (row().querySelector('.row-arrow'))
    expect([arrow.getAttribute('aria-expanded'), arrow.getAttribute('aria-label')]).toEqual([
      'false',
      'Show more about #2',
    ])
    expect([foldAll.hidden, foldAll.title]).toEqual([false, 'Expand all'])

    arrow.click()
    const open = /** @type {Element} */ (row().nextElementSibling)
    expect(open.classList.contains('row-open')).toBe(true)
    expect(open.querySelector('td')?.getAttribute('colspan')).toBe(String(row().children.length))
    expect(open.querySelector('.pull-branch')?.textContent).toContain('develop← from feature')
    // Labels and reviewers stay in their columns, behind their "+N".
    expect(open.querySelectorAll('.label-badge, .reviewer-pill')).toHaveLength(0)
    expect(document.activeElement?.getAttribute('data-arrow')).toBe('2')
    foldAll.click()
    expect(page.rows()[1]?.nextElementSibling?.classList.contains('row-open')).toBe(true)
    expect(foldAll.title).toBe('Collapse all')
    foldAll.click()
    expect(document.querySelectorAll('.row-open')).toHaveLength(0)

    // Kept for the repo with the folds, not in the address.
    expect(JSON.parse(store.get('pr-greenlight:folds:v1:acme/widgets') ?? '{}')).toEqual({
      pulls: ['view:slim'],
    })
    expect(new URLSearchParams(location.search).getAll('fold')).toEqual([])
    await loadPulls(pulls)
    expect(document.getElementById('slim-rows')?.getAttribute('aria-pressed')).toBe('true')
    document.getElementById('slim-rows')?.click()
    expect(document.querySelectorAll('.row-arrow')).toHaveLength(0)
    expect(document.getElementById('fold-rows')?.hidden).toBe(true)
  })
})

describe('fixing from the Pull requests page', () => {
  it("has no Fix anywhere: a fix starts from items picked on the PR's page", async () => {
    await loadPulls([pull({ number: 2 }), pull({ number: 1 })])
    await flush()
    expect(document.querySelectorAll('main .fix-menu, main [aria-label^="Fix"]')).toHaveLength(0)
    expect(document.getElementById('fix-all')).toBeNull()
    expect([...document.querySelectorAll('.row-actions')].map(a => a.children.length)).toEqual([3, 3])
    expect(document.querySelectorAll('.row-actions .review-open')).toHaveLength(2)
    expect(document.querySelectorAll('.row-actions .row-sync')).toHaveLength(2)
    expect(requests.some(r => r.url.endsWith('/fix-targets'))).toBe(false)
  })
})

describe('the Columns picker on Pull requests', () => {
  it('turns columns on and off with All and None, keeping Pull request and Actions', async () => {
    const page = await loadPulls([pull({ number: 7, canvas: 'Ready', points: { author: 2, reviewer: 0 } })])
    const box = (/** @type {string} */ name) =>
      /** @type {HTMLInputElement} */ (document.querySelector(`#columns-options [data-column="${name}"]`))
    const shownHead = () =>
      [...document.querySelectorAll('#pull-table thead [data-col]')]
        .map(c => c.getAttribute('data-col'))
        .filter(c => c !== 'pr')
    // CodeRabbit is not read here, so it is neither offered nor shown.
    expect(
      [...document.querySelectorAll('#columns-options input')].map(i => i.getAttribute('data-column'))
    ).toEqual(['status', 'points', 'review', 'reviewed', 'ready', 'labels', 'canvas'])
    expect(shownHead()).toEqual(['status', 'points', 'review', 'reviewed', 'ready', 'labels', 'canvas'])
    expect(page.rows()[0]?.children).toHaveLength(9)
    // A hidden column leaves the sort; the others stay in it.
    const sortBy = (/** @type {string} */ name) =>
      /** @type {HTMLButtonElement} */ (
        document.querySelector(`#pull-table thead [data-col="${name}"] button`)
      ).click()
    sortBy('review')
    sortBy('review')
    sortBy('points')
    expect(location.search).toBe('?sort=-review&sort=points')
    box('review').click()
    expect(location.search).toBe('?sort=points')
    expect(shownHead()).toEqual(['status', 'points', 'reviewed', 'ready', 'labels', 'canvas'])
    expect(page.rows()[0]?.children).toHaveLength(8)
    expect(document.getElementById('columns-label')?.textContent).toBe('6 of 7')
    document.getElementById('columns-none')?.click()
    expect(shownHead()).toEqual([])
    expect(page.rows()[0]?.children).toHaveLength(2)
    expect(document.getElementById('columns-label')?.textContent).toBe('None')
    document.getElementById('columns-all')?.click()
    expect(page.rows()[0]?.querySelector('.pending-pill')?.textContent).toBe('20')
    expect(page.rows()[0]?.querySelector('.pull-pending')).toBeNull()
    expect(document.getElementById('columns-label')?.textContent).toBe('All')
  })
})

describe('the filter builder on Your PRs', () => {
  it('keeps the drafts OR the PRs with reviewer attention points, from blocks a link carries', async () => {
    const where = JSON.stringify({
      op: 'or',
      items: [
        { field: 'state', is: 'any', values: ['draft'] },
        { field: 'reviewerPoints', is: 'any', values: ['yes'] },
      ],
    })
    history.replaceState(null, '', `/r/acme/widgets/?builder=1&where=${encodeURIComponent(where)}`)
    const pulls = [
      pull({ number: 3, canvas: 'Ready', points: { author: 0, reviewer: 2 } }),
      pull({ number: 2, isDraft: true }),
      pull({ number: 1, canvas: 'Ready', points: { author: 3, reviewer: 0 } }),
    ]
    const page = await loadPulls(pulls)
    expect(page.titles()).toEqual(['Synthetic change #3', 'Synthetic change #2'])
    expect(document.getElementById('bar-filters')?.hidden).toBe(true)
    expect(page.reset.hidden).toBe(false)
    history.replaceState(null, '', BASE)
  })

  it('asks AI for the blocks where an agent can run, through the project’s API', async () => {
    const page = await loadPulls(
      [pull({ number: 2, isDraft: true }), pull({ number: 1 })],
      undefined,
      undefined,
      {
        canGenerate: true,
      }
    )
    respond = url =>
      url.endsWith('/lists-builder/ask')
        ? Response.json({
            reply: 'Drafts only.',
            blocks: { op: 'and', items: [{ field: 'state', is: 'any', values: ['draft'] }] },
          })
        : Response.json({})
    document.getElementById('builder-toggle')?.click()
    document.getElementById('builder-chat-toggle')?.click()
    ;/** @type {HTMLTextAreaElement} */ (document.getElementById('builder-ask-input')).value = 'my drafts'
    document.getElementById('builder-ask')?.click()
    await vi.waitFor(() =>
      expect(document.getElementById('builder-talk')?.textContent).toContain('Drafts only.')
    )
    const asked = requests.find(r => r.url.endsWith('/lists-builder/ask'))
    expect([asked?.url, asked?.init?.method]).toEqual(['/r/acme/widgets/api/lists-builder/ask', 'POST'])
    document.getElementById('builder-done')?.click()
    expect(page.titles()).toEqual(['Synthetic change #2'])
    history.replaceState(null, '', BASE)
  })

  it('offers no Ask AI where no agent can run', async () => {
    await loadPulls([pull({ number: 1 })])
    expect(document.getElementById('builder-chat-toggle')).toBeNull()
  })
})

describe('review requests from the Pull requests page', () => {
  it('opens a row’s Reviewers panel on the tables, with who the PR asks and who can be asked', async () => {
    await loadPulls([pull({ number: 2 }), pull({ number: 1 })])
    const list = respond
    respond = (url, init) =>
      url.endsWith('/lists/pulls/2/reviewers')
        ? Response.json({ author: 'me', requested: ['ana'] })
        : url.includes('/lists/pulls/2/reviewers/people?')
          ? Response.json({ people: [{ login: 'ana' }, { login: 'bob' }], complete: true })
          : list(url, init)
    const toggle = /** @type {HTMLButtonElement} */ (
      document.querySelector('.row-actions .review-open[aria-label="Reviewers of #2"]')
    )
    toggle.click()
    for (let i = 0; i < 5; i++) await flush()
    const panel = /** @type {HTMLElement} */ (document.querySelector('main.lists > .review-panel'))
    expect(panel.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(requests.map(r => r.url)).toEqual(
      expect.arrayContaining([
        '/r/acme/widgets/api/lists/pulls/2/reviewers',
        '/r/acme/widgets/api/lists/pulls/2/reviewers/people?q=',
      ])
    )
    expect([...panel.querySelectorAll('.people-list label')].map(l => l.textContent?.trim())).toEqual([
      'ana',
      'bob',
    ])
  })
})
