// @ts-check
// @vitest-environment happy-dom
import { listsMain, projectTabs } from '../../../src/server/lists-html.ts'
import { SEARCH_DEBOUNCE_MS, SYNCING_RELOAD_MS } from './dom.js'
import { SEARCH_DELAY_MS } from './search.js'
import { flushSavedFilters, loadPresets, loadSearches, resetSavedFilters } from './filters.js'
import { resetGenerateDialogs } from './generate-dialog.js'
import { DEFAULT_PRIORITY_PROMPT } from './priority.js'
import { wireQueuePage } from './queue-page.js'

const REPO = { owner: 'acme', name: 'widgets' }
/** The project's base path on the server, which every link and API call starts with. */
const BASE = '/r/acme/widgets/'
/** A link's Reviews filter that keeps only the PRs awaiting your review. */
const AWAITING = 'reviews=requested'

/**
 * A reviewer with nothing done yet, but what `o` says.
 * @param {string} login
 * @param {Partial<import('./reviewers.js').Reviewer>} [o]
 * @returns {import('./reviewers.js').Reviewer}
 */
const makeReviewer = (login, o = {}) => ({
  login,
  kind: 'person',
  members: [],
  approvals: 0,
  changesRequested: 0,
  comments: 0,
  dismissed: 0,
  lastApprovalAt: null,
  lastChangeRequestAt: null,
  lastCommentAt: null,
  ...o,
})

/** @param {Partial<import('./queue.js').QueueRow>} o @returns {import('./queue.js').QueueRow} */
const row = o => ({
  number: 1,
  title: 'Their change',
  url: 'https://github.com/acme/widgets/pull/1',
  author: 'alice',
  isDraft: false,
  readyAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  headRefName: 'their-1',
  baseRefName: 'develop',
  labels: [],
  additions: 10,
  deletions: 2,
  requested: false,
  reviewers: [],
  canvas: 'Pending',
  // Not read here, but still in the row's type.
  codeRabbit: 'Pending',
  ...o,
})

const ROWS = [
  row({
    number: 512,
    title: 'Hotfix: token loop',
    author: 'dave',
    labels: ['Critical', 'bug', 'auth'],
    requested: true,
    canvas: 'Ready',
  }),
  row({
    number: 509,
    health: { ci: 'failing', failing: 2, stuck: null, conflict: true },
    title: 'Fix timezone',
    author: 'erin',
    labels: ['bug'],
    canvas: 'Stale',
    reviewers: [makeReviewer('me', { comments: 2, lastCommentAt: '2026-10-21T00:00:00Z' })],
  }),
  row({
    number: 505,
    title: 'Dark mode',
    author: 'bob',
    labels: ['frontend'],
    canvas: 'Ready',
  }),
  row({
    number: 503,
    title: 'Billing split',
    author: 'carol',
    headRefName: 'billing-2',
    baseRefName: 'billing-1',
    stack: { name: 'billing-1', position: 2, total: 2 },
  }),
]

/** @type {string[]} */
let asked
/** @type {Record<string, unknown>} */
let answer
/** @type {Map<string, string>} */
let store

beforeEach(() => {
  asked = []
  store = new Map()
  history.replaceState(null, '', '/r/acme/widgets/queue')
  answer = {
    rows: ROWS,
    // Fetched just now, as the rows' times count to the fetch.
    state: { fetchedAt: new Date().toISOString(), error: null, syncing: false },
    sections: [
      { name: 'Critical', labels: ['Critical'] },
      { name: 'Bugs', labels: ['bug'] },
      { name: 'Tasks', labels: [] },
    ],
    branches: [{ name: 'develop', color: 'green' }],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url) => {
      asked.push(url)
      const dialog = /\/lists-generate\/(\d+)\/dialog$/.exec(url)
      if (dialog !== null) {
        return Response.json({
          local: false,
          status: dialog[1] === '509' ? 'stale' : 'missing',
          skillCommand: `/pr-review-canvas ${dialog[1]}`,
          chat: { enabled: true, acpx: true, agent: 'claude', model: null },
          canvasComment: true,
        })
      }
      return Response.json(answer)
    })
  )
  vi.stubGlobal('localStorage', {
    getItem: (/** @type {string} */ k) => store.get(k) ?? null,
    setItem: (/** @type {string} */ k, /** @type {string} */ v) => store.set(k, v),
    removeItem: (/** @type {string} */ k) => store.delete(k),
  })
})

// A filter change goes to the server a moment later: it goes now, to this test's fetch.
afterEach(() => {
  flushSavedFilters()
  resetGenerateDialogs()
  vi.unstubAllGlobals()
})

/** Types `value` into a search box and waits out its debounce. */
const typeIn = async (/** @type {HTMLInputElement} */ input, /** @type {string} */ value) => {
  input.value = value
  input.dispatchEvent(new Event('input'))
  await new Promise(resolve => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 5))
}

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

const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

/** Draws the Review queue as the server does, then wires it; `canGenerate` says an agent can run here. */
async function load(canGenerate = true) {
  resetSavedFilters()
  const markup = String(
    await listsMain({
      tab: 'queue',
      owner: REPO.owner,
      repo: REPO.name,
      base: BASE,
      forge: 'GitHub',
      nounShort: 'PR',
      canGenerate,
      savedFilters: {},
    })
  )
  // The page shell's tab bar holds the tabs' counts.
  const tabs = String(await projectTabs({ base: BASE, nounShort: 'PR', tab: 'queue' }))
  document.body.innerHTML = tabs + markup
  await wireQueuePage(document)
  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id))
  return {
    get,
    numbers: () =>
      [...document.querySelectorAll('#queue-table .queue-row .pull-number')].map(n => n.textContent),
    sections: () => [...document.querySelectorAll('#queue-table .section-row')].map(s => s.textContent),
    click: (/** @type {string} */ id) => get(id).click(),
    check: (/** @type {string} */ panel, /** @type {string} */ text) => {
      const label = [...get(`${panel}-options`).querySelectorAll('label')].find(l =>
        l.textContent?.includes(text)
      )
      const box = /** @type {HTMLInputElement} */ (label?.querySelector('input'))
      box.checked = !box.checked
      box.dispatchEvent(new Event('change'))
    },
    /** Flips one choice of the Integrations filter. */
    integ: (/** @type {string} */ section, /** @type {string} */ value) => {
      const box = /** @type {HTMLInputElement} */ (
        document.querySelector(`input[data-section="${section}"][value="${value}"]`)
      )
      box.checked = !box.checked
      box.dispatchEvent(new Event('change'))
    },
    /** One section's choices, each with its count. */
    choices: (/** @type {string} */ section) =>
      [...document.querySelectorAll(`[data-integration="${section}"] label`)].map(l => l.textContent?.trim()),
  }
}

/**
 * Picks a choice from a builder condition's field menu, opening it first if it is not open.
 * @param {Element | undefined} cond @param {string} value
 */
const pickField = (cond, value) => {
  const opener = /** @type {HTMLButtonElement} */ (cond?.querySelector('.builder-field'))
  if (opener.getAttribute('aria-expanded') !== 'true') opener.click()
  ;/** @type {HTMLButtonElement} */ (
    [...document.querySelectorAll('.builder-menu .menu-item')].find(i =>
      /** @type {HTMLElement} */ (i).dataset['focus']?.endsWith(`:${value}`)
    )
  ).click()
}

describe('the Review queue', () => {
  it('shows the PR a link names in Linked here, whatever the filters, until you leave', async () => {
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    // A saved filter that hides #509.
    history.replaceState(null, '', `/r/acme/widgets/queue?${AWAITING}#pr-509`)
    const page = await load()
    expect(page.numbers()).toEqual(['#512'])
    const notified = /** @type {HTMLElement} */ (document.getElementById('queue-notified'))
    expect(notified.hidden).toBe(false)
    // The queue below gets its own heading, with what it shows.
    const heading = /** @type {HTMLElement} */ (document.getElementById('queue-main-heading'))
    expect([heading.hidden, heading.querySelector('.fold-button')?.textContent?.trim()]).toEqual([
      false,
      'Waiting for review 1',
    ])
    // The table follows the queue's sort; these rows' ready times tie, so compare them as a set.
    const rowsIn = () =>
      [...notified.querySelectorAll('.queue-row .pull-number')].map(n => n.textContent).sort()
    expect(rowsIn()).toEqual(['#509'])
    const linked = /** @type {HTMLElement} */ (document.getElementById('pr-509'))
    expect(notified.contains(linked)).toBe(true)
    expect(scrolled).toHaveBeenCalledWith({ block: 'center' })
    expect(linked.classList.contains('row-flash')).toBe(true)
    expect(document.activeElement).toBe(linked.querySelector('.pull-title'))
    // The link leaves the address, so a reload starts without the table; the filters stay.
    expect(`${location.pathname}${location.search}${location.hash}`).toBe(`/r/acme/widgets/queue?${AWAITING}`)
    // Another link joins it, in the queue's sort; one already in the queue keeps its
    // anchor here.
    location.hash = '#pr-512'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(rowsIn()).toEqual(['#509', '#512'])
    expect(document.querySelectorAll('[id="pr-512"]')).toHaveLength(1)
    expect(notified.contains(document.getElementById('pr-512'))).toBe(true)
    // A PR no longer in the queue says so.
    location.hash = '#pr-404'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    expect(document.getElementById('queue-target')?.textContent).toBe('#404 no longer waits for your review.')
    expect(rowsIn()).toEqual(['#509', '#512'])
    // Hide empties it.
    document.getElementById('queue-notified-hide')?.click()
    expect(notified.hidden).toBe(true)
    // The queue keeps its heading, which folds it.
    expect(heading.hidden).toBe(false)
  })

  it('lists the PRs in their sections, with the stacked ones apart', async () => {
    const page = await load()
    expect(asked[0]).toBe('/r/acme/widgets/api/lists/queue')
    expect(page.sections()).toEqual(['Critical · 1 PR', 'Bugs · 1 PR', 'Tasks · 1 PR'])
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    const first = /** @type {HTMLElement} */ (document.querySelector('#queue-table .queue-row'))
    // The title opens a menu of its canvas and GitHub; the same show as icons under it.
    const title = /** @type {HTMLElement} */ (first.querySelector('.pull-title'))
    expect([title.tagName, title.getAttribute('title')]).toEqual(['BUTTON', 'Choose where to open'])
    expect(first.querySelector('.quick-link[title="Open the canvas"]')?.getAttribute('href')).toBe(
      '/r/acme/widgets/review/512'
    )
    expect(first.querySelector('.quick-link[title="Open on GitHub"]')?.getAttribute('href')).toBe(
      'https://github.com/acme/widgets/pull/1'
    )
    // Actions opens a ready canvas, regenerates a stale one, and generates a missing one; the Canvas
    // column only says where each stands.
    const actions = (/** @type {string} */ id) =>
      [...(document.querySelector(`${id} .row-actions`)?.children ?? [])].map(a => [
        a.tagName,
        a.querySelector('.review-open')?.getAttribute('aria-label') ??
          (a.textContent?.trim() || a.getAttribute('title')),
        a.getAttribute('href'),
      ])
    // Each row can also change who it asks to review it, and be read again on its own.
    expect(actions('#pr-512')).toEqual([
      ['A', 'Open', '/r/acme/widgets/review/512'],
      ['SPAN', 'Reviewers of #512', null],
      ['BUTTON', 'Sync #512', null],
    ])
    expect(actions('#pr-509')).toEqual([
      ['BUTTON', 'Regenerate', null],
      ['SPAN', 'Reviewers of #509', null],
      ['BUTTON', 'Sync #509', null],
    ])
    expect(actions('#pr-503')).toEqual([
      ['BUTTON', 'Generate', null],
      ['SPAN', 'Reviewers of #503', null],
      ['BUTTON', 'Sync #503', null],
    ])
    const canvas = (/** @type {string} */ id) =>
      [...document.querySelectorAll(`${id} .canvas-state`)].map(c => c.textContent?.trim())
    expect(canvas('#pr-512')).toEqual(['Ready'])
    expect(canvas('#pr-509')).toEqual(['Stale'])
    expect(canvas('#pr-503')).toEqual(['Pending'])
    // Actions opens a ready canvas in a new tab.
    expect(document.querySelector('#pr-512 .row-actions a')?.getAttribute('target')).toBe('_blank')
    expect(document.querySelector('#queue-table thead th:last-child')?.textContent).toBe('Actions')
    // Awaiting your review shows in the Status column, not beside the title.
    expect(first.querySelector('.health [aria-label="Awaiting your review"]')).not.toBeNull()
    expect(first.querySelector('.queue-pr [aria-label="Awaiting your review"]')).toBeNull()
    // Every label shows, the section's own too.
    expect([...first.querySelectorAll('.label-badge')].map(b => b.textContent)).toEqual([
      'Critical',
      'bug',
      'auth',
    ])
    expect(first.querySelector('.pull-branch .pull-loc')?.getAttribute('aria-label')).toBe(
      '10 lines added, 2 deleted'
    )
    // Reviewed by has the same "?" legend as Pull requests, pointing at its own copy.
    const help = /** @type {HTMLElement} */ (
      document.querySelector('#queue-table th .help-button[aria-describedby^="reviewed-by"]')
    )
    expect(help.getAttribute('aria-label')).toBe('What the Reviewed by icons mean')
    expect(document.getElementById(help.getAttribute('aria-describedby') ?? '')?.closest('th')).not.toBeNull()
    expect([...first.querySelectorAll('.badge.ok')].map(b => b.textContent)).toEqual(['Ready'])
    expect(first.textContent).toContain('3h')
    expect(page.get('queue-stacked').hidden).toBe(false)
    expect(page.get('queue-stacked-count').textContent).toBe('1')
    const place = page.get('queue-stacked-table').querySelector('.pull-branch > .branch-head + .stack-pos')
    expect(place?.textContent).toBe('2/2')
    expect(place?.getAttribute('aria-label')).toBe('Stack billing-1, 2 of 2: filter by stack')
    expect(document.getElementById('nav-queue-count')?.textContent).toBe('4')
  })

  it('offers no generating where no agent can run, and hides Highest priority', async () => {
    await load(false)
    // Every row's Actions only opens, the stale and the missing alike, besides its own sync.
    for (const id of ['#pr-512', '#pr-509', '#pr-503']) {
      expect(
        [...(document.querySelector(`${id} .row-actions`)?.children ?? [])].map(a => [
          a.tagName,
          a.querySelector('.review-open')?.getAttribute('aria-label') ??
            (a.textContent?.trim() || a.getAttribute('title')),
        ])
      ).toEqual([
        ['A', 'Open'],
        ['SPAN', `Reviewers of ${id.replace('pr-', '')}`],
        ['BUTTON', `Sync ${id.replace('pr-', '')}`],
      ])
    }
    expect(document.querySelector('.row-actions button:not(.row-sync):not(.review-open)')).toBeNull()
    expect(document.getElementById('queue-priority')?.hidden).toBe(true)
  })

  it('filters by labels and the Integrations sections, and resets', async () => {
    const page = await load()
    // Every choice starts ticked; from None, each ticked one adds its PRs.
    expect(page.get('integrations-label').textContent).toBe('All')
    expect(page.get('review-filter-label').textContent).toBe('All')
    const review = (/** @type {string} */ key) => {
      const box = /** @type {HTMLInputElement} */ (
        document.querySelector(`#review-filter [data-review="${key}"]`)
      )
      box.checked = !box.checked
      box.dispatchEvent(new Event('change'))
    }
    expect([...document.querySelectorAll('#review-filter label')].map(l => l.textContent?.trim())).toEqual([
      'Approved',
      'Changes requested',
      'Commented',
      'No review',
      'Awaiting your review',
      'Not awaiting your review',
      'Author attention points',
      'Reviewer attention points',
    ])
    // The "?" at the end of the filter bar says how they combine.
    const help = /** @type {HTMLElement} */ (
      document.querySelector('.filter-bar [aria-describedby="filters-help"]')
    )
    expect(help.getAttribute('aria-label')).toBe('How the filters combine')
    expect(page.get('filters-help').textContent).toContain('passes every filter')
    expect(page.get('filters-help').textContent).toContain('any ticked choice is enough')
    page.click('reviews-none')
    expect(page.numbers()).toEqual([])
    review('requested')
    expect(page.numbers()).toEqual(['#512'])
    expect(page.get('review-filter-label').textContent).toBe('Awaiting your review')
    expect(new URLSearchParams(location.search).getAll('reviews')).toEqual(['requested'])
    // The review states are their own group: Commented alone, with Awaiting your review, keeps
    // none, as #509 has my comment but does not ask for me.
    review('commented')
    expect(page.numbers()).toEqual([])
    review('requested')
    expect(page.numbers()).toEqual(['#509'])
    // From everything ticked, unticking Not awaiting your review keeps what awaits you.
    page.click('reviews-all')
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    review('notRequested')
    expect(page.numbers()).toEqual(['#512'])
    expect(page.get('reset-filters').hidden).toBe(false)
    page.click('reset-filters')
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    expect(page.get('labels-label').textContent).toBe('All')
    page.check('labels', 'frontend')
    expect(page.numbers()).toEqual(['#512', '#509'])
    expect(page.get('labels-label').textContent).toBe('4 of 5')
    // None keeps nothing; ticking one keeps its PRs.
    page.click('labels-none')
    expect(page.numbers()).toEqual([])
    expect(page.get('labels-label').textContent).toBe('None')
    page.check('labels', 'frontend')
    expect(page.numbers()).toEqual(['#505'])
    expect(page.get('labels-label').textContent).toBe('frontend')
    page.check('labels', 'No labels')
    expect(page.get('queue-stacked-table').textContent).toContain('#503')
    page.click('labels-all')
    // The labels list is searchable, each with its count at the end.
    const search = /** @type {HTMLInputElement} */ (page.get('labels-search'))
    search.value = 'BU'
    search.dispatchEvent(new Event('input'))
    // Typing filters once it pauses, not on every keystroke.
    expect(page.get('labels-options').querySelectorAll('label').length).toBeGreaterThan(1)
    await new Promise(resolve => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 5))
    expect([...page.get('labels-options').querySelectorAll('label')].map(l => l.textContent?.trim())).toEqual(
      ['bug2']
    )
    await typeIn(search, 'zzz')
    expect(page.get('labels-options').textContent).toBe('No labels match.')
    await typeIn(search, '')
    // The Status filter has a section for the checks and one for the canvas, each choice with its count.
    expect([...document.querySelectorAll('[data-integration] > legend')].map(l => l.textContent)).toEqual([
      'Checks',
      'Canvas',
    ])
    expect(page.choices('canvas')).toEqual(['Ready2', 'Stale1', 'Pending1'])
    page.click('integrations-none')
    page.integ('canvas', 'Stale')
    expect(page.numbers()).toEqual(['#509'])
    expect(page.get('integrations-label').textContent).toBe('1 of 9')
    // Any ticked choice keeps a PR, from any section.
    page.integ('canvas', 'Stale')
    page.integ('github', 'conflict')
    expect(page.numbers()).toEqual(['#509'])
    page.integ('canvas', 'Ready')
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    page.click('integrations-all')
    expect(page.get('integrations-label').textContent).toBe('All')
    // Each choice counts the PRs in its state; one no sync has read has no CI or merge state yet.
    expect(page.choices('github')).toEqual([
      'CI failing1',
      'CI passing0',
      'CI running0',
      'CI stuck0',
      'Merge conflict1',
      'No conflicts0',
    ])
    page.click('integrations-none')
    page.integ('github', 'conflict')
    expect(page.numbers()).toEqual(['#509'])
    expect(JSON.parse(store.get('pr-greenlight:filters:v1:acme/widgets:queue') ?? '{}').github).toEqual([
      'conflict',
    ])
    expect(new URLSearchParams(location.search).getAll('github')).toEqual(['conflict'])
    page.integ('github', 'failing')
    expect(page.numbers()).toEqual(['#509'])
    page.click('integrations-none')
    expect(page.numbers()).toEqual([])
    page.click('integrations-all')
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
  })

  it('sorts inside each section by stacked columns, each click adding, flipping or dropping one', async () => {
    answer = {
      ...answer,
      rows: [
        row({ number: 1, author: 'zed', canvas: 'Ready' }),
        row({ number: 2, author: 'amy', canvas: 'Pending' }),
        row({ number: 3, author: 'amy', canvas: 'Ready' }),
      ],
    }
    const page = await load()
    const header = (/** @type {string} */ words) =>
      /** @type {HTMLButtonElement} */ (
        [...document.querySelectorAll('#queue-table .sort-button')].find(b =>
          b.textContent?.startsWith(words)
        )
      )
    // No sorting at first: the queue's own order, and no Clear sort.
    expect(page.numbers()).toEqual(['#1', '#2', '#3'])
    expect(page.get('clear-sort').hidden).toBe(true)
    header('Author').click()
    expect(page.numbers()).toEqual(['#2', '#3', '#1'])
    expect(document.querySelector('#queue-table th[aria-sort="ascending"]')?.textContent).toBe('Author ↑')
    header('Canvas').click()
    expect(page.numbers()).toEqual(['#3', '#2', '#1'])
    expect([header('Author').textContent, header('Canvas').textContent]).toEqual(['Author ↑1', 'Canvas ↑2'])
    expect(header('Canvas').getAttribute('aria-label')).toBe('Sorted by canvas, ascending, 2 of 2')
    header('Author').click()
    expect(page.numbers()).toEqual(['#1', '#3', '#2'])
    expect(new URLSearchParams(location.search).getAll('sort')).toEqual(['-author', 'canvas'])
    // A third click takes the column out; Clear sort takes them all.
    header('Author').click()
    expect(page.numbers()).toEqual(['#1', '#3', '#2'])
    expect(header('Author').textContent).toBe('Author ↕')
    expect(page.get('clear-sort').hidden).toBe(false)
    page.click('clear-sort')
    expect(page.numbers()).toEqual(['#1', '#2', '#3'])
    expect(page.get('clear-sort').hidden).toBe(true)
  })

  it('picks authors, saves the pick as a named search, and applies saved searches', async () => {
    const page = await load()
    page.click('authors-button')
    expect(page.get('authors-panel').hidden).toBe(false)
    const people = () => [...page.get('people-list').querySelectorAll('label')]
    expect(people().map(p => p.textContent?.trim())).toEqual(['bob1', 'carol1', 'dave1', 'erin1'])
    expect(page.get('people-count').textContent).toBe('Everyone')
    page.click('people-none')
    expect(page.numbers()).toEqual([])
    const pick = (/** @type {string} */ login) => {
      const box = /** @type {HTMLInputElement} */ (
        people()
          .find(p => p.textContent?.includes(login))
          ?.querySelector('input')
      )
      box.checked = true
      box.dispatchEvent(new Event('change'))
    }
    pick('dave')
    pick('bob')
    expect(page.numbers()).toEqual(['#512', '#505'])
    expect(page.get('people-count').textContent).toBe('2 selected · Any of')
    const search = /** @type {HTMLInputElement} */ (page.get('people-search'))
    await typeIn(search, 'ER')
    expect(people().map(p => p.textContent?.trim())).toEqual(['erin1'])
    const saveAs = /** @type {HTMLInputElement} */ (page.get('save-as'))
    page.click('save-search')
    expect(loadSearches(REPO)).toEqual([])
    saveAs.value = 'Squad'
    page.click('save-search')
    expect(loadSearches(REPO)).toEqual([{ name: 'Squad', logins: ['dave', 'bob'] }])
    expect(page.get('authors-label').textContent).toBe('Squad · 2 people')
    const everyone = /** @type {HTMLButtonElement} */ (
      page.get('saved-options').querySelector('.saved-search')
    )
    everyone.click()
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    const squad = /** @type {HTMLButtonElement} */ (
      page.get('saved-options').querySelectorAll('.saved-search')[1]
    )
    squad.click()
    expect(page.numbers()).toEqual(['#512', '#505'])
  })

  it('saves the filters by name, searches them, applies one at a time, and deletes one', async () => {
    const page = await load()
    const save = /** @type {HTMLButtonElement} */ (page.get('presets-save'))
    const name = /** @type {HTMLInputElement} */ (page.get('presets-name'))
    const presets = () =>
      [...page.get('presets-list').querySelectorAll('.saved-search')].map(b => ({
        text: b.textContent,
        on: b.getAttribute('aria-pressed') === 'true',
      }))
    // Nothing to save at the defaults.
    expect(save.disabled).toBe(true)
    expect(page.get('presets-list').textContent).toBe('No saved filters yet.')
    page.click('labels-none')
    page.check('labels', 'bug')
    name.value = 'Bugs'
    save.click()
    page.click('reset-filters')
    page.click('labels-none')
    page.check('labels', 'frontend')
    name.value = 'Frontend'
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(loadPresets(REPO, 'queue').map(p => p.name)).toEqual(['Bugs', 'Frontend'])
    expect(page.get('presets-label').textContent).toBe('Frontend')
    expect(presets()).toEqual([
      { text: 'Bugs 1 filter', on: false },
      { text: 'Frontend 1 filter', on: true },
    ])
    // Applying one replaces every filter, so only it shows pressed.
    ;/** @type {HTMLButtonElement} */ (page.get('presets-list').querySelector('.saved-search')).click()
    expect(page.numbers()).toEqual(['#512', '#509'])
    expect(page.get('presets-label').textContent).toBe('Bugs')
    expect(presets().map(p => p.on)).toEqual([true, false])
    // Changing a filter lets go of it.
    page.check('labels', 'auth')
    expect(page.get('presets-label').textContent).toBe('None')
    expect(presets().map(p => p.on)).toEqual([false, false])
    // Pressing the applied one again clears the filters.
    ;/** @type {HTMLButtonElement} */ (page.get('presets-list').querySelector('.saved-search')).click()
    ;/** @type {HTMLButtonElement} */ (page.get('presets-list').querySelector('.saved-search')).click()
    expect(page.get('presets-label').textContent).toBe('None')
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    await typeIn(/** @type {HTMLInputElement} */ (page.get('presets-search')), 'FRONT')
    expect(presets().map(p => p.text)).toEqual(['Frontend 1 filter'])
    await typeIn(/** @type {HTMLInputElement} */ (page.get('presets-search')), 'zzz')
    expect(page.get('presets-list').textContent).toBe('No saved filters match.')
    await typeIn(/** @type {HTMLInputElement} */ (page.get('presets-search')), '')
    const remove = () =>
      /** @type {HTMLButtonElement} */ (
        page.get('presets-list').querySelector('[aria-label="Delete saved filter Bugs"]')
      ).click()
    // A delete asks first: Cancel keeps it, and the panel stays open.
    page.click('presets-button')
    expect(page.get('presets-panel').hidden).toBe(false)
    remove()
    const confirm = /** @type {HTMLDialogElement} */ (document.getElementById('confirm-dialog'))
    expect(confirm.open).toBe(true)
    expect(confirm.textContent).toContain('“Bugs”')
    page.click('confirm-cancel')
    await flush()
    expect(confirm.open).toBe(false)
    expect(page.get('presets-panel').hidden).toBe(false)
    expect(loadPresets(REPO, 'queue').map(p => p.name)).toEqual(['Bugs', 'Frontend'])
    remove()
    page.click('confirm-ok')
    await flush()
    expect(loadPresets(REPO, 'queue').map(p => p.name)).toEqual(['Frontend'])
  })

  it('shows CI failing, CI stuck and a conflict side by side in the Status column', async () => {
    answer = {
      ...answer,
      rows: [
        row({ number: 509, health: { ci: 'failing', failing: 1, stuck: null, conflict: true } }),
        row({
          number: 510,
          health: { ci: 'running', failing: 0, stuck: 'checks queued, none running', conflict: false },
        }),
      ],
    }
    await load()
    const marks = (/** @type {string} */ id) =>
      [...(document.getElementById(id)?.querySelectorAll('.health-mark') ?? [])].map(m =>
        m.getAttribute('title')
      )
    expect(marks('pr-509')).toEqual(['CI failing: 1 check failed', 'Merge conflict with its base branch'])
    expect(marks('pr-510')).toEqual(['CI stuck: checks queued, none running'])
    const status = /** @type {HTMLElement} */ ([...document.querySelectorAll('#queue-table thead th')][1])
    expect(status.querySelector('button')?.textContent).toBe('Status ↕')
    const help = /** @type {HTMLElement} */ (status.querySelector('.help-button'))
    expect(help.getAttribute('aria-label')).toBe('What the Status icons mean')
    const legend = document.getElementById(help.getAttribute('aria-describedby') ?? '')
    expect(legend?.querySelector('.legend li')?.textContent).toBe('Asks you by name for your review')
  })

  it('opens a menu from the title, Canvas first, that stays until you pick, click away or press Escape', async () => {
    await load()
    const queued = /** @type {HTMLElement} */ (document.getElementById('pr-509'))
    const title = /** @type {HTMLButtonElement} */ (queued.querySelector('button.pull-title'))
    const menu = /** @type {HTMLElement} */ (queued.querySelector('[role="menu"]'))
    expect(menu.hidden).toBe(true)
    title.click()
    expect([menu.hidden, title.getAttribute('aria-expanded')]).toEqual([false, 'true'])
    const items = [...menu.querySelectorAll('[role="menuitem"]')]
    expect(items.map(i => i.textContent)).toEqual(['Canvas', 'GitHub'])
    expect(items.every(i => i.querySelector('svg') !== null)).toBe(true)
    // Both open in a new tab, each ending with the arrow that says so.
    expect([items[0]?.getAttribute('href'), items[0]?.getAttribute('target')]).toEqual([
      '/r/acme/widgets/review/509',
      '_blank',
    ])
    expect(items.map(i => i.lastElementChild?.classList.contains('menu-out'))).toEqual([true, true])
    expect(document.activeElement).toBe(items[0])
    const github = /** @type {HTMLAnchorElement} */ (items[1])
    expect([github.getAttribute('href'), github.target]).toEqual([
      'https://github.com/acme/widgets/pull/1',
      '_blank',
    ])
    // Arrows move between them, round; a click inside keeps it open.
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(document.activeElement).toBe(github)
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    expect(document.activeElement).toBe(items[0])
    menu.click()
    expect(menu.hidden).toBe(false)
    // Escape closes it and gives focus back to the title; so does a click elsewhere.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect([menu.hidden, document.activeElement]).toEqual([true, title])
    title.click()
    document.body.click()
    expect(menu.hidden).toBe(true)
    // GitHub closes it as it opens.
    title.click()
    github.addEventListener('click', event => event.preventDefault())
    github.click()
    expect(menu.hidden).toBe(true)
    // Clicking the title again closes its own menu.
    title.click()
    title.click()
    expect(menu.hidden).toBe(true)
  })

  it('shows the Canvas column and filter, and never CodeRabbit or Vercel', async () => {
    await load()
    for (const service of ['codeRabbit', 'vercel'])
      expect(document.querySelector(`[data-integration="${service}"]`)).toBeNull()
    expect(/** @type {HTMLElement} */ (document.querySelector('[data-integration="canvas"]')).hidden).toBe(
      false
    )
    expect(document.querySelector('#queue-table [aria-label="Sort by coderabbit"]')).toBeNull()
    expect(document.querySelector('#queue-table [aria-label="Sort by canvas"]')).not.toBeNull()
    expect(document.querySelector('#queue-table .section-row th')?.getAttribute('colspan')).toBe('9')
    expect(document.querySelector('#queue-table tbody tr.queue-row')?.children.length).toBe(9)
    // Section rows stick under the column header, as far down as it is tall.
    expect(document.getElementById('queue-table')?.style.getPropertyValue('--head-height')).toMatch(
      /^[\d.]+px$/
    )
    // Columns offers Canvas, not CodeRabbit.
    expect(
      [...document.querySelectorAll('#columns-options input')].map(i => i.getAttribute('data-column'))
    ).toEqual(['status', 'points', 'reviewed', 'author', 'ready', 'labels', 'canvas'])
  })

  it('loads again while the server is still reading the queue, and stops once it is in', async () => {
    answer = { ...answer, state: { fetchedAt: new Date().toISOString(), error: null, syncing: true } }
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    try {
      const page = await load()
      expect(asked).toHaveLength(1)
      answer = {
        ...answer,
        rows: ROWS.slice(0, 1),
        state: { fetchedAt: new Date().toISOString(), error: null, syncing: false },
      }
      await vi.advanceTimersByTimeAsync(SYNCING_RELOAD_MS)
      expect(asked).toHaveLength(2)
      expect(page.numbers()).toEqual(['#512'])
      await vi.advanceTimersByTimeAsync(SYNCING_RELOAD_MS * 2)
      expect(asked).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the generate dialog from Regenerate in its Actions', async () => {
    await load()
    const go = /** @type {HTMLButtonElement} */ (
      document.querySelector('#pr-509 .row-actions .canvas-action')
    )
    expect([go.tagName, go.textContent?.trim(), go.title]).toEqual([
      'BUTTON',
      'Regenerate',
      'Generate a canvas for its head commit',
    ])
    go.click()
    await flush()
    expect(asked).toContain('/r/acme/widgets/api/lists-generate/509/dialog')
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([])
    const dialog = document.getElementById('generate-dialog')
    expect(dialog?.hasAttribute('open')).toBe(true)
    expect(dialog?.querySelector('h2')?.textContent).toBe('Update the canvas')
  })

  it('opens the generate dialog from Generate for a PR with no canvas', async () => {
    await load()
    const go = /** @type {HTMLButtonElement} */ (
      document.querySelector('#pr-503 .row-actions .canvas-action')
    )
    expect([go.tagName, go.textContent?.trim(), go.title]).toEqual([
      'BUTTON',
      'Generate',
      'Generate its canvas',
    ])
    go.click()
    await flush()
    expect(asked).toContain('/r/acme/widgets/api/lists-generate/503/dialog')
    expect(document.getElementById('generate-dialog')?.querySelector('h2')?.textContent).toBe(
      'Generate the canvas'
    )
  })

  it('offers Stop from Actions while its generation runs, which loads the queue again', async () => {
    answer = {
      ...answer,
      rows: [
        row({
          number: 505,
          labels: ['bug'],
          canvas: 'Ready',
          generation: { state: 'running', phase: 'generating', startedAt: new Date().toISOString() },
        }),
      ],
    }
    // Fake timers hold the reload a generation under way schedules, so it runs into no later test.
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    try {
      await load()
      const before = asked.filter(u => u.endsWith('/lists/queue')).length
      const stop = /** @type {HTMLButtonElement} */ (
        document.querySelector('#pr-505 .row-actions .canvas-action')
      )
      expect([stop.tagName, stop.textContent?.trim(), stop.title]).toEqual([
        'BUTTON',
        'Stop',
        'Stop the generation',
      ])
      stop.click()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(0)
      expect(
        vi
          .mocked(fetch)
          .mock.calls.filter(([, init]) => init?.method === 'DELETE')
          .map(([url]) => url)
      ).toEqual(['/r/acme/widgets/api/lists-generate/505'])
      expect(asked.filter(u => u.endsWith('/lists/queue')).length).toBe(before + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows and sorts by each PR’s open attention points, a dash with no canvas here', async () => {
    answer = {
      ...answer,
      sections: [{ name: 'Tasks', labels: [] }],
      rows: [
        row({ number: 3, canvas: 'Ready', points: { author: 1, reviewer: 0 } }),
        row({ number: 2 }),
        row({ number: 1, canvas: 'Ready', points: { author: 2, reviewer: 1 } }),
      ],
    }
    await load()
    const points = () =>
      [...document.querySelectorAll('#queue-table .queue-row')].map(r => [
        r.querySelector('.pull-number')?.textContent,
        r.children[2]?.textContent,
      ])
    // One pill holds both numbers, split by a drawn line rather than a "|".
    const pill = document.querySelector('#pr-1 .pending-pill')
    expect(pill?.querySelector('.pending-divider')?.getAttribute('aria-hidden')).toBe('true')
    expect([...(pill?.querySelectorAll('.pending-count') ?? [])].map(c => c.getAttribute('title'))).toEqual([
      '2 for the author',
      '1 for the reviewer',
    ])
    const header = () =>
      /** @type {HTMLButtonElement} */ (
        document.querySelector('#queue-table thead [data-col="points"] button')
      )
    header().click()
    expect(points()).toEqual([
      ['#2', '—'],
      ['#3', '10'],
      ['#1', '21'],
    ])
    header().click()
    expect(points().map(p => p[0])).toEqual(['#1', '#3', '#2'])
    // The Pending column is gone.
    expect(document.querySelector('#queue-table [aria-label="Sort by pending"]')).toBeNull()
    expect(document.querySelector('#queue-table .pull-pending')).toBeNull()
  })

  it('loads again while a canvas generation is under way, and stops once it ends', async () => {
    answer = {
      ...answer,
      rows: [
        row({
          number: 509,
          labels: ['bug'],
          generation: { state: 'running', phase: 'generating', startedAt: new Date().toISOString() },
        }),
      ],
    }
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    try {
      await load()
      expect(asked).toHaveLength(1)
      expect(document.querySelector('#pr-509 .canvas-running')?.textContent?.trim()).toBe('Generating')
      answer = {
        ...answer,
        rows: [
          row({
            number: 509,
            labels: ['bug'],
            generation: { state: 'running', phase: 'publishing', startedAt: new Date().toISOString() },
          }),
        ],
      }
      await vi.advanceTimersByTimeAsync(SYNCING_RELOAD_MS)
      expect(asked).toHaveLength(2)
      expect(document.querySelector('#pr-509 .canvas-state')?.getAttribute('title')).toMatch(
        /^Publishing, since /
      )
      answer = { ...answer, rows: [row({ number: 509, labels: ['bug'], canvas: 'Ready' })] }
      await vi.advanceTimersByTimeAsync(SYNCING_RELOAD_MS)
      expect(asked).toHaveLength(3)
      expect(document.querySelector('#pr-509 .canvas-state')?.textContent).toBe('Ready')
      await vi.advanceTimersByTimeAsync(SYNCING_RELOAD_MS * 2)
      expect(asked).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the PRs with reviewer attention points, and with both boxes the PRs with both kinds', async () => {
    answer = {
      ...answer,
      rows: [
        row({ number: 21, labels: ['bug'], canvas: 'Ready', points: { author: 3, reviewer: 5 } }),
        row({ number: 22, labels: ['bug'], canvas: 'Ready', points: { author: 0, reviewer: 9 } }),
        row({ number: 23, labels: ['bug'] }),
        row({ number: 24, labels: ['bug'], canvas: 'Ready', points: { author: 1, reviewer: 0 } }),
      ],
    }
    const page = await load()
    const flag = (/** @type {string} */ key) => {
      const box = /** @type {HTMLInputElement} */ (
        document.querySelector(`#review-filter [data-filter="${key}"]`)
      )
      box.checked = !box.checked
      box.dispatchEvent(new Event('change'))
    }
    flag('reviewerPoints')
    expect(page.numbers()).toEqual(['#21', '#22'])
    expect(page.get('review-filter-label').textContent).toBe('All · Reviewer points')
    expect(new URLSearchParams(location.search).get('reviewerPoints')).toBe('1')
    flag('authorPoints')
    expect(page.numbers()).toEqual(['#21'])
    expect(page.get('review-filter-label').textContent).toBe('All · 2 more')
    page.click('reset-filters')
    expect(page.numbers()).toEqual(['#21', '#22', '#23', '#24'])
  })

  it('turns columns on and off with All and None, keeping Pull request and Actions', async () => {
    await load()
    const head = () =>
      [...document.querySelectorAll('#queue-table thead th')].map(th =>
        th.textContent?.replace(/ [↕↑↓][\s\S]*$/, '').trim()
      )
    const box = (/** @type {string} */ name) =>
      /** @type {HTMLInputElement} */ (document.querySelector(`#columns-options [data-column="${name}"]`))
    expect(document.getElementById('columns-label')?.textContent).toBe('All')
    // Sorted by Labels and Author, hiding Labels takes it out of the sort; Author still sorts.
    const sortBy = (/** @type {string} */ name) =>
      /** @type {HTMLButtonElement} */ (
        document.querySelector(`#queue-table [aria-label="Sort by ${name}"]`)
      ).click()
    sortBy('labels')
    sortBy('author')
    expect(location.search).toBe('?sort=labels&sort=author')
    box('labels').click()
    expect(location.search).toBe('?sort=author')
    expect(head()).not.toContain('Labels')
    expect(document.getElementById('columns-label')?.textContent).toBe('6 of 7')
    expect(document.querySelector('#pr-512 .label-badge')).toBeNull()
    expect(JSON.parse(store.get('pr-greenlight:columns:v1:acme/widgets') ?? '{}')).toEqual({
      queue: ['labels'],
    })
    document.getElementById('columns-none')?.click()
    expect(head()).toEqual(['Pull request', 'Actions'])
    expect(document.getElementById('columns-label')?.textContent).toBe('None')
    expect(document.querySelector('#pr-512')?.children).toHaveLength(2)
    expect(document.querySelector('#queue-table .section-row th')?.getAttribute('colspan')).toBe('2')
    // A reload keeps them hidden.
    await load()
    expect(head()).toEqual(['Pull request', 'Actions'])
    document.getElementById('columns-all')?.click()
    expect(head()).toHaveLength(9)
    box('points').click()
    box('points').click()
    expect(head()).toContain('Attention points')
    expect(head()).not.toContain('Pending')
    expect(store.has('pr-greenlight:columns:v1:acme/widgets')).toBe(false)
  })

  it('says when nobody waits, when filters hide everything, while loading, and on a failed fetch', async () => {
    answer = { ...answer, rows: [], state: { fetchedAt: null, error: null } }
    let page = await load()
    expect(page.get('queue-empty').textContent).toBe('Syncing…')
    answer = { ...answer, state: { fetchedAt: '2026-10-22T12:00:00Z', error: 'rate limited' } }
    page = await load()
    expect(page.get('queue-empty').textContent).toBe('Nobody is waiting on your review in acme/widgets.')
    expect(page.get('queue-error').textContent).toBe('The review queue could not be fetched: rate limited')
    answer = { ...answer, rows: [ROWS[3]] }
    page = await load()
    expect(page.get('queue-empty').textContent).toBe('Every PR shown is stacked on another branch.')
    answer = { ...answer, rows: ROWS }
    page = await load()
    page.click('labels-none')
    page.check('labels', 'auth')
    page.integ('canvas', 'Ready')
    expect(page.get('queue-empty').textContent).toBe('No PRs match these filters.')
  })

  it('shows open PRs by default, drafts with Draft ticked, counting each, and keeps the choice', async () => {
    answer = {
      ...answer,
      rows: [...ROWS, row({ number: 520, title: 'Draft idea', author: 'bob', isDraft: true })],
    }
    let page = await load()
    const count = (/** @type {string} */ s) => document.querySelector(`[data-count="${s}"]`)?.textContent
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    expect(document.getElementById('state-label')?.textContent).toBe('Open, Queued')
    expect([count('open'), count('draft'), count('queued')]).toEqual(['4', '1', '0'])
    // Drafts wait for nobody yet, so the nav leaves them out.
    expect(document.getElementById('nav-queue-count')?.textContent).toBe('4')
    expect(page.get('reset-filters').hidden).toBe(true)
    pickState('draft')
    expect(page.numbers()).toEqual(['#520'])
    expect(document.querySelector('#pr-520 .pull-state')?.getAttribute('aria-label')).toBe('Draft')
    expect(location.search).toBe('?state=draft')
    expect(page.get('reset-filters').hidden).toBe(false)
    // A reload keeps it; Reset goes back to Open.
    page = await load()
    expect(page.numbers()).toEqual(['#520'])
    pickState('both')
    expect(page.numbers()).toEqual(['#512', '#509', '#505', '#520'])
    expect(document.querySelectorAll('.pull-state[aria-label="Draft"]')).toHaveLength(1)
    page.get('reset-filters').click()
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    expect(location.search).toBe('')
  })

  it('says why the list is empty for each state', async () => {
    answer = { ...answer, rows: [row({ number: 520, isDraft: true })] }
    let page = await load()
    expect(page.get('queue-empty').textContent).toBe('Nobody is waiting on your review in acme/widgets.')
    answer = { ...answer, rows: [] }
    page = await load()
    pickState('draft')
    expect(page.get('queue-empty').textContent).toBe('Nobody else has a draft PR in acme/widgets.')
    pickState('both')
    expect(page.get('queue-empty').textContent).toBe('Nobody else has an open PR in acme/widgets.')
    pickState('queued')
    expect(page.get('queue-empty').textContent).toBe(
      'Nobody else has a PR in the merge queue in acme/widgets.'
    )
    pickState('open')
    expect(page.get('queue-empty').textContent).toBe('Nobody is waiting on your review in acme/widgets.')
    expect(location.search).toBe('?state=open')
  })

  it('keeps PRs in the merge queue under Queued, showing how long each has waited there', async () => {
    const queuedAt = new Date(Date.now() - 40 * 60_000).toISOString()
    answer = { ...answer, rows: [...ROWS, row({ number: 530, title: 'Queued one', queuedAt })] }
    const page = await load()
    const count = (/** @type {string} */ s) => document.querySelector(`[data-count="${s}"]`)?.textContent
    // Open and Queued show to start, as queued PRs showed before.
    expect(page.numbers()).toContain('#530')
    expect([count('open'), count('queued')]).toEqual(['4', '1'])
    // Queued, Ready links to the merge queue on GitHub, in a new tab, its tooltip ending in the arrow.
    const ready = /** @type {HTMLAnchorElement} */ (document.querySelector('#pr-530 .ready-queued'))
    expect([ready.textContent, ready.title, ready.dataset['tipIcon'], ready.target]).toEqual([
      '40m',
      'Open merge queue',
      'arrowUpRight',
      '_blank',
    ])
    expect(ready.getAttribute('href')).toBe('https://github.com/acme/widgets/queue/develop')
    expect(ready.getAttribute('aria-label')).toBe('Open merge queue: in it for 40m')
    expect(ready.querySelector('svg')).not.toBeNull()
    // Each row's title has its state's mark before it, as on Your PRs.
    const mark = (/** @type {string} */ id) => document.querySelector(`${id} .pull-state`)
    expect([mark('#pr-530')?.getAttribute('aria-label'), mark('#pr-530')?.getAttribute('class')]).toEqual([
      'Queued',
      'pull-state warn',
    ])
    expect(mark('#pr-512')?.getAttribute('aria-label')).toBe('Open')
    // Its tooltip says the state too.
    expect([mark('#pr-512')?.getAttribute('title'), mark('#pr-530')?.getAttribute('title')]).toEqual([
      'Open',
      'Queued',
    ])
    expect(mark('#pr-530')?.querySelector('svg')).not.toBeNull()
    pickState('queued')
    expect(page.numbers()).toEqual(['#530'])
    expect(document.getElementById('state-label')?.textContent).toBe('Queued')
  })

  it('reads saved searches defensively', () => {
    resetSavedFilters()
    const key = 'pr-greenlight:author-searches:v1:acme/widgets'
    store.set(key, '{"not":"a list"}')
    expect(loadSearches(REPO)).toEqual([])
    store.set(key, '[{"name":"A","logins":["x"]},{"name":1},null,{"name":"B","logins":[2]}]')
    expect(loadSearches(REPO)).toEqual([{ name: 'A', logins: ['x'] }])
    store.set(key, 'not json')
    expect(loadSearches(REPO)).toEqual([])
  })
  it('folds each table from its heading and each section from its row, and keeps them folded', async () => {
    let page = await load()
    const mainFold = /** @type {HTMLElement} */ (document.querySelector('#queue-main-heading .fold-button'))
    mainFold.click()
    expect(mainFold.getAttribute('aria-expanded')).toBe('false')
    expect(page.get('queue-main-body').hidden).toBe(true)
    mainFold.click()
    expect(page.get('queue-main-body').hidden).toBe(false)
    // A folded section keeps its row and its count, and loses its PRs; the others stay.
    const bugs = () =>
      /** @type {HTMLButtonElement} */ (
        [...document.querySelectorAll('#queue-table .section-fold')].find(b =>
          b.textContent?.includes('Bugs')
        )
      )
    bugs().click()
    expect(page.numbers()).toEqual(['#512', '#505'])
    expect(page.sections()).toEqual(['Critical · 1 PR', 'Bugs · 1 PR', 'Tasks · 1 PR'])
    expect(bugs().getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(bugs())
    document.querySelector('#queue-stacked-heading .fold-button')?.dispatchEvent(new MouseEvent('click'))
    expect(page.get('queue-stacked-table').hidden).toBe(true)
    // Folds are the repo's, kept like its columns.
    expect(JSON.parse(store.get('pr-greenlight:folds:v1:acme/widgets') ?? '{}')).toEqual({
      queue: ['section:bugs', 'stacked'],
    })
    // The table's fold is in the address; the section's stays saved only.
    expect(new URLSearchParams(location.search).getAll('fold')).toEqual(['stacked'])
    page = await load()
    expect(page.numbers()).toEqual(['#512', '#505'])
    expect(page.get('queue-stacked-table').hidden).toBe(true)
    bugs().click()
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    expect(new URLSearchParams(location.search).getAll('fold')).toEqual(['stacked'])
  })

  it('follows a link’s fold: Highest priority shut, the other tables open, ahead of the ones saved', async () => {
    store.set(
      'pr-greenlight:folds:v1:acme/widgets',
      JSON.stringify({ queue: ['main', 'stacked', 'section:bugs'] })
    )
    history.replaceState(null, '', '/r/acme/widgets/queue?fold=priority')
    const page = await load()
    const expanded = (/** @type {string} */ id) =>
      document.querySelector(`#${id} .fold-button`)?.getAttribute('aria-expanded')
    expect(expanded('queue-priority-heading')).toBe('false')
    expect(page.get('queue-priority-body').hidden).toBe(true)
    expect(expanded('queue-main-heading')).toBe('true')
    expect(page.get('queue-main-body').hidden).toBe(false)
    expect(expanded('queue-stacked-heading')).toBe('true')
    expect(page.get('queue-stacked-table').hidden).toBe(false)
    expect(expanded('queue-notified-heading')).toBe('true')
    expect(page.numbers()).toEqual(['#512', '#505'])
    expect(new URLSearchParams(location.search).getAll('fold')).toEqual(['priority'])
    // Saved table folds stay until a fold here changes them.
    expect(JSON.parse(store.get('pr-greenlight:folds:v1:acme/widgets') ?? '{}')).toEqual({
      queue: ['main', 'stacked', 'section:bugs'],
    })
    document.querySelector('#queue-main-heading .fold-button')?.dispatchEvent(new MouseEvent('click'))
    expect(new URLSearchParams(location.search).getAll('fold')).toEqual(['priority', 'main'])
    document.querySelector('#queue-priority-heading .fold-button')?.dispatchEvent(new MouseEvent('click'))
    document.querySelector('#queue-main-heading .fold-button')?.dispatchEvent(new MouseEvent('click'))
    expect(new URLSearchParams(location.search).has('fold')).toBe(false)
    expect(JSON.parse(store.get('pr-greenlight:folds:v1:acme/widgets') ?? '{}')).toEqual({
      queue: ['section:bugs'],
    })
  })

  it('keeps an empty fold in the address, so every table stays open', async () => {
    store.set('pr-greenlight:folds:v1:acme/widgets', JSON.stringify({ queue: ['main', 'priority'] }))
    history.replaceState(null, '', '/r/acme/widgets/queue?fold=')
    const page = await load()
    expect(page.get('queue-main-body').hidden).toBe(false)
    expect(page.get('queue-priority-body').hidden).toBe(false)
    expect(location.search).toBe('?fold=')
  })

  it('opens Linked here when a link names a PR, folded or not', async () => {
    store.set('pr-greenlight:folds:v1:acme/widgets', JSON.stringify({ queue: ['notified'] }))
    history.replaceState(null, '', '/r/acme/widgets/queue#pr-509')
    Element.prototype.scrollIntoView = vi.fn()
    const page = await load()
    expect(page.get('queue-notified-body').hidden).toBe(false)
  })

  describe('Highest priority', () => {
    const PRIORITY = {
      prompts: [
        { name: 'Default', prompt: DEFAULT_PRIORITY_PROMPT },
        { name: 'Bugs', prompt: 'Bugs first.' },
      ],
      active: 'Bugs',
      prompt: 'Bugs first.',
      count: 2,
      syncedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      picks: [
        { number: 505, why: 'Small and waiting longest.' },
        { number: 404, why: 'Gone from the queue.' },
        { number: 512, why: 'Critical, and asks for you.' },
        { number: 509, why: 'Past the count.' },
      ],
      error: null,
      syncing: false,
      stale: false,
    }
    const picked = () =>
      [...document.querySelectorAll('#queue-priority-table .queue-row')].map(r => [
        r.querySelector('.pull-number')?.textContent,
        r.querySelector('.priority-why')?.textContent,
      ])

    it('shows Claude’s picks still in the queue, in its order, up to the count, whatever the filters', async () => {
      answer = { ...answer, priority: PRIORITY }
      history.replaceState(null, '', `/r/acme/widgets/queue?${AWAITING}`)
      const page = await load()
      expect(page.numbers()).toEqual(['#512'])
      expect(picked()).toEqual([
        ['#505', 'Small and waiting longest.'],
        ['#512', 'Critical, and asks for you.'],
      ])
      expect(page.get('queue-priority-count').textContent).toBe('2')
      expect(page.get('queue-priority-when').textContent).toBe('Picked 5m ago')
      expect(page.get('queue-priority-note').textContent).toBe('')
      // Its order is Claude's: its header has no sort buttons, and its rows take no link's id.
      expect(document.querySelectorAll('#queue-priority-table th .sort-button')).toHaveLength(0)
      expect(document.querySelector('#queue-priority-table [id^="pr-"]')).toBeNull()
    })

    it('says what to do before the first sync, while it runs, when the prompt changed and when it failed', async () => {
      answer = { ...answer, priority: { ...PRIORITY, syncedAt: null, picks: [], count: 3 } }
      let page = await load()
      expect(page.get('queue-priority-table').hidden).toBe(true)
      expect(page.get('queue-priority-note').textContent).toBe(
        'Press sync to have AI pick up to 3 PRs to review first, by your prompt.'
      )
      answer = { ...answer, priority: { ...PRIORITY, syncedAt: null, picks: [], count: 1 } }
      page = await load()
      expect(page.get('queue-priority-note').textContent).toBe(
        'Press sync to have AI pick the PR to review first, by your prompt.'
      )
      // The clock stands still, so a slow run cannot tick past the second the label is read at.
      vi.useFakeTimers({ toFake: ['Date'] })
      answer = {
        ...answer,
        priority: { ...PRIORITY, syncing: true, syncStartedAt: new Date(Date.now() - 90_000).toISOString() },
      }
      try {
        page = await load()
        expect(/** @type {HTMLButtonElement} */ (page.get('queue-priority-sync')).disabled).toBe(true)
        // A sync started elsewhere counts from when it started.
        expect(page.get('queue-priority-when').textContent).toBe('Running for 1m 30s')
      } finally {
        vi.useRealTimers()
      }
      expect(page.get('queue-priority-note').textContent).toBe('AI is picking up to 2 PRs to review first…')
      answer = { ...answer, priority: { ...PRIORITY, stale: true, error: 'sign in to Claude first' } }
      page = await load()
      expect(page.get('queue-priority-note').textContent).toBe(
        'The prompt changed since these were picked: sync for new ones.'
      )
      expect(page.get('queue-priority-error').textContent).toBe('AI could not pick: sign in to Claude first')
      answer = { ...answer, priority: { ...PRIORITY, picks: [{ number: 404, why: 'Gone.' }] } }
      page = await load()
      expect(page.get('queue-priority-note').textContent).toBe(
        'The PRs AI picked no longer wait for your review: sync for new ones.'
      )
      // A pick that went back to draft no longer waits either.
      answer = {
        ...answer,
        rows: [row({ number: 520, isDraft: true })],
        priority: { ...PRIORITY, picks: [{ number: 520, why: 'Drafted again.' }] },
      }
      page = await load()
      expect(page.get('queue-priority-note').textContent).toBe(
        'The PRs AI picked no longer wait for your review: sync for new ones.'
      )
      answer = { ...answer, rows: ROWS }
      answer = { ...answer, priority: { ...PRIORITY, picks: [] } }
      page = await load()
      expect(page.get('queue-priority-note').textContent).toBe(
        'AI found no PR in the queue that fits your prompt.'
      )
    })

    it('asks Claude when its sync button is pressed, and shows the new picks', async () => {
      answer = { ...answer, priority: { ...PRIORITY, syncedAt: null, picks: [] } }
      const page = await load()
      /** @type {(value: Response) => void} */
      let finish = () => undefined
      vi.stubGlobal(
        'fetch',
        vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
          if (url.endsWith('/api/lists-priority/sync') && init?.method === 'POST') {
            return new Promise(resolve => (finish = resolve))
          }
          return Response.json(answer)
        })
      )
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
      page.click('queue-priority-sync')
      expect(page.get('queue-priority-sync').classList.contains('syncing')).toBe(true)
      // It counts how long Claude has been at it, each second.
      expect(page.get('queue-priority-when').textContent).toBe('Running for 0s')
      vi.advanceTimersByTime(65_000)
      expect(page.get('queue-priority-when').textContent).toBe('Running for 1m 5s')
      finish(Response.json({ ...PRIORITY, picks: [{ number: 509, why: 'Failing, but critical.' }] }))
      await flush()
      vi.useRealTimers()
      expect(page.get('queue-priority-sync').classList.contains('syncing')).toBe(false)
      expect(page.get('queue-priority-when').textContent).toMatch(/^Picked /)
      expect(picked()).toEqual([['#509', 'Failing, but critical.']])
      // A refusal says why.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json(
            { error: { code: 'BAD_REQUEST', message: 'Highest priority is already syncing' } },
            { status: 409 }
          )
        )
      )
      page.click('queue-priority-sync')
      await flush()
      expect(page.get('queue-priority-error').textContent).toBe(
        'AI could not pick: Highest priority is already syncing'
      )
      expect(picked()).toEqual([['#509', 'Failing, but critical.']])
    })

    it('edits the prompt and count, resets the default alone, and saves the defaults as none', async () => {
      answer = { ...answer, priority: PRIORITY }
      const page = await load()
      /** @type {unknown[]} */
      const sent = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
          if (url.endsWith('/api/lists-priority') && init?.method === 'PUT') {
            const body = JSON.parse(String(init.body))
            sent.push(body)
            return Response.json({
              ...PRIORITY,
              ...(body.priority ?? {
                prompts: [{ name: 'Default', prompt: DEFAULT_PRIORITY_PROMPT }],
                active: 'Default',
                count: 3,
              }),
            })
          }
          return Response.json(answer)
        })
      )
      const prompt = /** @type {HTMLTextAreaElement} */ (page.get('priority-prompt'))
      const name = /** @type {HTMLInputElement} */ (page.get('priority-name'))
      const count = /** @type {HTMLInputElement} */ (page.get('priority-count'))
      const type = (
        /** @type {HTMLInputElement | HTMLTextAreaElement} */ field,
        /** @type {string} */ value
      ) => {
        field.value = value
        field.dispatchEvent(new Event('input'))
      }
      const pick = (/** @type {string} */ label) => {
        const all = /** @type {HTMLButtonElement[]} */ ([
          ...document.querySelectorAll('#priority-list .priority-item-name'),
        ])
        all.find(x => x.textContent === label)?.click()
      }
      page.click('queue-priority-edit')
      expect([name.value, prompt.value, count.value]).toEqual(['Bugs', 'Bugs first.', '2'])
      count.value = '11'
      page.click('priority-save')
      expect(page.get('priority-error').textContent).toBe('Show 1 to 10 PRs.')
      type(prompt, '  Renames first. ')
      count.value = '1'
      page.click('priority-save')
      await flush()
      expect(sent.at(-1)).toEqual({
        priority: {
          prompts: [
            { name: 'Default', prompt: DEFAULT_PRIORITY_PROMPT },
            { name: 'Bugs', prompt: 'Renames first.' },
          ],
          active: 'Bugs',
          count: 1,
        },
      })
      expect(picked()).toEqual([['#505', 'Small and waiting longest.']])
      // The heading's button names the prompt in use, whole in its tooltip.
      expect(page.get('queue-priority-prompt').textContent).toBe('Bugs')
      expect(page.get('queue-priority-edit').title).toBe('Edit prompt: Bugs')
      // The default's text can change; Reset default puts it and the count back, and keeps the rest.
      page.click('queue-priority-edit')
      pick('Default')
      type(prompt, 'Mine.')
      count.value = '7'
      pick('Bugs')
      page.click('priority-reset')
      expect([name.value, prompt.value, count.value]).toEqual(['Default', DEFAULT_PRIORITY_PROMPT, '3'])
      page.click('priority-save')
      await flush()
      expect(sent.at(-1)).toEqual({
        priority: {
          prompts: [
            { name: 'Default', prompt: DEFAULT_PRIORITY_PROMPT },
            { name: 'Bugs', prompt: 'Renames first.' },
          ],
          active: 'Default',
          count: 3,
        },
      })
      expect(page.get('queue-priority-prompt').textContent).toBe('Default')
      // The default alone, as it ships, is saved as none.
      page.click('queue-priority-edit')
      ;/** @type {HTMLButtonElement} */ (
        document.querySelector('#priority-list [aria-label="Remove Bugs"]')
      ).click()
      page.click('confirm-ok')
      await flush()
      page.click('priority-save')
      await flush()
      expect(sent.at(-1)).toEqual({ priority: null })
    })

    it('keeps named prompts: adds, renames, picks the one in use, removes, and says which is wrong', async () => {
      answer = { ...answer, priority: PRIORITY }
      const page = await load()
      /** @type {unknown[]} */
      const sent = []
      vi.stubGlobal(
        'fetch',
        vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
          if (url.endsWith('/api/lists-priority') && init?.method === 'PUT') {
            const body = JSON.parse(String(init.body))
            sent.push(body)
            return Response.json({ ...PRIORITY, ...body.priority })
          }
          return Response.json(answer)
        })
      )
      const prompt = /** @type {HTMLTextAreaElement} */ (page.get('priority-prompt'))
      const name = /** @type {HTMLInputElement} */ (page.get('priority-name'))
      const type = (
        /** @type {HTMLInputElement | HTMLTextAreaElement} */ field,
        /** @type {string} */ value
      ) => {
        field.value = value
        field.dispatchEvent(new Event('input'))
      }
      const names = () =>
        [...document.querySelectorAll('#priority-list .priority-item-name')].map(b => b.textContent)
      const remove = (/** @type {string} */ label) =>
        /** @type {HTMLButtonElement | null} */ (
          document.querySelector(`#priority-list [aria-label="Remove ${label}"]`)
        )
      const pick = (/** @type {string} */ label) => {
        const all = /** @type {HTMLButtonElement[]} */ ([
          ...document.querySelectorAll('#priority-list .priority-item-name'),
        ])
        all.find(x => x.textContent === label)?.click()
      }
      const inUse = () => document.querySelector('#priority-list .picked .priority-item-name')?.textContent
      page.click('queue-priority-edit')
      expect(names()).toEqual(['Default', 'Bugs'])
      expect(inUse()).toBe('Bugs')
      // The default is never removed, and keeps its name.
      expect(remove('Default')).toBeNull()
      pick('Default')
      expect([name.value, name.disabled, inUse()]).toEqual(['Default', true, 'Default'])
      pick('Bugs')
      expect(name.disabled).toBe(false)
      page.click('priority-add')
      expect([name.value, prompt.value, inUse()]).toEqual(['New prompt', '', 'New prompt'])
      page.click('priority-save')
      expect(page.get('priority-error').textContent).toBe(
        'Write what makes a PR highest priority in “New prompt”.'
      )
      type(name, 'bugs')
      type(prompt, 'Security first.')
      expect(names()).toEqual(['Default', 'Bugs', 'bugs'])
      page.click('priority-save')
      expect(page.get('priority-error').textContent).toBe('Two prompts are named “bugs”.')
      type(name, '')
      page.click('priority-save')
      expect(page.get('priority-error').textContent).toBe('Prompt 3 needs a name.')
      type(name, 'Security')
      type(prompt, 'x'.repeat(4001))
      page.click('priority-save')
      expect(page.get('priority-error').textContent).toBe('Keep “Security” to 4000 characters.')
      type(prompt, 'Security first.')
      // An empty prompt goes at once; one with words asks first, and Cancel keeps it.
      page.click('priority-add')
      remove('New prompt')?.click()
      await flush()
      expect(page.get('confirm-dialog')).toBeNull()
      expect(names()).toEqual(['Default', 'Bugs', 'Security'])
      page.click('priority-add')
      type(prompt, 'Old.')
      remove('New prompt')?.click()
      expect(page.get('confirm-title').textContent).toBe('Remove prompt?')
      expect(page.get('confirm-text').textContent).toBe(
        '“New prompt” and its prompt will be removed. Nothing is saved until you press Save.'
      )
      page.click('confirm-cancel')
      await flush()
      expect(names()).toEqual(['Default', 'Bugs', 'Security', 'New prompt'])
      remove('New prompt')?.click()
      page.click('confirm-ok')
      await flush()
      // Removing the picked one picks the one before it.
      expect([names(), inUse()]).toEqual([['Default', 'Bugs', 'Security'], 'Security'])
      page.click('priority-save')
      await flush()
      expect(sent.at(-1)).toEqual({
        priority: {
          prompts: [
            { name: 'Default', prompt: DEFAULT_PRIORITY_PROMPT },
            { name: 'Bugs', prompt: 'Bugs first.' },
            { name: 'Security', prompt: 'Security first.' },
          ],
          active: 'Security',
          count: 2,
        },
      })
      // A refused save says why.
      page.click('queue-priority-edit')
      expect([name.value, inUse()]).toEqual(['Security', 'Security'])
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          Response.json({ error: { code: 'BAD_REQUEST', message: 'too long' } }, { status: 400 })
        )
      )
      page.click('priority-save')
      await flush()
      expect(page.get('priority-error').textContent).toBe('Not saved: too long')
      page.click('priority-cancel')
      expect(page.get('priority-dialog').hasAttribute('open')).toBe(false)
    })
  })

  it('filters by the builder blocks once Done is pressed, from where the bar was', async () => {
    const page = await load()
    const dialog = /** @type {HTMLDialogElement} */ (page.get('filter-builder'))
    page.click('labels-button')
    page.check('labels', 'frontend')
    expect(page.numbers()).toEqual(['#512', '#509'])

    // The draft starts from the bar: open, and the labels ticked. The page waits for Done.
    page.click('builder-toggle')
    expect(dialog.open).toBe(true)
    const conds = () => [...dialog.querySelectorAll('.builder-cond')]
    expect(
      conds().map(c => /** @type {HTMLElement} */ (c.querySelector('.builder-field')).dataset['value'])
    ).toEqual(['state', 'label'])
    // + Condition adds a line whose field is to pick; picking it opens its values.
    ;/** @type {HTMLButtonElement} */ (
      [...dialog.querySelectorAll('button')].find(b => b.textContent === '+ Condition')
    ).click()
    const field = /** @type {HTMLElement} */ (conds()[2]?.querySelector('.builder-field'))
    expect(field.dataset['value']).toBe('')
    pickField(conds()[2], 'author')
    const box = (/** @type {number} */ at, /** @type {string} */ text) =>
      /** @type {HTMLInputElement} */ (
        [...(conds()[at]?.querySelectorAll('.builder-options input') ?? [])].find(
          i => i.nextSibling?.textContent === ` ${text}`
        )
      )
    box(2, 'erin').checked = true
    box(2, 'erin').dispatchEvent(new Event('change'))
    expect(box(2, 'erin').checked).toBe(true)
    expect(page.get('builder-shown').textContent).toBe('1 match')
    expect(page.numbers()).toEqual(['#512', '#509'])
    expect(page.get('bar-filters').hidden).toBe(false)

    page.click('builder-done')
    expect(dialog.open).toBe(false)
    expect(page.numbers()).toEqual(['#509'])
    expect(page.get('bar-filters').hidden).toBe(true)
    expect(page.get('builder-toggle').getAttribute('aria-pressed')).toBe('true')
    expect(page.get('builder-label').textContent).toBe('Builder · 3 conditions')
    expect(new URL(location.href).searchParams.get('builder')).toBe('1')

    // OR: any one is enough, so every open PR shows (#503 is stacked, in its own table), on Done.
    page.click('builder-toggle')
    ;/** @type {HTMLButtonElement} */ (dialog.querySelector('[data-join="and"]')).click()
    expect(dialog.querySelectorAll('.builder-join-or')).toHaveLength(2)
    expect(page.numbers()).toEqual(['#509'])
    page.click('builder-done')
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])

    // Close drops the draft.
    page.click('builder-toggle')
    ;/** @type {HTMLButtonElement} */ (dialog.querySelector('.builder-cond .builder-remove')).click()
    expect(conds()).toHaveLength(2)
    page.click('builder-close')
    expect(dialog.open).toBe(false)
    page.click('builder-toggle')
    expect(conds()).toHaveLength(3)
    page.click('builder-close')

    // Reset shows while Builder is in use, and goes back to the filter bar at its defaults.
    expect(page.get('reset-filters').hidden).toBe(false)
    page.click('reset-filters')
    expect(page.get('bar-filters').hidden).toBe(false)
    expect(page.get('builder-label').textContent).toBe('Builder')
    expect(page.get('reset-filters').hidden).toBe(true)
    expect(page.get('labels-label').textContent).toBe('All')
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])

    // Use the filter bar instead turns Builder off, the bar as it was left.
    page.click('builder-toggle')
    page.click('builder-done')
    expect(page.get('bar-filters').hidden).toBe(true)
    expect(page.get('reset-filters').hidden).toBe(false)
    page.click('builder-toggle')
    page.click('builder-off')
    expect(dialog.open).toBe(false)
    expect(page.get('bar-filters').hidden).toBe(false)
    expect(page.get('builder-label').textContent).toBe('Builder')
  })

  it('reads one PR again from its row’s sync, then loads the queue again', async () => {
    const page = await load()
    const before = page.numbers()
    expect(before).toContain('#512')
    const button = /** @type {HTMLButtonElement} */ (
      document.querySelector('#queue-table .row-actions .row-sync[title="Sync #512"]')
    )
    // Merged meanwhile: the queue the server answers no longer has it.
    answer = { ...answer, rows: ROWS.slice(1) }
    const from = asked.length
    button.click()
    await flush()
    expect(asked.slice(from)).toEqual([`${BASE}api/lists/queue/512/sync`, `${BASE}api/lists/queue`])
    expect(page.numbers()).not.toContain('#512')
    expect(page.numbers()).toHaveLength(before.length - 1)
  })

  it("keeps the builder's menu open and focused when a sync redraws the page, and counts again", async () => {
    const page = await load()
    page.click('builder-toggle')
    const dialog = page.get('filter-builder')
    ;/** @type {HTMLButtonElement} */ (dialog.querySelector('.builder-field')).click()
    const focused = /** @type {HTMLElement} */ (document.activeElement)
    expect(focused.closest('.builder-menu')).not.toBeNull()
    answer = { ...answer, rows: ROWS.slice(0, 2) }
    page.get('main').dispatchEvent(new Event('pr-greenlight:synced'))
    await flush()
    // Drawn again with the new rows, the menu still open on the same choice.
    expect(page.get('builder-shown').textContent).toBe('2 matches')
    expect(dialog.querySelector('.builder-menu')).not.toBeNull()
    expect(/** @type {HTMLElement} */ (document.activeElement).dataset['focus']).toBe(
      focused.dataset['focus']
    )
    // In a list of values, a sync leaves the boxes alone and only counts again.
    ;/** @type {HTMLButtonElement} */ (dialog.querySelector('.builder-menu [aria-checked="true"]')).click()
    pickField(dialog.querySelector('.builder-cond') ?? undefined, 'author')
    const box = document.activeElement
    expect(box?.closest('.builder-values-panel')).not.toBeNull()
    page.get('main').dispatchEvent(new Event('pr-greenlight:synced'))
    await flush()
    expect(document.activeElement).toBe(box)
    page.click('builder-close')
  })

  it('asks Claude to fill the draft from what you describe, applying it only on Done', async () => {
    const page = await load()
    /** @type {unknown[]} */
    const sent = []
    let reply = /** @type {Record<string, unknown> | Error} */ ({
      reply: 'Open PRs by bob.',
      blocks: { op: 'and', items: [{ field: 'author', is: 'any', values: ['bob'] }] },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init) => {
        if (!url.endsWith('/api/lists-builder/ask')) return Response.json(answer)
        sent.push(JSON.parse(String(init.body)))
        return reply instanceof Error
          ? Response.json({ error: { code: 'INTERNAL', message: reply.message } }, { status: 502 })
          : Response.json(reply)
      })
    )
    page.click('builder-toggle')
    const chat = page.get('builder-chat')
    expect(chat.hidden).toBe(true)
    page.click('builder-chat-toggle')
    expect(chat.hidden).toBe(false)
    const input = /** @type {HTMLTextAreaElement} */ (page.get('builder-ask-input'))
    input.value = 'only bob'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(page.get('builder-talk').textContent).toContain('AI is filling the builder…')
    await flush()
    // What the builder offers went along, with the draft as it was.
    expect(sent[0]).toMatchObject({
      page: 'queue',
      messages: [{ from: 'you', text: 'only bob' }],
      current: { op: 'and', items: [{ field: 'state', is: 'any', values: ['open', 'queued'] }] },
    })
    const fields = /** @type {{ fields: { key: string, options: string[][] }[] }} */ (sent[0]).fields
    expect(fields.find(f => f.key === 'author')?.options).toContainEqual(['bob', 'bob'])
    expect([...page.get('builder-talk').querySelectorAll('.builder-msg')].map(m => m.textContent)).toEqual([
      'Youonly bob',
      'AIOpen PRs by bob.',
    ])
    const field = /** @type {HTMLElement} */ (page.get('filter-builder').querySelector('.builder-field'))
    expect(field.dataset['value']).toBe('author')
    expect(page.get('builder-shown').textContent).toBe('1 match')
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])

    // A failure puts your words back, says why, and keeps the draft.
    reply = new Error('AI could not fill the builder: acpx is not installed')
    input.value = 'and erin'
    page.click('builder-ask')
    await flush()
    expect(input.value).toBe('and erin')
    expect(page.get('builder-ask-error').textContent).toBe(
      'AI could not fill the builder: acpx is not installed'
    )
    expect(page.get('builder-talk').querySelectorAll('.builder-msg')).toHaveLength(2)

    page.click('builder-done')
    expect(page.numbers()).toEqual(['#505'])
  })

  it('marks a saved filter made in the builder, and puts its blocks back', async () => {
    const page = await load()
    page.click('builder-toggle')
    const dialog = /** @type {HTMLDialogElement} */ (page.get('filter-builder'))
    pickField(dialog.querySelector('.builder-cond') ?? undefined, 'author')
    // A new field opens its values.
    const bob = /** @type {HTMLInputElement} */ (
      [...dialog.querySelectorAll('.builder-options input')].find(i => i.nextSibling?.textContent === ' bob')
    )
    bob.checked = true
    bob.dispatchEvent(new Event('change'))
    page.click('builder-done')
    expect(page.numbers()).toEqual(['#505'])
    ;/** @type {HTMLInputElement} */ (page.get('presets-name')).value = 'Bob'
    page.click('presets-save')
    const saved = () => /** @type {HTMLElement} */ (page.get('presets-list').querySelector('.saved-search'))
    expect(saved().textContent?.replace(/\s+/g, ' ')).toBe('Bob Builder 1 condition')
    expect(saved().querySelector('.preset-builder')).not.toBeNull()
    page.click('builder-toggle')
    page.click('builder-off')
    expect(page.numbers()).toEqual(['#512', '#509', '#505'])
    saved().click()
    expect(page.get('bar-filters').hidden).toBe(true)
    expect(page.numbers()).toEqual(['#505'])
    history.replaceState(null, '', '/r/acme/widgets/queue')
  })

  it('filters by the blocks a link carries', async () => {
    const where = JSON.stringify({ op: 'and', items: [{ field: 'author', is: 'any', values: ['bob'] }] })
    history.replaceState(null, '', `/r/acme/widgets/queue?builder=1&where=${encodeURIComponent(where)}`)
    const page = await load()
    expect(page.numbers()).toEqual(['#505'])
    expect(page.get('bar-filters').hidden).toBe(true)
    history.replaceState(null, '', '/r/acme/widgets/queue')
  })
})

describe('the Review queue’s Base filter', () => {
  it('shows with two base branches and keeps the PRs on the bases picked', async () => {
    answer = {
      ...answer,
      branches: [
        { name: 'develop', color: 'blue' },
        { name: 'main', color: 'green' },
      ],
      rows: [
        ...ROWS.slice(0, 3),
        { ...ROWS[3], stack: { name: 'billing-1', position: 2, total: 2, base: 'main' } },
        row({ number: 520, title: 'Hotfix: rates', baseRefName: 'main' }),
      ],
    }
    const page = await load()
    await flush()
    expect(page.get('bases-filter').hidden).toBe(false)
    page.click('bases-none')
    expect(page.numbers()).toEqual([])
    page.check('bases', 'main')
    expect(page.numbers()).toEqual(['#520'])
    // #503 sits on another PR: it is under Stacked branches, not its stack's base.
    const stacked = () =>
      [...document.querySelectorAll('#queue-stacked-table .queue-row .pull-number')].map(n => n.textContent)
    expect(stacked()).toEqual([])
    page.check('bases', 'Stacked branches')
    expect(stacked()).toEqual(['#503'])
    expect(page.get('reset-filters').hidden).toBe(false)
  })

  it('shows one stack whole and in its order, unsorted, when a row’s place is clicked', async () => {
    answer = {
      ...answer,
      rows: [
        ...ROWS,
        row({
          number: 506,
          title: 'Billing tax',
          headRefName: 'billing-3',
          baseRefName: 'billing-2',
          stack: { name: 'billing-1', position: 3, total: 3 },
        }),
        row({
          number: 507,
          title: 'Billing base',
          headRefName: 'billing-1',
          stack: { name: 'billing-1', position: 1, total: 3 },
        }),
      ],
    }
    const page = await load()
    await flush()
    // A row's place in its stack keeps the list to it.
    const place = /** @type {HTMLButtonElement} */ (
      page.get('queue-stacked-table').querySelector('.stack-pos')
    )
    expect(place.title).toBe('Filter by stack billing-1')
    place.click()
    expect(page.numbers()).toEqual(['#507', '#503', '#506'])
    expect(page.get('queue-stacked').hidden).toBe(true)
    // The stack's order holds, so the header offers no sort.
    expect(page.get('queue-table').querySelector('thead .sort-button')).toBeNull()
    // The table is named after the stack, and Show all PRs gives the queue back.
    const title = () => document.querySelector('#queue-main-heading .fold-title')?.textContent?.trim()
    expect(title()).toBe('Stack: billing-1')
    page.click('queue-show-all')
    expect(title()).toBe('Waiting for review')
    expect(page.get('queue-show-all').hidden).toBe(true)
    expect(page.numbers()).toContain('#507')
  })

  it('hides with one base branch', async () => {
    const page = await load()
    await flush()
    expect(page.get('bases-filter').hidden).toBe(true)
  })
})

describe('the search box on the Review queue', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    history.replaceState(null, '', '/')
  })

  const box = () => /** @type {HTMLInputElement} */ (document.getElementById('pr-search'))
  /** Types into the box and lets the words settle. @param {string} text */
  const type = text => {
    box().value = text
    box().dispatchEvent(new Event('input'))
    vi.advanceTimersByTime(SEARCH_DELAY_MS)
  }

  it('narrows both tables by title, branch and number, marking what matched', async () => {
    const page = await load()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect(box().placeholder).toBe('Title, branch or #123')
    type('hotfix OR dark')
    expect(page.numbers()).toEqual(['#512', '#505'])
    expect(page.get('queue-stacked').hidden).toBe(true)
    expect(page.get('search-count').textContent).toBe('2 of 4 PRs')
    expect([...document.querySelectorAll('#queue-table mark')].map(m => m.textContent)).toEqual([
      'Hotfix',
      'Dark',
    ])
    // The stacked table's PR, by its branch alone.
    type('billing-2')
    expect(page.numbers()).toEqual([])
    expect(page.get('queue-stacked').hidden).toBe(false)
    expect(page.get('queue-stacked-table').querySelector('.queue-row .pull-number')?.textContent).toBe('#503')
    // By its number, the #number marked.
    type('#509')
    expect(page.numbers()).toEqual(['#509'])
    expect(document.querySelector('#queue-table .pull-number mark')?.textContent).toBe('#509')
  })

  it('opens the one match with Enter, and says when the filters hide what matches', async () => {
    const page = await load()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined)
    type('timezone')
    box().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(assign).toHaveBeenCalledWith('/r/acme/widgets/review/509')
    type('dark')
    page.check('labels', 'frontend')
    // Frontend unticked: Dark mode, the one match, is hidden.
    expect(page.numbers()).toEqual([])
    expect(page.get('queue-empty').textContent).toBe(
      'No PRs match “dark”. Clear search · 1 more PR matches with your filters reset. Reset filters'
    )
    const [, resetFilters] = /** @type {HTMLButtonElement[]} */ ([
      ...page.get('queue-empty').querySelectorAll('button'),
    ])
    resetFilters?.click()
    expect(page.numbers()).toEqual(['#505'])
    expect(box().value).toBe('dark')
  })

  it('offers Search in the filter builder', async () => {
    answer = { ...answer, rows: ROWS }
    await load()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    ;/** @type {HTMLElement} */ (document.getElementById('builder-toggle')).click()
    ;/** @type {HTMLButtonElement} */ (
      [...document.querySelectorAll('#filter-builder button')].find(b => b.textContent === '+ Condition')
    ).click()
    const fields = document.querySelectorAll('.builder-cond .builder-field')
    ;/** @type {HTMLButtonElement} */ (fields[fields.length - 1]).click()
    ;/** @type {HTMLButtonElement} */ (
      [...document.querySelectorAll('.builder-menu .menu-item')].find(i =>
        /** @type {HTMLElement} */ (i).dataset['focus']?.endsWith(':search')
      )
    ).click()
    const words = /** @type {HTMLInputElement} */ (document.querySelector('.builder-text'))
    words.value = 'token OR timezone'
    words.dispatchEvent(new Event('input'))
    words.dispatchEvent(new Event('blur'))
    ;/** @type {HTMLElement} */ (document.getElementById('builder-done')).click()
    expect(
      [...document.querySelectorAll('#queue-table .queue-row .pull-number')].map(n => n.textContent)
    ).toEqual(['#512', '#509'])
  })
})

describe('slim rows on the Review queue', () => {
  it('shows each PR on one line in every table, opens the rest under it, and opens the one a link names', async () => {
    store.set('pr-greenlight:folds:v1:acme/widgets', JSON.stringify({ queue: ['view:slim'] }))
    answer = {
      ...answer,
      priority: {
        prompts: [{ name: 'Default', prompt: DEFAULT_PRIORITY_PROMPT }],
        active: 'Default',
        prompt: DEFAULT_PRIORITY_PROMPT,
        count: 1,
        syncedAt: new Date().toISOString(),
        picks: [{ number: 512, why: 'Critical, and asks for you.' }],
        error: null,
        syncing: false,
        stale: false,
      },
    }
    Element.prototype.scrollIntoView = vi.fn()
    history.replaceState(null, '', '/r/acme/widgets/queue#pr-509')
    const page = await load()
    expect(page.get('slim-rows').getAttribute('aria-pressed')).toBe('true')
    for (const id of ['queue-priority-table', 'queue-notified-table', 'queue-table'])
      expect(page.get(id).querySelector('table')?.classList.contains('slim')).toBe(true)
    // The reason it was picked shows over its cell, and in full once open.
    const picked = /** @type {HTMLElement} */ (page.get('queue-priority-table').querySelector('.queue-row'))
    expect(picked.querySelector('.priority-why')).toBeNull()
    expect(picked.querySelector('.queue-pr')?.getAttribute('title')).toBe('Critical, and asks for you.')
    expect(picked.querySelector('.queue-labels > .label-badge')?.textContent).toBe('Critical')
    expect([...picked.querySelectorAll('.label-popup li')].map(l => l.textContent)).toEqual(['bug', 'auth'])
    ;/** @type {HTMLElement} */ (picked.querySelector('.row-arrow')).click()
    const open = () => page.get('queue-priority-table').querySelector('.row-open')
    expect(open()?.textContent).toContain('Critical, and asks for you.')
    // Labels and reviewers stay in their columns.
    expect(open()?.querySelectorAll('.label-badge, .reviewer-pill')).toHaveLength(0)
    // Opening a PR opens it wherever it shows: #512 here, and #509 the link opened.
    expect(page.get('queue-table').querySelectorAll('.row-open')).toHaveLength(2)
    // The PR a link names opens.
    const linked = /** @type {HTMLElement} */ (document.getElementById('pr-509'))
    expect(linked.querySelector('.row-arrow')?.getAttribute('aria-expanded')).toBe('true')
    expect(linked.nextElementSibling?.classList.contains('row-open')).toBe(true)
    // Whole again: the reason under the title, every label, no arrows.
    page.click('slim-rows')
    expect(document.querySelectorAll('.row-arrow, .row-open')).toHaveLength(0)
    expect(page.get('queue-priority-table').querySelector('.priority-why')?.textContent).toBe(
      'Critical, and asks for you.'
    )
  })
})

describe('review requests from the Review queue', () => {
  it('opens a row’s Reviewers panel on the tables, with who the PR asks and who can be asked', async () => {
    await load()
    const list = /** @type {(url: string) => Promise<Response>} */ (/** @type {unknown} */ (fetch))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (/** @type {string} */ url) => {
        if (url.endsWith('/lists/queue/512/reviewers')) {
          asked.push(url)
          return Response.json({ author: 'alice', requested: [] })
        }
        if (url.includes('/lists/queue/512/reviewers/people?')) {
          asked.push(url)
          return Response.json({ people: [{ login: 'bob' }, { login: 'cy' }], complete: true })
        }
        return list(url)
      })
    )
    const toggle = /** @type {HTMLButtonElement} */ (
      document.querySelector('#pr-512 .row-actions .review-open')
    )
    toggle.click()
    await flush()
    await flush()
    const panel = /** @type {HTMLElement} */ (document.querySelector('main.lists > .review-panel'))
    expect(panel.hidden).toBe(false)
    expect(panel.querySelector('h2')?.textContent).toBe('Reviewers of #512')
    expect(asked).toEqual(
      expect.arrayContaining([
        '/r/acme/widgets/api/lists/queue/512/reviewers',
        '/r/acme/widgets/api/lists/queue/512/reviewers/people?q=',
      ])
    )
    expect([...panel.querySelectorAll('.people-list label')].map(l => l.textContent?.trim())).toEqual([
      'bob',
      'cy',
    ])
  })
})
