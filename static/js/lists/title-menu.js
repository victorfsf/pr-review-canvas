// @ts-check
// A PR title's menu, on Your PRs and the Review queue: the ways to open the PR, each in a new tab
// with an arrow at its far right: its canvas, then the PR on its forge. The menu stays until you pick one, click outside it, or press Escape;
// arrow keys move between its items. A click opens it just under the pointer; a keyboard open
// keeps it under the title's left edge.
import { button, el, externalLink, iconNode } from './dom.js'
import { TEXTS } from './texts.js'

/** The title menu that is open, if any: one at a time. */
let openMenu = /** @type {{ menu: HTMLElement, title: HTMLButtonElement } | null} */ (null)

/** Closes the open menu, giving focus back to its title when asked. */
const closeMenu = (/** @type {boolean} */ refocus = false) => {
  if (openMenu === null) return
  openMenu.menu.hidden = true
  openMenu.title.setAttribute('aria-expanded', 'false')
  if (refocus) openMenu.title.focus()
  openMenu = null
}

/** The arrow at a menu item's far right that says it opens in a new tab. */
const outIcon = (/** @type {Document} */ doc) => {
  const arrow = iconNode(doc, 'arrowUpRight', 14)
  arrow.classList.add('menu-out')
  return arrow
}

const wired = new WeakSet()

/**
 * Closes a title menu on a click outside it or Escape, and on nothing else. Once per document.
 * @param {Document} doc
 */
export function wireTitleMenus(doc) {
  if (wired.has(doc)) return
  wired.add(doc)
  doc.addEventListener('click', event => {
    const target = event.target
    if (openMenu === null || !(target instanceof Node)) return
    if (openMenu.menu.parentElement?.contains(target) || openMenu.title.contains(target)) return
    closeMenu()
  })
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && openMenu !== null) closeMenu(true)
  })
}

/** GitHub's mark for a PR on GitHub; a GitLab merge request gets the plain PR icon. @param {string} forge */
const forgeIcon = forge => (forge === 'GitHub' ? 'github' : 'pull')

/**
 * Where a PR opens, as the page says it: its canvas, and the forge; and whether an agent can run
 * here to generate its canvas.
 * @typedef {{ canvas: string, agent: boolean, forge: string }} Ways
 */

/**
 * The ways out of a PR from this page: its canvas, and its page on the forge, which the page's
 * `main` names (`data-forge`), with whether an agent can run here (`data-agent`).
 * @param {Document} doc
 * @param {number} number
 * @returns {Ways}
 */
export function waysOf(doc, number) {
  const main = /** @type {HTMLElement | null} */ (doc.querySelector('main[data-base]'))
  const base = main?.dataset['base'] ?? '/'
  return {
    canvas: `${base}review/${number}`,
    agent: main?.dataset['agent'] === 'true',
    forge: main?.dataset['forge'] ?? 'GitHub',
  }
}

/**
 * A PR's title and its menu.
 * @param {Document} doc
 * @param {{ number: number, title: string, url: string }} pr
 */
export function titleMenu(doc, pr) {
  const ways = waysOf(doc, pr.number)
  const anchor = el(doc, 'span', 'title-anchor')
  const title = button(doc, 'pull-title title-button', pr.title)
  title.append(' ', el(doc, 'span', 'muted pull-number', `#${pr.number}`))
  title.title = TEXTS.pr.titleMenu.chooseWhere
  title.setAttribute('aria-haspopup', 'menu')
  title.setAttribute('aria-expanded', 'false')
  const menu = el(doc, 'div', 'menu title-menu')
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', `Open #${pr.number}`)
  menu.hidden = true

  /** @type {HTMLElement[]} */
  const items = []
  /** A link out, in a new tab. */
  const out = (/** @type {string} */ href, /** @type {string} */ icon, /** @type {string} */ label) => {
    const a = externalLink(doc, href, 'menu-item')
    a.setAttribute('role', 'menuitem')
    a.append(iconNode(doc, icon, 16), el(doc, 'span', undefined, label), outIcon(doc))
    a.addEventListener('click', () => closeMenu())
    items.push(a)
  }
  out(ways.canvas, 'browserCheck', 'Canvas')
  out(pr.url, forgeIcon(ways.forge), ways.forge)
  menu.append(...items)

  menu.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const at = items.indexOf(/** @type {HTMLElement} */ (doc.activeElement))
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(at + step + items.length) % items.length]?.focus()
  })
  /**
   * A pointer click opens the menu just under the pointer. A keyboard open clears that and leaves
   * the CSS place, under the title. Near the window's edge it shifts so the menu stays on screen.
   * @param {MouseEvent} event
   */
  const place = event => {
    menu.style.left = ''
    menu.style.top = ''
    if (event.detail === 0) return
    const box = anchor.getBoundingClientRect()
    const view = doc.defaultView
    const gap = 4
    let left = event.clientX - box.left
    let top = event.clientY - box.top + gap
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
    if (view === null) return
    const placed = menu.getBoundingClientRect()
    const margin = 8
    const pastRight = placed.right - (view.innerWidth - margin)
    if (pastRight > 0) left -= pastRight
    const minLeft = margin - box.left
    if (left < minLeft) left = minLeft
    const pastBottom = placed.bottom - (view.innerHeight - margin)
    if (pastBottom > 0) {
      const above = event.clientY - box.top - gap - placed.height
      top = above >= margin - box.top ? above : top - pastBottom
    }
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  }
  title.addEventListener('click', event => {
    const wasOpen = openMenu?.menu === menu
    closeMenu()
    if (wasOpen) return
    menu.hidden = false
    title.setAttribute('aria-expanded', 'true')
    openMenu = { menu, title }
    place(event)
    items[0]?.focus()
  })
  anchor.append(title, menu)
  return anchor
}

/**
 * The menu's ways out as small icon links, for the row's line under its title: its canvas here and
 * the PR on its forge, each named by its tooltip.
 * @param {Document} doc
 * @param {{ number: number, url: string }} pr
 */
export function quickLinks(doc, pr) {
  const ways = waysOf(doc, pr.number)
  const links = el(doc, 'span', 'quick-links')
  /** @param {HTMLElement} link @param {string} icon @param {string} words */
  const named = (link, icon, words) => {
    link.classList.add('quick-link')
    link.title = words
    link.setAttribute('aria-label', `${words}: #${pr.number}`)
    link.append(iconNode(doc, icon, 14))
    return link
  }
  links.append(named(externalLink(doc, ways.canvas, ''), 'browserCheck', 'Open the canvas'))
  links.append(named(externalLink(doc, pr.url, ''), forgeIcon(ways.forge), `Open on ${ways.forge}`))
  return links
}

/**
 * A stacked PR's place in its stack, such as `3/5` after the stack icon, for the row's line under
 * its title; null for a PR in no stack. Its branch is on the line already, so only the tooltip
 * names the stack. Clicking it keeps the list to the stack, for as long as the page is open.
 * @param {Document} doc
 * @param {{ name: string, position: number, total: number } | undefined} stack
 * @param {(stack: string) => void} pick
 */
export function stackPlace(doc, stack, pick) {
  if (stack === undefined || stack.total < 2) return null
  const place = button(doc, 'stack-pos', '')
  place.append(
    iconNode(doc, 'stack', 12),
    el(doc, 'span', 'stack-pos-place', `${stack.position}/${stack.total}`)
  )
  place.title = TEXTS.pr.titleMenu.stackFilter(stack.name)
  place.setAttribute(
    'aria-label',
    `Stack ${stack.name}, ${stack.position} of ${stack.total}: filter by stack`
  )
  place.addEventListener('click', () => pick(stack.name))
  return place
}
