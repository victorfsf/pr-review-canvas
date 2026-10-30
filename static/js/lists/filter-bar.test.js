// @ts-check
// @vitest-environment happy-dom
import { filtersOn, markChanged, wireMoreFilters, wireStateFilter } from './filter-bar.js'

describe('Filters and State', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('do nothing on a page without them', () => {
    document.body.innerHTML = ''
    expect(() => wireStateFilter(document, { picked: () => ['open'], pick: () => {} }).render()).not.toThrow()
    expect(() => wireMoreFilters(document, 'pulls').render(2)).not.toThrow()
  })

  it('opens Filters as this browser left it, and goes on when storage refuses', () => {
    document.body.innerHTML = `<button id="filters-toggle"></button><span id="filters-count"></span><div id="more-filters" hidden></div>`
    /** @type {Map<string, string>} */
    const store = new Map([['pr-greenlight:filters-open:v1:queue', '1']])
    vi.stubGlobal('localStorage', {
      getItem: (/** @type {string} */ k) => store.get(k) ?? null,
      setItem: () => {
        throw new Error('quota')
      },
    })
    const more = wireMoreFilters(document, 'queue')
    const row = /** @type {HTMLElement} */ (document.getElementById('more-filters'))
    expect(row.hidden).toBe(false)
    document.getElementById('filters-toggle')?.click()
    expect(row.hidden).toBe(true)
    more.render(2)
    expect(document.getElementById('filters-count')?.textContent).toBe('2')
    expect(document.getElementById('filters-toggle')?.title).toBe('2 filters on')
    more.render(0)
    expect(document.getElementById('filters-count')?.hidden).toBe(true)
  })

  it('ticks Open, Draft and Queued, names what is ticked, and keeps one ticked', () => {
    document.body.innerHTML = `<div><button id="state-button"></button><span id="state-label"></span>
<div id="state-panel" hidden><button id="state-all"></button>
<label><input type="checkbox" data-state="open"></label><label><input type="checkbox" data-state="draft"></label>
<label><input type="checkbox" data-state="queued"></label></div></div>`
    /** @type {import('./pulls.js').StateFilter} */
    let picked = ['open']
    const state = wireStateFilter(document, {
      picked: () => picked,
      pick: next => {
        picked = next
        state.render()
      },
    })
    state.render()
    const box = (/** @type {string} */ s) =>
      /** @type {HTMLInputElement} */ (document.querySelector(`input[data-state="${s}"]`))
    const label = () => document.getElementById('state-label')?.textContent
    expect([box('open').checked, box('open').disabled, box('draft').checked, label()]).toEqual([
      true,
      true,
      false,
      'Open',
    ])
    expect(box('open').closest('label')?.title).toBe('One state stays ticked')
    // Ticking keeps the states' order, whatever order they were ticked in.
    box('queued').click()
    expect([picked, label(), box('open').disabled]).toEqual([['open', 'queued'], 'Open, Queued', false])
    box('draft').click()
    expect([picked, label()]).toEqual([['open', 'draft', 'queued'], 'All'])
    box('open').click()
    box('queued').click()
    expect([picked, label(), box('draft').disabled]).toEqual([['draft'], 'Draft', true])
    // Unticking the last box anyway leaves it ticked, and nothing is picked.
    box('draft').checked = false
    box('draft').dispatchEvent(new Event('change'))
    expect([picked, box('draft').checked]).toEqual([['draft'], true])
    document.getElementById('state-all')?.click()
    expect([picked, label()]).toEqual([['open', 'draft', 'queued'], 'All'])
    // The button opens the popup, which stays open across picks.
    const button = /** @type {HTMLElement} */ (document.getElementById('state-button'))
    const panel = /** @type {HTMLElement} */ (document.getElementById('state-panel'))
    button.click()
    expect(panel.hidden).toBe(false)
    box('open').click()
    expect(panel.hidden).toBe(false)
  })

  it('marks each filter button whose filters are off their defaults', () => {
    document.body.innerHTML = `<button id="state-button"></button><button id="review-filter-button"></button>`
    const defaults = { state: ['open', 'queued'], reviews: null, pending: false }
    const groups = {
      'state-button': ['state'],
      'review-filter-button': ['reviews', 'pending'],
      'gone-button': ['x'],
    }
    const marked = () => [...document.querySelectorAll('[data-changed]')].map(b => b.id)
    markChanged(document, groups, defaults, defaults)
    expect(marked()).toEqual([])
    markChanged(document, groups, { ...defaults, pending: true }, defaults)
    expect(marked()).toEqual(['review-filter-button'])
    markChanged(document, groups, { ...defaults, state: ['draft'] }, defaults)
    expect(marked()).toEqual(['state-button'])
  })

  it('counts the filters off their defaults, Builder as one', () => {
    const defaults = { state: ['open', 'queued'], bases: null, sort: [], q: '', builder: false, where: '' }
    expect(
      filtersOn({ ...defaults, state: ['draft'], bases: ['main'], q: 'x', sort: ['pr'] }, defaults)
    ).toBe(2)
    expect(filtersOn({ ...defaults, builder: true }, defaults)).toBe(1)
  })
})
