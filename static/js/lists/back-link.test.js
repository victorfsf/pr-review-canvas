// @ts-check
// @vitest-environment happy-dom
import { notePath, pageName, previousPage, wireBackLink } from './back-link.js'

const BASE = '/r/acme/widgets/'

/**
 * Opens a page of the repo in this tab: its path, its title, and, for one below the nav, a
 * breadcrumb.
 * @param {string} path
 * @param {string} title
 * @param {{ crumbs?: string, page?: string }} [opts]
 */
function open(path, title, opts = {}) {
  window.history.pushState({}, '', path)
  document.title = title
  document.body.innerHTML = `<main data-owner="acme" data-name="widgets" data-page="${opts.page ?? 'x'}">${
    opts.crumbs === undefined ? '' : `<nav class="breadcrumb">${opts.crumbs}</nav>`
  }</main>`
  wireBackLink(document)
  return /** @type {HTMLAnchorElement | null} */ (document.querySelector('.back-link'))
}

beforeEach(() => sessionStorage.clear())

describe('the back link', () => {
  it('names a page by its title, without the unread count', () => {
    expect(pageName('(4) Inbox · acme/widgets · PR Greenlight')).toBe('Inbox')
    expect(pageName('Review queue · acme/widgets · PR Greenlight')).toBe('Review queue')
  })

  it('leads a PR page back to the Inbox it was opened from, and keeps it on a reload', () => {
    expect(open(`${BASE}inbox?token=secret`, 'Inbox · acme/widgets · PR Greenlight')).toBeNull()
    const crumbs = `<a href="${BASE}pulls">Pull requests</a> / #7`
    const link = open(`${BASE}pulls/7`, '#7 Synthetic · acme/widgets · PR Greenlight', { crumbs })
    expect(link?.textContent).toBe('← Back to Inbox')
    // The session token never goes into the trail.
    expect(link?.getAttribute('href')).toBe(`${BASE}inbox`)
    expect(sessionStorage.getItem('pr-greenlight:trail')).not.toContain('secret')
    expect(
      open(`${BASE}pulls/7`, '#7 Synthetic · acme/widgets · PR Greenlight', { crumbs })?.textContent
    ).toBe('← Back to Inbox')
  })

  it('leads back to the view a page was left in, after its filters changed the address', () => {
    open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')
    window.history.replaceState({}, '', `${BASE}inbox?state=draft`)
    notePath(document)
    // A reload with the new address is still the same page, not a way back to itself.
    expect(open(`${BASE}inbox?state=draft`, 'Inbox · acme/widgets · PR Greenlight')).toBeNull()
    const link = open(`${BASE}pulls/7`, '#7 Synthetic · acme/widgets · PR Greenlight', { crumbs: '#7' })
    expect(link?.getAttribute('href')).toBe(`${BASE}inbox?state=draft`)
  })

  it('stays away when the breadcrumb already leads there, on nav pages, and for another repo', () => {
    open(`${BASE}pulls`, 'Pull requests · acme/widgets · PR Greenlight')
    expect(
      open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: `<a href="${BASE}pulls">Pull requests</a>` })
    ).toBeNull()
    open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')
    expect(open(`${BASE}stats`, 'Stats · acme/widgets · PR Greenlight')).toBeNull()
    open('/r/acme/gadgets/inbox', 'Inbox · acme/gadgets · PR Greenlight')
    expect(open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: 'x' })).toBeNull()
  })

  it('shows on Settings too, from the page it was opened on', () => {
    open(`${BASE}stats`, 'Stats · acme/widgets · PR Greenlight')
    expect(
      open(`${BASE}settings`, 'Settings · acme/widgets · PR Greenlight', { page: 'settings' })?.textContent
    ).toBe('← Back to Stats')
  })

  it('goes back through the history when there is one', () => {
    open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')
    const link = /** @type {HTMLAnchorElement} */ (
      open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: 'x' })
    )
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(back).toHaveBeenCalled()
    expect(click.defaultPrevented).toBe(true)
    back.mockRestore()
  })

  it('takes the top off the trail on the way back, so the page leads back to where it came from', () => {
    open(`${BASE}queue`, 'Review queue · acme/widgets · PR Greenlight')
    open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')
    open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: 'x' })
    const settings = open(`${BASE}settings`, 'Settings · acme/widgets · PR Greenlight', { page: 'settings' })
    expect(settings?.textContent).toBe('← Back to #7')
    // Back to the PR through the history: Settings comes off, and the PR still leads to the Inbox.
    window.history.pushState({}, '', `${BASE}pulls/7`)
    document.title = '#7 · PR Greenlight'
    expect(previousPage(document, true)).toEqual({ path: `${BASE}inbox`, name: 'Inbox', history: true })
    window.history.pushState({}, '', `${BASE}inbox`)
    document.title = 'Inbox · acme/widgets · PR Greenlight'
    expect(previousPage(document, true)?.name).toBe('Review queue')
  })

  it('opens the page afresh when the history does not lead there, and that page stays on top', () => {
    open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')
    open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: 'x' })
    open(`${BASE}settings`, 'Settings · acme/widgets · PR Greenlight', { page: 'settings' })
    // Forward through the history to a page the trail took off, or opened again: no history behind.
    window.history.pushState({}, '', `${BASE}pulls/7`)
    document.title = '#7 · PR Greenlight'
    expect(previousPage(document, true)?.history).toBe(true)
    window.history.pushState({}, '', `${BASE}runs/1`)
    document.title = 'Run · PR Greenlight'
    expect(previousPage(document, true)).toEqual({ path: `${BASE}pulls/7`, name: '#7', history: false })
    document.body.innerHTML =
      '<main data-owner="acme" data-name="widgets"><nav class="breadcrumb"></nav></main>'
    wireBackLink(document)
    const link = /** @type {HTMLAnchorElement} */ (document.querySelector('.back-link'))
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(back).not.toHaveBeenCalled()
    expect(click.defaultPrevented).toBe(false)
    back.mockRestore()
    // The PR opens as the page on top, still leading back to the Inbox, now by opening it.
    expect(open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: 'x' })?.textContent).toBe('← Back to Inbox')
    expect(previousPage(document)?.history).toBe(false)
  })

  it('opens a page visited before as a new one on top, and keeps the trail short', () => {
    open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')
    open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: 'x' })
    expect(open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')).toBeNull()
    expect(open(`${BASE}settings`, 'Settings · PR Greenlight', { page: 'settings' })?.textContent).toBe(
      '← Back to Inbox'
    )
    for (let n = 1; n <= 30; n++) open(`${BASE}pulls/${n}`, `#${n} · PR Greenlight`, { crumbs: 'x' })
    expect(JSON.parse(sessionStorage.getItem('pr-greenlight:trail') ?? '[]')).toHaveLength(20)
  })

  it('catches the trail up when the browser shows a page it kept', () => {
    open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')
    open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: 'x' })
    window.history.pushState({}, '', `${BASE}settings`)
    document.title = 'Settings · PR Greenlight'
    previousPage(document)
    window.history.pushState({}, '', `${BASE}pulls/7`)
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }))
    expect(JSON.parse(sessionStorage.getItem('pr-greenlight:trail') ?? '[]')).toHaveLength(3)
    window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    expect(JSON.parse(sessionStorage.getItem('pr-greenlight:trail') ?? '[]')).toHaveLength(2)
  })

  it('records nothing it cannot read back', () => {
    sessionStorage.setItem('pr-greenlight:trail', '{oops')
    window.history.pushState({}, '', `${BASE}inbox`)
    document.title = 'Inbox · PR Greenlight'
    expect(previousPage(document)).toBeNull()
  })

  it('records and offers nothing on a document outside a window, or a page of no repo', () => {
    const detached = document.implementation.createHTMLDocument('Inbox · PR Greenlight')
    expect(previousPage(detached)).toBeNull()
    expect(() => notePath(detached)).not.toThrow()
    detached.body.innerHTML =
      '<main data-owner="acme" data-name="widgets"><nav class="breadcrumb"></nav></main>'
    wireBackLink(detached)
    expect(detached.querySelector('.back-link')).toBeNull()
    document.body.innerHTML = '<main></main>'
    wireBackLink(document)
    expect(document.querySelector('.back-link')).toBeNull()
  })

  it('works without sessionStorage, offering no way back', () => {
    const blocked = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    try {
      expect(open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')).toBeNull()
      expect(open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: 'x' })).toBeNull()
      expect(() => notePath(document)).not.toThrow()
    } finally {
      blocked.mockRestore()
    }
  })

  it('keeps no trail on a page it has not recorded yet', () => {
    window.history.pushState({}, '', `${BASE}inbox?state=draft`)
    notePath(document)
    expect(sessionStorage.getItem('pr-greenlight:trail')).toBeNull()
    sessionStorage.setItem('pr-greenlight:trail', 'null')
    notePath(document)
    expect(sessionStorage.getItem('pr-greenlight:trail')).toBe('null')
    expect(previousPage(document)).toBeNull()
  })

  it('opens the page itself when the tab has no history to go back through', () => {
    open(`${BASE}inbox`, 'Inbox · acme/widgets · PR Greenlight')
    const link = /** @type {HTMLAnchorElement} */ (
      open(`${BASE}pulls/7`, '#7 · PR Greenlight', { crumbs: 'x' })
    )
    const length = vi.spyOn(window.history, 'length', 'get').mockReturnValue(1)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    length.mockRestore()
  })

  it('reads a repo with no name as one of its own', () => {
    window.history.pushState({}, '', '/r/acme//inbox')
    document.title = 'Inbox · PR Greenlight'
    previousPage(document)
    window.history.pushState({}, '', '/r/acme//settings')
    document.body.innerHTML = '<main data-owner="acme" data-page="settings"></main>'
    wireBackLink(document)
    expect(document.querySelector('main > .back-link')?.textContent).toBe('← Back to Inbox')
  })
})
