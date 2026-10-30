// @ts-check
// @vitest-environment happy-dom
import {
  agoNode,
  debounce,
  githubLink,
  helpTipNode,
  paintIconButton,
  paragraphs,
  RELOAD_EVERY_MS,
  reloadOnChange,
  scrollWhenWide,
  showEmpty,
  showNavCounts,
  showSync,
  trackHeadHeight,
  wireFilterPanel,
} from './dom.js'

/** @type {DocumentVisibilityState} */
let visibility = 'visible'

/** Shows or hides the tab, as the browser says it. @param {DocumentVisibilityState} state */
const show = state => {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('reloadOnChange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads again every minute while the tab shows, and at once when this page synced', () => {
    const main = document.createElement('main')
    const load = vi.fn()
    reloadOnChange(document, main, load)
    vi.advanceTimersByTime(RELOAD_EVERY_MS - 1)
    expect(load).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RELOAD_EVERY_MS)
    expect(load).toHaveBeenCalledTimes(2)
    main.dispatchEvent(new Event('pr-greenlight:synced'))
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('asks nothing while hidden, and loads once on showing again only when it missed a load', () => {
    const main = document.createElement('main')
    const load = vi.fn()
    reloadOnChange(document, main, load)
    // Hidden and shown again before a load was due: nothing missed, nothing loads.
    show('hidden')
    show('visible')
    expect(load).not.toHaveBeenCalled()
    show('hidden')
    vi.advanceTimersByTime(RELOAD_EVERY_MS * 3)
    expect(load).not.toHaveBeenCalled()
    // Still hidden: a change of state that leaves it hidden loads nothing.
    show('hidden')
    expect(load).not.toHaveBeenCalled()
    show('visible')
    expect(load).toHaveBeenCalledTimes(1)
    // The missed load is made up once.
    show('hidden')
    show('visible')
    expect(load).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RELOAD_EVERY_MS)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('still listens for a sync on a document with no window', () => {
    const main = document.createElement('main')
    const load = vi.fn()
    vi.spyOn(document, 'defaultView', 'get').mockReturnValue(null)
    reloadOnChange(document, main, load)
    vi.advanceTimersByTime(RELOAD_EVERY_MS)
    expect(load).not.toHaveBeenCalled()
    main.dispatchEvent(new Event('pr-greenlight:synced'))
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('small nodes', () => {
  it('says how long ago, with the full date on hover', () => {
    const at = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const node = agoNode(document, at, 'muted')
    expect([node.tagName, node.className, node.getAttribute('datetime')]).toEqual(['TIME', 'muted', at])
    expect(node.textContent).toBe('3h ago')
    expect(node.title).not.toBe('')
  })

  it('splits a text at its blank lines', () => {
    expect(paragraphs('One.\n\nTwo,\nstill two.')).toEqual(['One.', 'Two,\nstill two.'])
  })

  it('draws an icon button once per icon, and names it each time', () => {
    const target = document.createElement('button')
    paintIconButton(document, target, 'refresh', 'Sync now')
    const mark = target.firstElementChild
    expect([target.title, target.getAttribute('aria-label'), target.dataset['icon']]).toEqual([
      'Sync now',
      'Sync now',
      'refresh',
    ])
    paintIconButton(document, target, 'refresh', 'Syncing')
    expect(target.firstElementChild).toBe(mark)
    expect(target.title).toBe('Syncing')
    paintIconButton(document, target, 'x', 'Stop')
    expect(target.firstElementChild).not.toBe(mark)
  })

  it('makes a "?" described by its legend, and an icon link to GitHub', () => {
    const tip = helpTipNode(document, 'tip-1', 'What it means', 'It means this.')
    const help = /** @type {HTMLButtonElement} */ (tip.querySelector('button.help-button'))
    expect([help.type, help.getAttribute('aria-label'), help.getAttribute('aria-describedby')]).toEqual([
      'button',
      'What it means',
      'tip-1',
    ])
    const legend = tip.querySelector('#tip-1')
    expect([legend?.getAttribute('role'), legend?.textContent]).toEqual(['tooltip', 'It means this.'])
    const link = githubLink(document, 'https://github.com/acme/widgets/pull/7', 'Open #7 on GitHub')
    expect([
      link.getAttribute('href'),
      link.target,
      link.rel,
      link.title,
      link.getAttribute('aria-label'),
    ]).toEqual([
      'https://github.com/acme/widgets/pull/7',
      '_blank',
      'noopener noreferrer',
      'Open on GitHub',
      'Open #7 on GitHub',
    ])
    expect(link.querySelector('svg')).not.toBeNull()
  })

  it('shows a list as syncing while its data is on the way, else what an empty one says', () => {
    const node = document.createElement('p')
    showEmpty(node, true, 'Nothing here.')
    expect([node.textContent, node.classList.contains('loading')]).toEqual(['Syncing…', true])
    showEmpty(node, false, 'Nothing here.')
    expect([node.textContent, node.classList.contains('loading')]).toEqual(['Nothing here.', false])
  })

  it('calls a debounced function once input pauses, with the last arguments', () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const later = debounce(fn, 200)
    later('a')
    vi.advanceTimersByTime(150)
    later('b')
    vi.advanceTimersByTime(199)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledExactlyOnceWith('b')
    vi.useRealTimers()
  })
})

describe('showSync', () => {
  afterEach(() => document.body.replaceChildren())

  it('says a sync failed, and when the last one was once it is old, and nothing otherwise', () => {
    document.body.innerHTML = '<p id="sync-error" hidden></p><p id="sync-stale" hidden></p>'
    const error = /** @type {HTMLElement} */ (document.getElementById('sync-error'))
    const stale = /** @type {HTMLElement} */ (document.getElementById('sync-stale'))
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    showSync(document, { syncedAt: old, error: 'rate limited' })
    expect([error.hidden, error.textContent]).toEqual([false, 'Last sync failed: rate limited'])
    expect([stale.hidden, stale.textContent]).toEqual([false, 'Last synced 2h ago.'])
    expect(stale.title).not.toBe('')
    showSync(document, { syncedAt: new Date().toISOString(), error: null })
    expect([error.hidden, error.textContent]).toEqual([true, ''])
    expect([stale.hidden, stale.textContent, stale.title]).toEqual([true, '', ''])
    showSync(document, { syncedAt: null, error: null })
    expect(stale.hidden).toBe(true)
    // A page without the notices is left alone.
    document.body.replaceChildren()
    showSync(document, { syncedAt: old, error: 'x' })
  })
})

describe('showNavCounts', () => {
  afterEach(() => document.body.replaceChildren())

  it('fills the counts given, the bell with the unread, and announces the unread count', () => {
    document.body.innerHTML =
      '<span id="nav-chat-count"></span><span id="nav-unread-count"></span><span id="nav-pull-count"></span>' +
      '<span id="nav-queue-count"></span><button id="bell-button"></button><span id="bell-count"></span>'
    const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id))
    /** @type {unknown[]} */
    const announced = []
    const listen = (/** @type {Event} */ e) => announced.push(/** @type {CustomEvent} */ (e).detail)
    document.addEventListener('pr-greenlight:unread', listen)
    showNavCounts(document, { unread: 3, pulls: 4, queue: 5, chats: 2 })
    expect(
      ['nav-chat-count', 'nav-unread-count', 'nav-pull-count', 'nav-queue-count'].map(
        id => get(id).textContent
      )
    ).toEqual(['2', '3', '4', '5'])
    expect(get('nav-chat-count').classList.contains('nav-alert')).toBe(true)
    expect(get('nav-unread-count').classList.contains('nav-alert')).toBe(true)
    expect([get('bell-count').textContent, get('bell-count').hidden, get('bell-button').title]).toEqual([
      '3',
      false,
      'Notifications, 3 unread',
    ])
    showNavCounts(document, { unread: 0, chats: 0 })
    expect(get('nav-chat-count').textContent).toBe('')
    expect(get('nav-chat-count').classList.contains('nav-alert')).toBe(false)
    expect([get('bell-count').hidden, get('bell-button').getAttribute('aria-label')]).toEqual([
      true,
      'Notifications',
    ])
    // Counts not given stay as they were, and with no unread count nothing is announced.
    showNavCounts(document, { pulls: 9 })
    expect([get('nav-pull-count').textContent, get('nav-queue-count').textContent]).toEqual(['9', '5'])
    expect(announced).toEqual([3, 0])
    // A page without the counts or the bell still announces.
    document.body.replaceChildren()
    showNavCounts(document, { unread: 1, pulls: 1, queue: 1, chats: 1 })
    expect(announced).toEqual([3, 0, 1])
    document.removeEventListener('pr-greenlight:unread', listen)
  })
})

describe('wireFilterPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  /**
   * A filter button and its panel, `tall` by `wide`, with the button at `at` in a window `height`
   * tall and `width` wide; the panel's own box is `box` once placed.
   * @param {{ inDialog?: boolean, at: ReturnType<typeof rect>, tall: number, wide?: number, height: number,
   *   width?: number, box?: ReturnType<typeof rect> }} o
   */
  function render(o) {
    const bar =
      '<div class="toolbar"><button id="t">Filter</button><div id="p" hidden><input id="i"></div></div>'
    document.body.innerHTML = o.inDialog
      ? `<dialog open>${bar}</dialog><p id="out"></p>`
      : `${bar}<p id="out"></p>`
    const trigger = /** @type {HTMLButtonElement} */ (document.getElementById('t'))
    const panel = /** @type {HTMLElement} */ (document.getElementById('p'))
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(o.at)
    vi.spyOn(panel, 'offsetHeight', 'get').mockReturnValue(o.tall)
    vi.spyOn(panel, 'offsetWidth', 'get').mockReturnValue(o.wide ?? 200)
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(o.box ?? rect(100, 0, 300, o.tall))
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(o.height)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(o.width ?? 1000)
    wireFilterPanel(document, trigger, panel)
    return { trigger, panel }
  }

  const clickOn = (/** @type {string} */ id) =>
    /** @type {HTMLElement} */ (document.getElementById(id)).click()

  it('opens under its button, closes on a click outside or Escape, and stays open for clicks inside', () => {
    const { trigger, panel } = render({ at: rect(100, 100, 200, 130), tall: 200, height: 800 })
    trigger.click()
    expect([panel.hidden, trigger.getAttribute('aria-expanded')]).toEqual([false, 'true'])
    expect([panel.style.top, panel.style.bottom, panel.style.maxHeight, panel.style.translate]).toEqual([
      '',
      '',
      '',
      '',
    ])
    clickOn('i')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(panel.hidden).toBe(false)
    clickOn('out')
    expect([panel.hidden, trigger.getAttribute('aria-expanded')]).toEqual([true, 'false'])
    // Closed, a click outside or Escape does nothing more.
    clickOn('out')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    trigger.click()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })
    document.dispatchEvent(escape)
    expect([panel.hidden, escape.defaultPrevented, document.activeElement]).toEqual([true, true, trigger])
    trigger.click()
    trigger.click()
    expect(panel.hidden).toBe(true)
  })

  it('opens above its button when it fits only there, and scrolls on the roomier side when it fits on neither', () => {
    const { trigger, panel } = render({ at: rect(100, 500, 200, 530), tall: 300, height: 700 })
    trigger.click()
    expect([panel.style.top, panel.style.bottom, panel.style.maxHeight]).toEqual([
      'auto',
      'calc(100% + 6px)',
      '',
    ])
    const low = render({ at: rect(100, 300, 200, 330), tall: 600, height: 700 })
    low.trigger.click()
    // 284 above against 354 below: below has more room.
    expect([low.panel.style.top, low.panel.style.maxHeight, low.panel.style.overflowY]).toEqual([
      '',
      '348px',
      'auto',
    ])
    const high = render({ at: rect(100, 400, 200, 430), tall: 600, height: 700 })
    high.trigger.click()
    // 384 above against 254 below: above.
    expect([high.panel.style.bottom, high.panel.style.maxHeight]).toEqual(['calc(100% + 6px)', '378px'])
  })

  it('shifts back from either edge of the window, keeping its margin', () => {
    const right = render({
      at: rect(900, 100, 980, 130),
      tall: 100,
      height: 800,
      box: rect(850, 136, 1100, 236),
    })
    right.trigger.click()
    expect(right.panel.style.translate).toBe('-116px 0')
    const left = render({ at: rect(0, 100, 80, 130), tall: 100, height: 800, box: rect(-40, 136, 200, 236) })
    left.trigger.click()
    expect(left.panel.style.translate).toBe('56px 0')
    // Wider than the window: it moves no further than its far side allows.
    const wide = render({
      at: rect(0, 100, 80, 130),
      tall: 100,
      height: 800,
      width: 300,
      box: rect(10, 136, 400, 236),
    })
    wide.trigger.click()
    expect(wide.panel.style.translate).toBe('0px 0')
  })

  it('floats over its dialog, above its button when it fits there, and closes on Escape before the dialog', () => {
    const { trigger, panel } = render({
      inDialog: true,
      at: rect(100, 400, 300, 430),
      tall: 200,
      height: 800,
    })
    trigger.click()
    expect([panel.style.position, panel.style.top, panel.style.left, panel.style.right]).toEqual([
      'fixed',
      '194px',
      '100px',
      'auto',
    ])
    // A scroll inside the dialog places it again.
    const dialog = /** @type {HTMLDialogElement} */ (document.querySelector('dialog'))
    panel.style.top = ''
    dialog.dispatchEvent(new Event('scroll'))
    expect(panel.style.top).toBe('194px')
    // A click in a modal it opened keeps it open.
    const modal = document.createElement('dialog')
    modal.setAttribute('open', '')
    const inModal = document.createElement('button')
    modal.append(inModal)
    document.body.append(modal)
    inModal.click()
    expect(panel.hidden).toBe(false)
    // With that modal on top, Escape is the modal's.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel.hidden).toBe(false)
    modal.remove()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(panel.hidden).toBe(true)
    // A click elsewhere in its own dialog closes it.
    trigger.click()
    dialog.click()
    expect(panel.hidden).toBe(true)
  })

  it('in a dialog, opens under its button when it fits only there, and shrinks where there is more room', () => {
    const under = render({ inDialog: true, at: rect(100, 100, 300, 130), tall: 200, height: 800 })
    under.trigger.click()
    expect([under.panel.style.top, under.panel.style.maxHeight]).toEqual(['136px', ''])
    const up = render({ inDialog: true, at: rect(100, 500, 300, 530), tall: 600, height: 700, wide: 400 })
    up.trigger.click()
    // Neither side fits; above has more room, so it starts at the margin and scrolls.
    expect([up.panel.style.top, up.panel.style.left, up.panel.style.maxHeight]).toEqual([
      '16px',
      '16px',
      '478px',
    ])
    const down = render({ inDialog: true, at: rect(100, 200, 300, 230), tall: 600, height: 700 })
    down.trigger.click()
    expect([down.panel.style.top, down.panel.style.maxHeight]).toEqual(['236px', '448px'])
  })

  it('places itself again after a click inside, and when the window resizes', () => {
    const frames = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      cb(0)
      return 0
    })
    const { trigger, panel } = render({ at: rect(100, 500, 200, 530), tall: 300, height: 700 })
    trigger.click()
    panel.style.top = ''
    panel.click()
    expect(frames).toHaveBeenCalled()
    expect(panel.style.top).toBe('auto')
    panel.style.top = ''
    window.dispatchEvent(new Event('resize'))
    expect(panel.style.top).toBe('auto')
  })

  it('reads the page zoom, and works in a document without a window', () => {
    document.documentElement.style.setProperty('--zoom', '2')
    const { trigger, panel } = render({ at: rect(100, 1000, 200, 1060), tall: 300, height: 1400 })
    trigger.click()
    // Zoomed 2x: 154 below, too little for 306; 484 above.
    expect(panel.style.bottom).toBe('calc(100% + 6px)')
    document.documentElement.style.removeProperty('--zoom')
    vi.spyOn(document, 'defaultView', 'get').mockReturnValue(null)
    const bare = render({ at: rect(100, 100, 200, 130), tall: 100, height: 800 })
    bare.trigger.click()
    // No window, so no height: it fits under its button on neither side and goes above, the roomier.
    expect(bare.panel.style.bottom).toBe('calc(100% + 6px)')
    bare.panel.click()
  })
})

describe('trackHeadHeight and scrollWhenWide', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Observers that remember what they watch and call back on demand. */
  function fakeObservers() {
    /** @type {{ fire: () => void, watched: Set<Element> }[]} */
    const resizers = []
    /** @type {((records: unknown[]) => void)[]} */
    const mutations = []
    vi.stubGlobal(
      'ResizeObserver',
      class {
        /** @param {(entries: { target: Element }[]) => void} cb */
        constructor(cb) {
          /** @type {Set<Element>} */
          this.watched = new Set()
          const watched = this.watched
          resizers.push({ fire: () => cb([...watched].map(target => ({ target }))), watched })
        }
        /** @param {Element} node */
        observe(node) {
          this.watched.add(node)
        }
        /** @param {Element} node */
        unobserve(node) {
          this.watched.delete(node)
        }
        disconnect() {
          this.watched.clear()
        }
      }
    )
    vi.stubGlobal(
      'MutationObserver',
      class {
        /** @param {(records: unknown[]) => void} cb */
        constructor(cb) {
          mutations.push(cb)
        }
        observe() {}
      }
    )
    return { resizers, mutations }
  }

  it("keeps the box's --head-height at its header's height, following each new header", () => {
    const { resizers } = fakeObservers()
    const box = document.createElement('div')
    const head = document.createElement('thead')
    vi.spyOn(head, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 32))
    const track = trackHeadHeight(box)
    track(head)
    expect(box.style.getPropertyValue('--head-height')).toBe('32px')
    vi.spyOn(head, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 48))
    resizers[0]?.fire()
    expect(box.style.getPropertyValue('--head-height')).toBe('48px')
    track(null)
    expect(resizers[0]?.watched.size).toBe(0)
  })

  it('sets the height once without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    const box = document.createElement('div')
    const head = document.createElement('thead')
    vi.spyOn(head, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 100, 20))
    trackHeadHeight(box)(head)
    expect(box.style.getPropertyValue('--head-height')).toBe('20px')
  })

  it('marks a card too wide while its table is wider than it, watching tables drawn anew', () => {
    const { resizers, mutations } = fakeObservers()
    const box = document.createElement('div')
    const table = document.createElement('table')
    box.append(table)
    let wide = 900
    vi.spyOn(box, 'scrollWidth', 'get').mockImplementation(() => wide)
    vi.spyOn(box, 'clientWidth', 'get').mockReturnValue(600)
    scrollWhenWide([box])
    const resized = /** @type {{ fire: () => void, watched: Set<Element> }} */ (resizers[0])
    expect([...resized.watched]).toEqual([box, table])
    resized.fire()
    expect(box.classList.contains('too-wide')).toBe(true)
    wide = 600
    resized.fire()
    expect(box.classList.contains('too-wide')).toBe(false)
    const redrawn = document.createElement('table')
    mutations[0]?.([
      {
        removedNodes: [table, document.createTextNode('x')],
        addedNodes: [redrawn, document.createTextNode('y')],
      },
    ])
    expect([...resized.watched]).toEqual([box, redrawn])
  })

  it('does nothing without the observers', () => {
    vi.stubGlobal('MutationObserver', undefined)
    const box = document.createElement('div')
    scrollWhenWide([box])
    expect(box.classList.contains('too-wide')).toBe(false)
  })
})

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
