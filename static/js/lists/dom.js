// @ts-check
// Small DOM helpers the repo pages share. Text from GitHub only ever goes in through `textContent`;
// only the fixed icon set becomes markup.
import { iconSvg } from './icons.js'
import { TEXTS } from './texts.js'
import { ago, fullStamp, STALE_MS } from './time.js'

/**
 * An element with a class and optional text.
 * @param {Document} doc
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 */
export function el(doc, tag, className, text) {
  const node = doc.createElement(tag)
  if (className !== undefined) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * How long ago `iso` was ("3h ago"), with the full date and time on hover.
 * @param {Document} doc
 * @param {string} iso
 * @param {string} [className]
 */
export function agoNode(doc, iso, className) {
  const node = el(doc, 'time', className, ago(iso, Date.now()))
  node.setAttribute('datetime', iso)
  node.title = fullStamp(iso)
  return node
}

/**
 * A text from TEXTS with the nodes it names: each `{name}` is `slots[name]`, such as a link or a
 * button, and the rest stays text.
 * @param {string} text
 * @param {Record<string, Node>} slots
 * @returns {(Node | string)[]}
 */
export function withSlots(text, slots) {
  return text.split(/\{([a-z]+)\}/).map((part, i) => (i % 2 === 0 ? part : /** @type {Node} */ (slots[part])))
}

/**
 * A text from TEXTS in its paragraphs, split at its blank lines.
 * @param {string} text
 */
export const paragraphs = text => text.split('\n\n')

/**
 * An icon from the fixed set, never from data.
 * @param {Document} doc
 * @param {string} name
 * @param {number} [size]
 */
export function iconNode(doc, name, size) {
  const template = doc.createElement('template')
  template.innerHTML = iconSvg(name, size)
  return /** @type {Element} */ (template.content.firstElementChild)
}

/**
 * Draws an icon button's mark and says what a click does, in its tooltip and its name. A toggle
 * that flips between two acts, such as Expand all and Collapse all, calls it on each change.
 * @param {Document} doc
 * @param {HTMLElement} target
 * @param {string} name the icon
 * @param {string} words
 */
export function paintIconButton(doc, target, name, words) {
  if (target.dataset['icon'] !== name) {
    target.replaceChildren(iconNode(doc, name, 16))
    target.dataset['icon'] = name
  }
  target.title = words
  target.setAttribute('aria-label', words)
}

/**
 * A "?" whose `text` shows on hover and keyboard focus, like the server's `helpTip`.
 * @param {Document} doc
 * @param {string} id the legend's id, unique on the page
 * @param {string} label the button's name, such as "What Time to Merge means"
 * @param {string} text
 */
export function helpTipNode(doc, id, label, text) {
  const anchor = el(doc, 'span', 'help-anchor')
  const help = button(doc, 'help-button', '')
  help.setAttribute('aria-label', label)
  help.setAttribute('aria-describedby', id)
  help.append(iconNode(doc, 'help', 14))
  const legend = el(doc, 'div', 'popover help-popover')
  legend.id = id
  legend.setAttribute('role', 'tooltip')
  legend.append(el(doc, 'p', 'small', text))
  anchor.append(help, legend)
  return anchor
}

/**
 * "+120 −8": a PR's lines added and deleted, for the line under its title.
 * @param {Document} doc
 * @param {number} additions
 * @param {number} deletions
 */
export function locNode(doc, additions, deletions) {
  const loc = el(doc, 'span', 'pull-loc')
  loc.setAttribute('aria-label', `${additions} lines added, ${deletions} deleted`)
  loc.append(el(doc, 'span', 'ok', `+${additions}`), ' ', el(doc, 'span', 'bad', `−${deletions}`))
  return loc
}

/**
 * A link that opens outside the tool, in a new tab.
 * @param {Document} doc
 * @param {string} href
 * @param {string} [className]
 * @param {string} [text]
 */
export function externalLink(doc, href, className, text) {
  const a = /** @type {HTMLAnchorElement} */ (el(doc, 'a', className, text))
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  return a
}

/**
 * The icon-only "Open on GitHub" link rows end with.
 * @param {Document} doc
 * @param {string} href
 * @param {string} label
 */
export function githubLink(doc, href, label) {
  const a = externalLink(doc, href, 'icon-button small-icon-button')
  a.title = 'Open on GitHub'
  a.setAttribute('aria-label', label)
  a.append(iconNode(doc, 'github'))
  return a
}

/**
 * A button with text.
 * @param {Document} doc
 * @param {string} className
 * @param {string} text
 */
export function button(doc, className, text) {
  const b = /** @type {HTMLButtonElement} */ (el(doc, 'button', className, text))
  b.type = 'button'
  return b
}

/** @typedef {{ syncedAt: string | null, error: string | null }} SyncState */

/**
 * Fills the page's "last sync failed" and "last synced" notices.
 * @param {Document} doc
 * @param {SyncState} sync
 */
export function showSync(doc, sync) {
  const error = doc.getElementById('sync-error')
  const stale = doc.getElementById('sync-stale')
  if (error !== null) {
    error.hidden = sync.error === null
    error.textContent = sync.error === null ? '' : `Last sync failed: ${sync.error}`
  }
  if (stale !== null) {
    const old = sync.syncedAt !== null && Date.now() - Date.parse(sync.syncedAt) > STALE_MS
    stale.hidden = !old
    stale.textContent =
      old && sync.syncedAt !== null ? TEXTS.shell.sync.stale(ago(sync.syncedAt, Date.now())) : ''
    stale.title = old && sync.syncedAt !== null ? fullStamp(sync.syncedAt) : ''
  }
}

/**
 * Updates the nav's counts and the header's bell. A new unread count is also announced as
 * `pr-greenlight:unread`, for the tab title and the favicon.
 * @param {Document} doc
 * @param {{ unread?: number, pulls?: number, queue?: number, chats?: number }} counts
 */
export function showNavCounts(doc, counts) {
  const chats = doc.getElementById('nav-chat-count')
  if (chats !== null && counts.chats !== undefined) {
    chats.textContent = counts.chats > 0 ? String(counts.chats) : ''
    chats.classList.toggle('nav-alert', counts.chats > 0)
  }
  const unread = doc.getElementById('nav-unread-count')
  const pulls = doc.getElementById('nav-pull-count')
  const queue = doc.getElementById('nav-queue-count')
  if (unread !== null && counts.unread !== undefined) {
    unread.textContent = String(counts.unread)
    unread.classList.toggle('nav-alert', counts.unread > 0)
  }
  if (pulls !== null && counts.pulls !== undefined) pulls.textContent = String(counts.pulls)
  if (queue !== null && counts.queue !== undefined) queue.textContent = String(counts.queue)
  if (counts.unread === undefined) return
  const bell = doc.getElementById('bell-button')
  const count = doc.getElementById('bell-count')
  if (bell !== null && count !== null) {
    const label = counts.unread === 0 ? 'Notifications' : `Notifications, ${counts.unread} unread`
    count.textContent = String(counts.unread)
    count.hidden = counts.unread === 0
    bell.setAttribute('aria-label', label)
    bell.title = label
  }
  doc.dispatchEvent(new CustomEvent('pr-greenlight:unread', { detail: counts.unread }))
}

/** How often an open table loads again: the server reads a stale list behind its answer. */
export const RELOAD_EVERY_MS = 60 * 1000

/**
 * Calls `load` again every `RELOAD_EVERY_MS` while the tab shows, and once when a hidden tab that
 * missed one is shown again, so tabs left open in the background ask the server nothing. What this
 * page itself did (`pr-greenlight:synced`) loads at once.
 * @param {Document} doc
 * @param {HTMLElement} main
 * @param {() => unknown} load
 */
export function reloadOnChange(doc, main, load) {
  let missed = false
  doc.defaultView?.setInterval(() => {
    if (doc.visibilityState === 'hidden') missed = true
    else void load()
  }, RELOAD_EVERY_MS)
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden' || !missed) return
    missed = false
    void load()
  })
  main.addEventListener('pr-greenlight:synced', () => void load())
}

/**
 * A filter button and its panel of checkboxes: the button opens and closes it; Escape or a click
 * outside closes it.
 * @param {Document} doc
 * @param {HTMLElement} trigger
 * @param {HTMLElement} panel
 */
export function wireFilterPanel(doc, trigger, panel) {
  // An open panel opens under its button, or above it when it fits whole only there; it scrolls only
  // when it fits on neither side. One that would cross either edge of the window shifts back,
  // keeping a 16px margin. It is placed again when the toolbar re-wraps, when the button's label
  // changes its size, or the window resizes. A click in the panel places it once more, after that
  // click's layout.
  // Inside a dialog, whose body scrolls and would cut the panel off, it floats over the dialog
  // instead, under its button, and follows the button as the body scrolls.
  const dialog = trigger.closest('dialog')
  const place = () => {
    panel.style.translate = ''
    panel.style.maxHeight = ''
    panel.style.overflowY = ''
    if (dialog === null) {
      panel.style.top = ''
      panel.style.bottom = ''
    }
    if (panel.hidden) return
    const margin = 16
    // The text size zooms the page: places come zoomed, and the ones set are zoomed again.
    const zoom =
      Number(doc.defaultView?.getComputedStyle(doc.documentElement).getPropertyValue('--zoom')) || 1
    const at = trigger.getBoundingClientRect()
    const height = (doc.defaultView?.innerHeight ?? 0) / zoom
    const above = at.top / zoom - margin
    const below = height - at.bottom / zoom - margin
    const tall = panel.offsetHeight + 6
    // A panel whose list scrolls must not scroll as well: it shrinks only when it fits on neither
    // side of its button, and then takes the side with more room.
    const shrink = (/** @type {number} */ room) => {
      panel.style.maxHeight = `${Math.floor(room - 6)}px`
      panel.style.overflowY = 'auto'
    }
    if (dialog !== null) {
      // Above its button, whole; under it only when it fits there and not above.
      panel.style.position = 'fixed'
      const up = tall <= above || (tall > below && above > below)
      panel.style.top = `${up ? Math.max(margin, at.top / zoom - tall) : at.bottom / zoom + 6}px`
      panel.style.right = 'auto'
      panel.style.left = `${Math.max(margin, at.right / zoom - panel.offsetWidth)}px`
      if (tall > (up ? above : below)) shrink(up ? above : below)
      return
    }
    // Under its button, whole; else above it, whole.
    const up = tall > below && (tall <= above || above > below)
    if (up) {
      panel.style.top = 'auto'
      panel.style.bottom = 'calc(100% + 6px)'
    }
    if (tall > (up ? above : below)) shrink(up ? above : below)
    const view = doc.documentElement
    const box = panel.getBoundingClientRect()
    const rightEdge = view.clientWidth - margin
    const overRight = box.right - rightEdge
    const overLeft = margin - box.left
    if (overRight > 0) panel.style.translate = `${-Math.min(overRight, Math.max(0, box.left - margin))}px 0`
    else if (overLeft > 0)
      panel.style.translate = `${Math.min(overLeft, Math.max(0, rightEdge - box.right))}px 0`
  }
  const view = doc.defaultView
  if (view !== null && 'ResizeObserver' in view) {
    const observer = new view.ResizeObserver(place)
    // The bar's size changes when it re-wraps. The button's own size changes when its label does
    // ("All" becoming "None"), which can move it onto another row without the bar growing.
    observer.observe(trigger.closest('.toolbar') ?? doc.body)
    observer.observe(trigger)
  }
  view?.addEventListener('resize', place)
  dialog?.addEventListener('scroll', place, true)
  // A choice inside the panel can change the button's label and move it. Place again after that layout.
  panel.addEventListener('click', () => view?.requestAnimationFrame(place))
  const setOpen = (/** @type {boolean} */ open) => {
    panel.hidden = !open
    trigger.setAttribute('aria-expanded', String(open))
    place()
  }
  trigger.addEventListener('click', () => setOpen(panel.hidden))
  doc.addEventListener('click', event => {
    const target = /** @type {Node | null} */ (event.target)
    // A modal opened from the panel, such as a delete's confirmation, keeps it open; a click
    // elsewhere in the dialog the panel is in closes it.
    const inModal = target instanceof Element && (target.closest('dialog') ?? dialog) !== dialog
    if (!panel.hidden && target !== null && !inModal && !panel.contains(target) && !trigger.contains(target))
      setOpen(false)
  })
  doc.addEventListener('keydown', event => {
    // In a dialog, Escape closes the panel first, and the dialog with the next one.
    const topDialog = [...doc.querySelectorAll('dialog[open]')].at(-1) ?? null
    if (event.key === 'Escape' && !panel.hidden && topDialog === dialog) {
      event.preventDefault()
      setOpen(false)
      trigger.focus()
    }
  })
}

/**
 * Fills a page's empty-state line. While the data is still on its way (a sync running, or none yet)
 * it shows a spinner with "Syncing…", so a list is never called empty before it is.
 * @param {HTMLElement} node
 * @param {boolean} loading
 * @param {string} text what to say when the list really is empty
 */
export function showEmpty(node, loading, text) {
  node.classList.toggle('loading', loading)
  node.textContent = loading ? 'Syncing…' : text
}

/**
 * Keeps `--head-height` on `box` at the height of its table's column header, so section rows can
 * stick just under the header as the page scrolls. Call the result with each new header.
 * @param {HTMLElement} box
 * @returns {(head: Element | null) => void}
 */
export function trackHeadHeight(box) {
  const set = (/** @type {Element} */ head) =>
    box.style.setProperty('--head-height', `${head.getBoundingClientRect().height}px`)
  const observer =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(entries => {
          for (const entry of entries) set(entry.target)
        })
  return head => {
    observer?.disconnect()
    if (head === null) return
    set(head)
    observer?.observe(head)
  }
}

/**
 * Marks each table card `too-wide` while its table is wider than it (a narrow window, the nav open,
 * many columns), so the card scrolls sideways then and only then: a card that scrolls holds its
 * column header to itself, which stops the header sticking under the page's.
 * @param {Iterable<Element>} boxes
 */
export function scrollWhenWide(boxes) {
  if (typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return
  const all = [...boxes]
  const fit = () => {
    for (const box of all) box.classList.toggle('too-wide', box.scrollWidth > box.clientWidth)
  }
  // The card resizes with the window; its table, with its rows and columns, even when redrawn.
  const resized = new ResizeObserver(fit)
  const redrawn = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.removedNodes) if (node instanceof Element) resized.unobserve(node)
      for (const node of record.addedNodes) if (node instanceof Element) resized.observe(node)
    }
  })
  for (const box of all) {
    resized.observe(box)
    for (const child of box.children) resized.observe(child)
    redrawn.observe(box, { childList: true })
  }
}

/** How long a search box waits after the last keystroke before it filters. */
export const SEARCH_DEBOUNCE_MS = 200

/**
 * `fn`, called once input has paused for `ms`, with the last call's arguments.
 * @template {unknown[]} A
 * @param {(...args: A) => void} fn
 * @param {number} ms
 * @returns {(...args: A) => void}
 */
export function debounce(fn, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

/** How soon a table loads again while the server is still reading its list from the forge. */
export const SYNCING_RELOAD_MS = 3000
