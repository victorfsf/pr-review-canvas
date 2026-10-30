// @ts-check
// @vitest-environment happy-dom
import { quickLinks, stackPlace, titleMenu, waysOf, wireTitleMenus } from './title-menu.js'

const pr = { number: 7, title: 'Synthetic change', url: 'https://github.com/acme/widgets/pull/7' }

describe('titleMenu', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('offers the canvas here and the PR on its forge in a new tab, and nothing to generate', () => {
    page({ agent: 'true', forge: 'GitLab' })
    const anchor = titleMenu(document, pr)
    const title = anchor.querySelector('.pull-title')
    expect(title?.getAttribute('title')).toBe('Choose where to open')
    expect(title?.getAttribute('aria-haspopup')).toBe('menu')
    expect(title?.getAttribute('aria-expanded')).toBe('false')
    expect(title?.textContent).toBe('Synthetic change #7')
    const menu = /** @type {HTMLElement} */ (anchor.querySelector('.title-menu'))
    expect(menu.hidden).toBe(true)
    expect(menu.getAttribute('aria-label')).toBe('Open #7')
    const items = [...menu.querySelectorAll('.menu-item')].map(i => [
      i.textContent,
      i.getAttribute('href'),
      i.getAttribute('target'),
      i.getAttribute('role'),
    ])
    expect(items).toEqual([
      ['Canvas', '/r/acme/widgets/review/7', '_blank', 'menuitem'],
      ['GitLab', 'https://github.com/acme/widgets/pull/7', '_blank', 'menuitem'],
    ])
    // Each item carries the out arrow, and opens without the opener.
    expect(menu.querySelectorAll('.menu-out')).toHaveLength(2)
    expect([...menu.querySelectorAll('.menu-item')].map(i => i.getAttribute('rel'))).toEqual([
      'noopener noreferrer',
      'noopener noreferrer',
    ])
    // Without an agent the menu is the same; GitHub is the forge a page leaves unnamed.
    page({ agent: 'false' })
    expect([...titleMenu(document, pr).querySelectorAll('.menu-item')].map(i => i.textContent)).toEqual([
      'Canvas',
      'GitHub',
    ])
  })

  it('moves between its items with the arrow keys, round the ends, and closes on picking the forge', () => {
    page({ agent: 'true' })
    const anchor = titleMenu(document, pr)
    document.body.append(anchor)
    const title = /** @type {HTMLButtonElement} */ (anchor.querySelector('button.pull-title'))
    const menu = /** @type {HTMLElement} */ (anchor.querySelector('.title-menu'))
    const items = /** @type {HTMLElement[]} */ ([...menu.querySelectorAll('.menu-item')])
    title.click()
    expect(title.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(items[0])
    const key = (/** @type {string} */ k) => {
      const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
      menu.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(items).toHaveLength(2)
    expect(key('ArrowUp')).toBe(true)
    expect(document.activeElement).toBe(items[1])
    key('ArrowDown')
    expect(document.activeElement).toBe(items[0])
    key('ArrowDown')
    expect(document.activeElement).toBe(items[1])
    items[1]?.addEventListener('click', event => event.preventDefault())
    items[1]?.click()
    expect(menu.hidden).toBe(true)
    expect(title.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the menu just under the pointer, and under the title from the keyboard', () => {
    const anchor = titleMenu(document, pr)
    document.body.append(anchor)
    const title = /** @type {HTMLButtonElement} */ (anchor.querySelector('button.pull-title'))
    const menu = /** @type {HTMLElement} */ (anchor.querySelector('.title-menu'))
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 200, 400, 220))
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect(180, 214, 340, 330))
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 180, clientY: 210, detail: 1 }))
    expect(menu.hidden).toBe(false)
    expect(menu.style.left).toBe('80px')
    expect(menu.style.top).toBe('14px')
    title.click()
    title.click()
    expect(menu.style.left).toBe('')
    expect(menu.style.top).toBe('')
  })

  it('shifts the menu back on screen when the pointer is near the window edge', () => {
    const anchor = titleMenu(document, pr)
    document.body.append(anchor)
    const title = /** @type {HTMLButtonElement} */ (anchor.querySelector('button.pull-title'))
    const menu = /** @type {HTMLElement} */ (anchor.querySelector('.title-menu'))
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 200, 400, 220))
    // The unshifted menu would end 40px past a 360px-wide window, and below an 300px-tall one.
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect(300, 214, 400, 400))
    const view = /** @type {{ innerWidth: number, innerHeight: number }} */ (document.defaultView)
    const width = view.innerWidth
    const height = view.innerHeight
    view.innerWidth = 360
    view.innerHeight = 300
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 210, detail: 1 }))
    // Pointer at x=300 (200px into the anchor). The measured menu ends at 400, 48px past the
    // window's 8px margin, so the menu shifts left by that much.
    expect(menu.style.left).toBe('152px')
    // Above the pointer: 210 - 200 - 4 - 186.
    expect(menu.style.top).toBe('-180px')
    view.innerWidth = width
    view.innerHeight = height
  })

  it('leaves the menu where a key that is not an arrow found it', () => {
    const anchor = titleMenu(document, pr)
    document.body.append(anchor)
    const menu = /** @type {HTMLElement} */ (anchor.querySelector('.title-menu'))
    const title = /** @type {HTMLButtonElement} */ (anchor.querySelector('button.pull-title'))
    title.click()
    const first = /** @type {HTMLElement} */ (menu.querySelector('a, button'))
    first.focus()
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(document.activeElement).toBe(first)
  })

  it('keeps the menu on screen when the pointer is at the window edge', () => {
    const anchor = titleMenu(document, pr)
    document.body.append(anchor)
    const title = /** @type {HTMLButtonElement} */ (anchor.querySelector('button.pull-title'))
    const menu = /** @type {HTMLElement} */ (anchor.querySelector('.title-menu'))
    const view = /** @type {{ innerWidth: number, innerHeight: number }} */ (document.defaultView)
    const width = view.innerWidth
    const height = view.innerHeight

    // Far past the right edge, so the shift stops at the window's left margin.
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 200, 400, 220))
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect(110, 214, 5000, 250))
    view.innerWidth = 360
    view.innerHeight = 800
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 110, clientY: 210, detail: 1 }))
    expect(menu.style.left).toBe('-92px')
    expect(menu.style.top).toBe('14px')

    // Too tall to flip above a title already near the top, so it shifts up instead.
    title.click()
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 20, 400, 40))
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue(rect(110, 34, 200, 250))
    view.innerWidth = 800
    view.innerHeight = 100
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 110, clientY: 30, detail: 1 }))
    expect(menu.style.left).toBe('10px')
    expect(menu.style.top).toBe('-144px')

    view.innerWidth = width
    view.innerHeight = height
  })

  it('places a pointer menu before measuring when the window is gone', () => {
    const anchor = titleMenu(document, pr)
    document.body.append(anchor)
    const title = /** @type {HTMLButtonElement} */ (anchor.querySelector('button.pull-title'))
    const menu = /** @type {HTMLElement} */ (anchor.querySelector('.title-menu'))
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(100, 200, 400, 220))
    vi.spyOn(document, 'defaultView', 'get').mockReturnValue(null)
    title.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 180, clientY: 210, detail: 1 }))
    expect(menu.style.left).toBe('80px')
    expect(menu.style.top).toBe('14px')
  })
})

describe('closing a title menu', () => {
  afterEach(() => document.body.replaceChildren())

  it('closes on a click outside it or Escape, focusing its title, and on nothing else', () => {
    wireTitleMenus(document)
    // Once per document.
    wireTitleMenus(document)
    page({})
    const anchor = titleMenu(document, pr)
    const other = titleMenu(document, { ...pr, number: 8 })
    const outside = document.createElement('p')
    document.body.append(anchor, other, outside)
    const title = /** @type {HTMLButtonElement} */ (anchor.querySelector('button.pull-title'))
    const menu = /** @type {HTMLElement} */ (anchor.querySelector('.title-menu'))
    // With no menu open, a click or Escape does nothing.
    outside.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    title.click()
    // A click in the menu, or another key, keeps it.
    menu.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(menu.hidden).toBe(false)
    outside.click()
    expect(menu.hidden).toBe(true)
    title.click()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(menu.hidden).toBe(true)
    expect(document.activeElement).toBe(title)
    // Opening another closes the first: one at a time.
    title.click()
    const otherTitle = /** @type {HTMLButtonElement} */ (other.querySelector('button.pull-title'))
    otherTitle.click()
    expect(menu.hidden).toBe(true)
    expect(/** @type {HTMLElement} */ (other.querySelector('.title-menu')).hidden).toBe(false)
    outside.click()
  })
})

describe('waysOf', () => {
  afterEach(() => document.body.replaceChildren())

  it("reads the canvas, whether an agent can run and the forge from the page's main, with defaults without one", () => {
    expect(waysOf(document, 3)).toEqual({ canvas: '/review/3', agent: false, forge: 'GitHub' })
    page({ agent: 'true', forge: 'GitLab' })
    expect(waysOf(document, 3)).toEqual({
      canvas: '/r/acme/widgets/review/3',
      agent: true,
      forge: 'GitLab',
    })
    // Only 'true' says an agent can run; a main that names none says none can.
    page({ agent: 'false' })
    expect(waysOf(document, 3).agent).toBe(false)
    page({})
    expect(waysOf(document, 3)).toEqual({ canvas: '/r/acme/widgets/review/3', agent: false, forge: 'GitHub' })
  })
})

describe('quickLinks', () => {
  afterEach(() => document.body.replaceChildren())

  it('links the canvas here and the PR on its forge, each named by its tooltip', () => {
    page({ forge: 'GitHub' })
    const links = [...quickLinks(document, pr).querySelectorAll('.quick-link')].map(l => [
      l.getAttribute('href'),
      l.getAttribute('title'),
      l.getAttribute('aria-label'),
      l.getAttribute('target'),
      l.querySelector('svg') !== null,
    ])
    expect(links).toEqual([
      ['/r/acme/widgets/review/7', 'Open the canvas', 'Open the canvas: #7', '_blank', true],
      ['https://github.com/acme/widgets/pull/7', 'Open on GitHub', 'Open on GitHub: #7', '_blank', true],
    ])
  })
})

describe('stackPlace', () => {
  it("shows a stacked PR's place, filters by its stack on a click, and nothing outside a stack", () => {
    const pick = vi.fn()
    const place = /** @type {HTMLButtonElement} */ (
      stackPlace(document, { name: 'auth', position: 3, total: 5 }, pick)
    )
    expect(place.textContent).toBe('3/5')
    expect(place.title).toBe('Filter by stack auth')
    expect(place.getAttribute('aria-label')).toBe('Stack auth, 3 of 5: filter by stack')
    place.click()
    expect(pick).toHaveBeenCalledWith('auth')
    expect(stackPlace(document, undefined, pick)).toBeNull()
    expect(stackPlace(document, { name: 'solo', position: 1, total: 1 }, pick)).toBeNull()
  })
})

/**
 * The page's main, naming the project for the menus.
 * @param {{ agent?: string, forge?: string }} data
 */
function page({ agent, forge }) {
  document.body.replaceChildren()
  const main = document.createElement('main')
  main.dataset['base'] = '/r/acme/widgets/'
  if (agent !== undefined) main.dataset['agent'] = agent
  if (forge !== undefined) main.dataset['forge'] = forge
  document.body.append(main)
}

/** @param {number} left @param {number} top @param {number} right @param {number} bottom */
function rect(left, top, right, bottom) {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON() {
      return this
    },
  }
}
