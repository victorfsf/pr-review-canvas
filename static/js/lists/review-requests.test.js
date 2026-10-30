// @ts-check
// @vitest-environment happy-dom
// A PR row's Reviewers button and panel: what opening loads, ticking and saved groups, the search,
// and the one request closing sends, with its toast.
import { SEARCH_DEBOUNCE_MS } from './dom.js'
import { flushSavedFilters, loadSearches, resetSavedFilters, saveSearches } from './filters.js'
import { reviewRequests } from './review-requests.js'

const REPO = { owner: 'acme', name: 'widgets' }
const BASE = '/r/acme/widgets/'

/** @typedef {{ method: string, url: string, body: unknown }} Call */

/** @type {Call[]} */
let calls
/** Who the forge says the PR is by and asks. @type {{ author: string, requested: string[] }} */
let forge
/** The people the server offers, as it looks them up. @type {{ login: string, name?: string | null }[]} */
let directory
/** Answers a call before the forge would, when it returns something. @type {(url: string, init: RequestInit) => Response | Promise<Response> | undefined} */
let respond

/** A promise the test settles when it chooses. */
const gate = () => {
  /** @type {() => void} */
  let open = () => undefined
  const promise = new Promise(resolve => {
    open = () => resolve(undefined)
  })
  return { promise, open }
}

beforeEach(() => {
  localStorage.clear()
  resetSavedFilters()
  document.body.innerHTML = `<main class="lists" data-base="${BASE}"><table><tr><td id="cell"></td><td id="other"></td></tr></table></main>`
  calls = []
  forge = { author: 'octo', requested: ['ana'] }
  directory = [{ login: 'ana' }, { login: 'Bea' }, { login: 'bob' }, { login: 'cy', name: 'Cyan Blue' }]
  respond = () => undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
      const method = init.method ?? 'GET'
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
      calls.push({ method, url, body })
      const over = respond(url, init)
      if (over !== undefined) return over
      if (url.includes('/lists-filters/')) return Response.json({ ok: true })
      const match = /\/lists\/(?:pulls|queue)\/\d+\/reviewers(?:\/people\?q=(.*))?$/.exec(url)
      if (match === null) return Response.json({ error: { message: 'no route' } }, { status: 404 })
      if (match[1] !== undefined) {
        const q = decodeURIComponent(match[1]).toLowerCase()
        return Response.json({
          people: directory.filter(p => p.login.toLowerCase().includes(q)),
          complete: true,
        })
      }
      if (method === 'POST') {
        forge = {
          ...forge,
          requested: [...forge.requested.filter(l => !body.remove.includes(l)), ...body.add],
        }
      }
      return Response.json(forge)
    })
  )
})

afterEach(async () => {
  // A panel left open would answer a later test's clicks: close it while fetch is still the stub.
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flush()
  flushSavedFilters()
  await flush()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

const cell = () => /** @type {HTMLElement} */ (document.getElementById('cell'))

/** A page's panels for the queue, with PR `number`'s button in the first cell. */
const mount = (number = 7, list = /** @type {'pulls' | 'queue'} */ ('queue')) => {
  const requests = reviewRequests(document, REPO, list)
  const anchor = requests.button(number)
  cell().append(anchor)
  const toggle = /** @type {HTMLButtonElement} */ (anchor.querySelector('button'))
  return { requests, anchor, toggle }
}

/** Opens PR `number`'s panel and waits for what it loads. */
const opened = async (number = 7, list = /** @type {'pulls' | 'queue'} */ ('queue')) => {
  const m = mount(number, list)
  m.toggle.click()
  await flush()
  return { ...m, panel: panel() }
}

const panel = () => /** @type {HTMLElement} */ (document.querySelector('.review-panel'))
/** What the people list shows, a login each, ticked or not. */
const rows = () =>
  [...panel().querySelectorAll('.people-list li')].map(li => {
    const box = li.querySelector('input')
    const login = box?.nextSibling?.textContent?.trim()
    return box === null ? li.textContent : `${box.checked ? '[x]' : '[ ]'} ${login}`
  })
/** @param {string} login */
const boxOf = login =>
  /** @type {HTMLInputElement} */ (
    [...panel().querySelectorAll('.people-list input')].find(
      b => b.nextSibling?.textContent?.trim() === login
    )
  )
const search = () => /** @type {HTMLInputElement} */ (panel().querySelector('input[type="search"]'))
const changes = () => /** @type {HTMLElement} */ (panel().querySelector('.review-changes'))
const count = () => panel().querySelector('.people-list + .small')?.textContent
const groups = () => /** @type {HTMLButtonElement[]} */ ([...panel().querySelectorAll('.saved-search')])
/** @param {string} text */
const buttonNamed = text =>
  /** @type {HTMLButtonElement} */ (
    [...panel().querySelectorAll('button')].find(
      b => (b.getAttribute('aria-label') ?? b.textContent) === text
    )
  )
const posts = () => calls.filter(c => c.method === 'POST' && c.url.endsWith('/reviewers'))
/** What the canvas's toast says now, as [title, context], and whether it is a failure; none when empty. */
const toasts = () =>
  [...document.querySelectorAll('.toast')]
    .filter(t => (t.textContent ?? '') !== '')
    .map(t => {
      const [title, ...context] = (t.textContent ?? '').split(' · ')
      return [title, context.length === 0 ? null : context.join(' · ')]
    })
const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
/** Types into the search, then waits out its debounce. @param {string} value */
const typeIn = async value => {
  search().value = value
  search().dispatchEvent(new Event('input'))
  await new Promise(resolve => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 5))
  await flush()
}

describe('the Reviewers button', () => {
  it('makes a button for each row a PR shows on, with its panel out of the page until opened', () => {
    const requests = reviewRequests(document, REPO, 'pulls')
    const anchor = requests.button(7)
    // Highest priority and the table each show the PR: each row has a button of its own.
    expect(requests.button(7)).not.toBe(anchor)
    expect(requests.button(8)).not.toBe(anchor)
    const toggle = /** @type {HTMLButtonElement} */ (anchor.querySelector('button.review-open'))
    expect([
      anchor.className,
      toggle.title,
      toggle.getAttribute('aria-label'),
      toggle.getAttribute('aria-haspopup'),
      toggle.getAttribute('aria-expanded'),
    ]).toEqual(['review-anchor', 'Reviewers', 'Reviewers of #7', 'dialog', 'false'])
    expect(toggle.querySelector('svg')).not.toBeNull()
    expect(document.querySelector('.review-panel')).toBeNull()
    // With nothing open, a redraw, a key or a click changes nothing.
    requests.drawn()
    escape()
    document.body.click()
    expect(calls).toEqual([])
  })

  it('opens its panel on the tables’ main, loading who the PR asks, then who can be asked', async () => {
    const { toggle } = mount(7, 'pulls')
    toggle.click()
    // Until the forge answers, nothing can be picked.
    expect(panel().parentElement?.matches('main.lists')).toBe(true)
    expect(panel().hidden).toBe(false)
    expect(panel().getAttribute('role')).toBe('dialog')
    expect(panel().querySelector('h2')?.textContent).toBe('Reviewers of #7')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(rows()).toEqual(['Loading…'])
    expect(buttonNamed('Save').disabled).toBe(true)
    expect(buttonNamed('Untick everyone').disabled).toBe(true)
    await flush()
    expect(calls.map(c => [c.method, c.url])).toEqual([
      ['GET', `${BASE}api/lists/pulls/7/reviewers`],
      ['GET', `${BASE}api/lists/pulls/7/reviewers/people?q=`],
    ])
    // Those asked first, then those offered, in the server's order.
    expect(rows()).toEqual(['[x] ana', '[ ] Bea', '[ ] bob', '[ ] cy'])
    expect(count()).toBe('1 picked')
    expect(changes().hidden).toBe(true)
    expect(document.activeElement).toBe(search())
    // A name the lookup gave shows beside its login.
    expect(boxOf('cy').parentElement?.querySelector('.people-count')?.textContent).toBe('Cyan Blue')
  })

  it('never offers the PR’s author, nor anyone the lookups did not find', async () => {
    forge = { author: 'Bob', requested: [] }
    directory = [{ login: 'ana' }, { login: 'bob' }]
    await opened()
    expect(rows()).toEqual(['[ ] ana'])
    expect(count()).toBe('No one picked')
  })

  it('falls back to the page’s body when there is no tables’ main', async () => {
    document.querySelector('main')?.removeAttribute('class')
    await opened()
    expect(panel().parentElement).toBe(document.body)
  })

  it('keeps who it asked last when the forge cannot say who it asks now', async () => {
    respond = (url, init) =>
      url.endsWith('/reviewers') && (init.method ?? 'GET') === 'GET'
        ? Response.json({ error: { message: 'down' } }, { status: 502 })
        : undefined
    await opened()
    expect(rows()).toEqual(['[ ] ana', '[ ] Bea', '[ ] bob', '[ ] cy'])
    expect(count()).toBe('No one picked')
  })
})

describe('ticking people', () => {
  it('ticks and unticks, says what closing will send, and goes back with Discard and None', async () => {
    await opened()
    boxOf('bob').click()
    expect(rows()).toEqual(['[x] ana', '[x] bob', '[ ] Bea', '[ ] cy'])
    expect(count()).toBe('2 picked')
    expect(changes().hidden).toBe(false)
    expect(changes().firstChild?.textContent).toBe('Asks bob when this closes.')
    boxOf('ana').click()
    expect(changes().firstChild?.textContent).toBe('Asks bob and stops asking ana when this closes.')
    buttonNamed('Discard changes').click()
    expect(rows()).toEqual(['[x] ana', '[ ] Bea', '[ ] bob', '[ ] cy'])
    expect(changes().hidden).toBe(true)
    buttonNamed('Untick everyone').click()
    expect(count()).toBe('No one picked')
    expect(changes().firstChild?.textContent).toBe('stops asking ana when this closes.')
    // A click that redrew what it hit is still inside: the panel stays.
    expect(panel().hidden).toBe(false)
  })

  it('keeps someone ticked once, however often their box says so', async () => {
    await opened()
    const ana = boxOf('ana')
    ana.checked = true
    ana.dispatchEvent(new Event('change'))
    expect(count()).toBe('1 picked')
    expect(changes().hidden).toBe(true)
  })

  it('ticks the first one not ticked on Enter, and nothing on other keys', async () => {
    await opened()
    search().dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(count()).toBe('1 picked')
    search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(rows()).toEqual(['[x] ana', '[x] Bea', '[ ] bob', '[ ] cy'])
    // With everyone shown ticked, Enter ticks no one.
    await typeIn('ana')
    search().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }))
    expect(count()).toBe('2 picked')
  })
})

describe('saved groups', () => {
  it('says there are none yet', async () => {
    await opened()
    expect(panel().querySelector('.filter-group p')?.textContent).toBe(
      'No saved groups yet: pick people, then save them as one.'
    )
  })

  it('ticks a group’s people who can review, and unticks them on a second click', async () => {
    saveSearches(REPO, [
      { name: 'Team', logins: ['bob', 'cy', 'zed', 'octo'] },
      { name: 'Empty', logins: [] },
    ])
    const m = mount()
    m.toggle.click()
    // Not while the panel loads.
    expect(groups().map(g => g.disabled)).toEqual([true, true])
    await flush()
    const [team, empty] = groups()
    expect(team?.textContent).toBe('Team bob, cy, zed, octo')
    expect([team?.getAttribute('aria-pressed'), team?.title, team?.disabled]).toEqual([
      'false',
      'Tick everyone in this group',
      false,
    ])
    // A group with no one who can review cannot be clicked, and lists no one.
    expect([empty?.textContent, empty?.disabled]).toEqual(['Empty', true])
    team?.click()
    expect(rows()).toEqual(['[x] ana', '[x] bob', '[x] cy', '[ ] Bea'])
    const pressed = groups()[0]
    expect([pressed?.getAttribute('aria-pressed'), pressed?.title]).toEqual([
      'true',
      'Untick everyone in this group',
    ])
    expect(panel().hidden).toBe(false)
    pressed?.click()
    expect(rows()).toEqual(['[x] ana', '[ ] Bea', '[ ] bob', '[ ] cy'])
  })

  it('saves what is ticked as a group, replacing one of that name, and not without a name or anyone', async () => {
    saveSearches(REPO, [{ name: 'Mine', logins: ['cy'] }])
    await opened()
    const name = /** @type {HTMLInputElement} */ (panel().querySelector('.save-as input'))
    const save = buttonNamed('Save')
    expect(panel().querySelector('.save-as label')?.textContent).toBe('Save as')
    name.value = '   '
    save.click()
    expect(loadSearches(REPO)).toEqual([{ name: 'Mine', logins: ['cy'] }])
    boxOf('bob').click()
    name.value = ' Mine '
    save.click()
    expect(loadSearches(REPO)).toEqual([{ name: 'Mine', logins: ['ana', 'bob'] }])
    expect(name.value).toBe('')
    expect(groups().map(g => g.textContent)).toEqual(['Mine ana, bob'])
    buttonNamed('Untick everyone').click()
    expect(save.disabled).toBe(true)
    name.value = 'Nobody'
    save.click()
    expect(loadSearches(REPO).map(s => s.name)).toEqual(['Mine'])
  })

  it('looks up each group’s people the first lookup did not list, when it listed as many as it can', async () => {
    directory = Array.from({ length: 100 }, (_, i) => ({ login: `p${String(i).padStart(3, '0')}` }))
    saveSearches(REPO, [{ name: 'Far', logins: ['zed', 'yan', 'p001'] }])
    respond = url => {
      if (url.endsWith('people?q=zed')) return Response.json({ people: [{ login: 'zed' }], complete: true })
      if (url.endsWith('people?q=yan')) return Response.json({ error: { message: 'down' } }, { status: 502 })
      return undefined
    }
    await opened()
    expect(calls.filter(c => c.url.includes('people?q=') && !c.url.endsWith('q=')).map(c => c.url)).toEqual([
      `${BASE}api/lists/queue/7/reviewers/people?q=zed`,
      `${BASE}api/lists/queue/7/reviewers/people?q=yan`,
    ])
    groups()[0]?.click()
    expect(count()).toBe('3 picked')
    expect(boxOf('zed').checked).toBe(true)
  })
})

describe('the search', () => {
  it('filters at once by login or name, then looks up what was typed and keeps whom it had', async () => {
    await opened()
    search().value = '@B'
    search().dispatchEvent(new Event('input'))
    // At once, from what the panel has: by login, and cy by name.
    expect(rows()).toEqual(['[ ] Bea', '[ ] bob', '[ ] cy'])
    directory = [{ login: 'bob' }, { login: 'bart' }]
    await new Promise(resolve => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 5))
    await flush()
    expect(calls.at(-1)?.url).toBe(`${BASE}api/lists/queue/7/reviewers/people?q=B`)
    expect(rows()).toEqual(['[ ] bob', '[ ] bart', '[ ] Bea', '[ ] cy'])
    await typeIn('nobody')
    expect(rows()).toEqual(['No one matches.'])
    // An empty search shows everyone the forge lists.
    directory = [{ login: 'ana' }, { login: 'dan' }]
    await typeIn('')
    expect(rows()).toEqual(['[x] ana', '[ ] dan'])
  })

  it('keeps whom it offers when a lookup fails, and drops a lookup a later one overtook', async () => {
    const slow = gate()
    respond = url =>
      url.endsWith('people?q=')
        ? slow.promise.then(() => Response.json({ people: [{ login: 'old' }] }))
        : undefined
    const m = mount()
    m.toggle.click()
    await flush()
    expect(rows()).toEqual(['[x] ana'])
    respond = url => (url.endsWith('people?q=c') ? Response.json({ people: [{ login: 'cy' }] }) : undefined)
    await typeIn('c')
    expect(rows()).toEqual(['[ ] cy'])
    slow.open()
    await flush()
    expect(rows()).toEqual(['[ ] cy'])
    respond = url =>
      url.includes('people?q=') ? Response.json({ error: { message: 'down' } }, { status: 502 }) : undefined
    await typeIn('cy')
    expect(rows()).toEqual(['[ ] cy'])
  })
})

describe('closing the panel', () => {
  it('sends what changed in one request, says so on the button, then shows the forge’s answer in a toast', async () => {
    const { toggle } = await opened()
    boxOf('bob').click()
    boxOf('ana').click()
    escape()
    expect(panel()).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle)
    expect([toggle.classList.contains('sending'), toggle.getAttribute('aria-busy'), toggle.title]).toEqual([
      true,
      'true',
      'Sending the review requests…',
    ])
    await flush()
    expect(posts()).toEqual([
      { method: 'POST', url: `${BASE}api/lists/queue/7/reviewers`, body: { add: ['bob'], remove: ['ana'] } },
    ])
    expect(toasts()).toEqual([['Reviewers of #7 updated', 'Asked bob · stopped asking ana']])
    expect([toggle.classList.contains('sending'), toggle.getAttribute('aria-busy'), toggle.title]).toEqual([
      false,
      'false',
      'Reviewers',
    ])
    // Opening again reads who the forge asks now.
    toggle.click()
    await flush()
    expect(rows()).toEqual(['[x] bob', '[ ] ana', '[ ] Bea', '[ ] cy'])
  })

  it('says only who it asks, or only who it stops asking', async () => {
    const { toggle } = await opened()
    boxOf('cy').click()
    escape()
    await flush()
    toggle.click()
    await flush()
    boxOf('ana').click()
    escape()
    await flush()
    // The toast says the last send, as the review page's does.
    expect(toasts()).toEqual([['Reviewers of #7 updated', 'stopped asking ana']])
  })

  it('closes on a click outside, or on its button, and sends nothing when nothing changed', async () => {
    const { toggle } = await opened()
    // A click inside the panel keeps it open.
    search().click()
    expect(panel().hidden).toBe(false)
    document.body.click()
    expect(panel()).toBeNull()
    expect(document.activeElement).not.toBe(toggle)
    toggle.click()
    await flush()
    toggle.click()
    expect(panel()).toBeNull()
    await flush()
    expect(posts()).toEqual([])
    expect(toggle.classList.contains('sending')).toBe(false)
  })

  it('shows the forge’s refusal in a toast, and goes back to who it asked before', async () => {
    respond = (url, init) =>
      init.method === 'POST'
        ? Response.json({ error: { code: 'HOST_ERROR', message: 'bob cannot review here' } }, { status: 422 })
        : undefined
    const { toggle } = await opened()
    boxOf('bob').click()
    escape()
    await flush()
    expect(toasts()).toEqual([['Reviewers of #7 not changed', 'bob cannot review here']])
    expect(document.querySelector('.toast')?.classList.contains('failed')).toBe(true)
    expect(toggle.getAttribute('aria-busy')).toBe('false')
    // The forge still asks only ana; opening reads it again, and nothing is left to send.
    toggle.click()
    await flush()
    expect(rows()[0]).toBe('[x] ana')
    expect(changes().hidden).toBe(true)
  })

  it('opens on what was sent while the forge has not answered, and sends again after the first', async () => {
    const first = gate()
    respond = (url, init) =>
      init.method === 'POST' && posts().length === 1
        ? first.promise.then(() => undefined).then(() => fetchForge(url, init))
        : undefined
    const { toggle } = await opened()
    boxOf('bob').click()
    escape()
    await flush()
    // Opening while the send is on its way shows what was sent, without asking the forge.
    const gets = calls.filter(c => c.url.endsWith('/reviewers') && c.method === 'GET').length
    toggle.click()
    await flush()
    expect(calls.filter(c => c.url.endsWith('/reviewers') && c.method === 'GET')).toHaveLength(gets)
    expect(rows().slice(0, 2)).toEqual(['[x] ana', '[x] bob'])
    boxOf('cy').click()
    escape()
    // The second waits for the first; the first's answer does not undo what the second sends.
    expect(posts()).toHaveLength(1)
    first.open()
    await flush()
    expect(posts().map(p => p.body)).toEqual([
      { add: ['bob'], remove: [] },
      { add: ['cy'], remove: [] },
    ])
    expect(toasts()).toEqual([['Reviewers of #7 updated', 'Asked cy']])
    expect(toggle.getAttribute('aria-busy')).toBe('false')
  })

  it('redraws its open panel when the forge answers', async () => {
    const answer = gate()
    respond = (url, init) =>
      init.method === 'POST'
        ? answer.promise.then(() => Response.json({ author: 'octo', requested: ['ana', 'dan'] }))
        : undefined
    const { toggle } = await opened()
    boxOf('bob').click()
    escape()
    toggle.click()
    await flush()
    answer.open()
    await flush()
    // The forge's word stands: ana and dan, not bob.
    expect(changes().hidden).toBe(false)
    expect(count()).toBe('2 picked')
  })

  it('closes one PR’s panel when another opens', async () => {
    const requests = reviewRequests(document, REPO, 'queue')
    const seven = requests.button(7)
    const eight = requests.button(8)
    cell().append(seven)
    document.getElementById('other')?.append(eight)
    seven.querySelector('button')?.click()
    await flush()
    boxOf('bob').click()
    eight.querySelector('button')?.click()
    await flush()
    expect(document.querySelectorAll('.review-panel')).toHaveLength(1)
    expect(panel().querySelector('h2')?.textContent).toBe('Reviewers of #8')
    expect(posts().map(p => p.url)).toEqual([`${BASE}api/lists/queue/7/reviewers`])
  })
})

describe('placing the panel', () => {
  /** @param {HTMLElement} node @param {Partial<DOMRect>} box */
  const boxed = (node, box) =>
    vi.spyOn(node, 'getBoundingClientRect').mockReturnValue(/** @type {DOMRect} */ ({ ...box }))

  it('sits under its button, ending at its right edge, and follows it on scroll and resize', async () => {
    const m = mount()
    boxed(m.toggle, { right: 500, top: 100, bottom: 120 })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    m.toggle.click()
    await flush()
    Object.defineProperty(panel(), 'offsetWidth', { configurable: true, value: 300 })
    Object.defineProperty(panel(), 'offsetHeight', { configurable: true, value: 200 })
    window.dispatchEvent(new Event('resize'))
    expect([panel().style.left, panel().style.top]).toEqual(['200px', '126px'])
    boxed(m.toggle, { right: 520, top: 700, bottom: 720 })
    window.dispatchEvent(new Event('scroll'))
    // No room below: above it.
    expect([panel().style.left, panel().style.top]).toEqual(['220px', '494px'])
  })

  it('stays on screen at the edges', async () => {
    const m = mount()
    boxed(m.toggle, { right: 50, top: 10, bottom: 30 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 100 })
    m.toggle.click()
    await flush()
    Object.defineProperty(panel(), 'offsetWidth', { configurable: true, value: 300 })
    Object.defineProperty(panel(), 'offsetHeight', { configurable: true, value: 200 })
    m.requests.drawn()
    // Too tall for above or below: kept from the top.
    expect([panel().style.left, panel().style.top]).toEqual(['8px', '8px'])
  })

  it('leaves the panel where it is in a document with no window', async () => {
    const bare = document.implementation.createHTMLDocument('bare')
    const requests = reviewRequests(bare, REPO, 'queue')
    const anchor = requests.button(7)
    bare.body.append(anchor)
    anchor.querySelector('button')?.click()
    await flush()
    const shown = /** @type {HTMLElement} */ (bare.querySelector('.review-panel'))
    expect(shown.parentElement).toBe(bare.body)
    expect([shown.style.left, shown.style.top]).toEqual(['', ''])
    bare.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(bare.querySelector('.review-panel')).toBeNull()
  })

  it('moves under a button of the PR still on the page after a redraw, and closes once none is', async () => {
    const { requests, anchor } = await opened()
    boxOf('bob').click()
    // A redraw draws new rows, each with a new button of the PR.
    const row = document.createElement('td')
    document.querySelector('tr')?.append(row)
    const redrawn = requests.button(7)
    row.append(redrawn)
    anchor.remove()
    requests.drawn()
    expect(panel().hidden).toBe(false)
    expect(redrawn.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    // Its button still on the page, the panel stays under it.
    requests.drawn()
    expect(panel().hidden).toBe(false)
    redrawn.remove()
    requests.drawn()
    expect(panel()).toBeNull()
    await flush()
    expect(posts()).toHaveLength(1)
    // Closed, the panel neither moves nor closes again.
    requests.drawn()
    window.dispatchEvent(new Event('scroll'))
    expect(posts()).toHaveLength(1)
  })
})

describe('a PR shown on two rows', () => {
  it('opens its one panel from either button, and the other button moves it there', async () => {
    const requests = reviewRequests(document, REPO, 'queue')
    const first = requests.button(7)
    const second = requests.button(7)
    const row = document.createElement('tr')
    row.append(first, second)
    document.querySelector('main')?.append(row)
    const [a, b] = [first, second].map(x => /** @type {HTMLButtonElement} */ (x.querySelector('button')))
    a?.click()
    await flush()
    expect(document.querySelectorAll('.review-panel')).toHaveLength(1)
    expect([a?.getAttribute('aria-expanded'), b?.getAttribute('aria-expanded')]).toEqual(['true', 'false'])
    // The other row's button closes it there, and opens it under itself.
    b?.click()
    await flush()
    expect(document.querySelectorAll('.review-panel')).toHaveLength(1)
    expect([a?.getAttribute('aria-expanded'), b?.getAttribute('aria-expanded')]).toEqual(['false', 'true'])
    // The same button again closes it.
    b?.click()
    expect(document.querySelector('.review-panel')).toBeNull()
  })
})

/**
 * The forge's answer to a call, as the stub gives it when nothing overrides it.
 * @param {string} url @param {RequestInit} init
 */
function fetchForge(url, init) {
  const body = JSON.parse(String(init.body))
  forge = { ...forge, requested: [...forge.requested.filter(l => !body.remove.includes(l)), ...body.add] }
  void url
  return Response.json(forge)
}
