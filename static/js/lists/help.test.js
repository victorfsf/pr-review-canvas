// @ts-check
// @vitest-environment happy-dom
import { wireHelp } from './help.js'

const wired = new WeakSet()

/** A page with two help anchors, each a "?" button and its legend, and the help wired once. */
function render() {
  document.body.innerHTML =
    '<span class="help-anchor" id="a"><button id="a-q">?</button><span class="legend" id="a-l">Legend</span></span>' +
    '<span class="help-anchor" id="b"><button id="b-q">?</button></span><p id="out">Outside</p>'
  if (!wired.has(document)) {
    wired.add(document)
    wireHelp(document)
  }
  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id))
  return { get, closed: (/** @type {string} */ id) => get(id).classList.contains('popup-closed') }
}

const key = (/** @type {Element} */ target, /** @type {string} */ k) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
const mouseout = (/** @type {Element} */ target, /** @type {Element | null} */ to) =>
  target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }))
const focusout = (/** @type {Element} */ target, /** @type {Element | null} */ to) =>
  target.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }))

describe('help legends', () => {
  it('close on Escape from inside their anchor, and only on Escape', () => {
    const p = render()
    key(p.get('a-q'), 'Enter')
    expect(p.closed('a')).toBe(false)
    key(p.get('a-q'), 'Escape')
    expect(p.closed('a')).toBe(true)
    expect(p.closed('b')).toBe(false)
    // Escape outside any anchor closes nothing.
    key(p.get('out'), 'Escape')
    expect(p.closed('b')).toBe(false)
    // An event from no element, such as the document itself, is ignored.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })

  it('open again once the pointer leaves the anchor, not while it moves within it', () => {
    const p = render()
    key(p.get('a-q'), 'Escape')
    mouseout(p.get('a-q'), p.get('a-l'))
    expect(p.closed('a')).toBe(true)
    mouseout(p.get('a-q'), p.get('out'))
    expect(p.closed('a')).toBe(false)
    key(p.get('a-q'), 'Escape')
    mouseout(p.get('a-q'), null)
    expect(p.closed('a')).toBe(false)
    // Leaving somewhere outside every anchor does nothing.
    mouseout(p.get('out'), p.get('a-q'))
  })

  it('open again once focus leaves the anchor, not while it moves within it', () => {
    const p = render()
    key(p.get('a-q'), 'Escape')
    focusout(p.get('a-q'), p.get('a-l'))
    expect(p.closed('a')).toBe(true)
    focusout(p.get('a-q'), p.get('b-q'))
    expect(p.closed('a')).toBe(false)
    key(p.get('a-q'), 'Escape')
    focusout(p.get('a-q'), null)
    expect(p.closed('a')).toBe(false)
    focusout(p.get('out'), null)
  })
})
