// @ts-check
// @vitest-environment happy-dom
import { healthMarks, healthNode, healthRank, healthStatus as status } from './health.js'

/** @typedef {import('./health.js').Health} Health */

/** @param {Partial<Health>} o @returns {Health} */
const health = o => ({ ci: 'passing', failing: 0, stuck: null, conflict: false, ...o })

describe('healthMarks', () => {
  it('shows CI failing, CI stuck and a conflict side by side, worst first', () => {
    expect(
      healthMarks(health({ ci: 'failing', failing: 3, stuck: 'checks queued, none running', conflict: true }))
    ).toEqual([
      { icon: 'circleX', tone: 'bad', text: 'CI failing: 3 checks failed' },
      { icon: 'alertCircleFilled', tone: 'warn', text: 'CI stuck: checks queued, none running' },
      { icon: 'pullConflict', tone: 'bad', text: 'Merge conflict with its base branch' },
    ])
  })

  it('shows a check for passing checks, and nothing without any or before a sync', () => {
    expect(healthMarks(health({}))).toEqual([{ icon: 'check', tone: 'ok', text: 'Checks passing' }])
    expect(healthMarks(health({ ci: 'none' }))).toEqual([])
    expect(healthMarks(undefined)).toEqual([])
  })

  it('shows the check beside a conflict, and beside Awaiting your review', () => {
    expect(healthMarks(health({ conflict: true })).map(m => m.icon)).toEqual(['check', 'pullConflict'])
    expect(healthMarks(health({}), true).map(m => m.icon)).toEqual(['userCheck', 'check'])
  })
})

describe('healthMarks while checks run', () => {
  it('shows CI running in yellow, beside a conflict, but not when CI is stuck', () => {
    const running = { icon: 'rotateDot', tone: 'warn', text: 'CI running' }
    expect(healthMarks(health({ ci: 'running' }))).toEqual([running])
    expect(healthMarks(health({ ci: 'running', conflict: true })).map(m => m.icon)).toEqual([
      'rotateDot',
      'pullConflict',
    ])
    expect(
      healthMarks(health({ ci: 'running', stuck: 'checks queued, none running' })).map(m => m.icon)
    ).toEqual(['alertCircleFilled'])
  })
})

describe('healthMarks for a queue PR', () => {
  it('leads with awaiting your review, even before a sync read its checks', () => {
    expect(healthMarks(health({ ci: 'failing', failing: 1 }), true).map(m => m.text)).toEqual([
      'Awaiting your review',
      'CI failing: 1 check failed',
    ])
    expect(healthMarks(health({}), true).map(m => m.icon)).toEqual(['userCheck', 'check'])
    expect(healthMarks(undefined, true).map(m => m.icon)).toEqual(['userCheck'])
  })
})

describe('healthNode', () => {
  it('draws one named icon per mark, with a tooltip, and lets the problems take focus', () => {
    const node = healthNode(document, health({ ci: 'failing', failing: 1, conflict: true }))
    const marks = [...node.querySelectorAll('.health-mark')]
    expect(
      marks.map(m => [m.getAttribute('aria-label'), m.getAttribute('title'), m.getAttribute('tabindex')])
    ).toEqual([
      ['CI failing: 1 check failed', 'CI failing: 1 check failed', '0'],
      ['Merge conflict with its base branch', 'Merge conflict with its base branch', '0'],
    ])
    expect(marks.every(m => m.querySelector('svg') !== null)).toBe(true)
    expect(healthNode(document, health({})).querySelector('.health-mark')?.hasAttribute('tabindex')).toBe(
      false
    )
  })
})

describe('sorting and an unknown status', () => {
  it('ranks an unknown CI with none, and an unknown status matches nothing', () => {
    expect(healthRank(null)).toBe(6)
    expect(healthRank(undefined)).toBe(6)
    expect(healthRank(health({ ci: /** @type {Health['ci']} */ ('weird') }))).toBe(5)
    expect(status(undefined, 'ci')).toBeNull()
    expect(status(undefined, 'merge')).toBeNull()
    expect(status(health({}), 'nope')).toBeNull()
  })
})

describe('a PR’s statuses', () => {
  it('reads one of each kind: CI failing first, then stuck, running, passing; and its merge state', () => {
    expect(status(health({}), 'ci')).toBe('passing')
    expect(status(health({ ci: 'running' }), 'ci')).toBe('running')
    expect(status(health({ ci: 'running', stuck: 'no checks started' }), 'ci')).toBe('stuck')
    expect(status(health({ ci: 'failing', failing: 1, stuck: 'queued' }), 'ci')).toBe('failing')
    // No choice is for none: a PR without checks has no CI status to match.
    expect(status(health({ ci: 'none' }), 'ci')).toBeNull()
    expect(status(health({}), 'merge')).toBe('noConflict')
    expect(status(health({ conflict: true }), 'merge')).toBe('conflict')
  })
})

describe('the Vercel preview', () => {
  const at = (/** @type {'ready' | 'building' | 'failed'} */ state, url = 'https://widgets.example.app') =>
    health({ preview: { state, url } })

  it('shows last in Status, green when ready, yellow while it runs, red when it failed', () => {
    expect(healthMarks(at('ready')).map(m => [m.icon, m.tone, m.text])).toEqual([
      ['check', 'ok', 'Checks passing'],
      ['brandVercelFilled', 'ok', 'Vercel preview ready'],
    ])
    expect(healthMarks(at('building')).at(-1)).toMatchObject({ tone: 'warn', text: 'Vercel preview running' })
    expect(healthMarks(at('failed')).at(-1)).toMatchObject({ tone: 'bad', text: 'Vercel preview failed' })
    expect(healthMarks(health({ preview: null })).map(m => m.icon)).toEqual(['check'])
  })

  it('answers the Vercel filter by its state, and nothing without a preview', () => {
    expect(status(at('ready'), 'vercel')).toBe('vercelReady')
    expect(status(at('building'), 'vercel')).toBe('vercelRunning')
    expect(status(at('failed'), 'vercel')).toBe('vercelFailed')
    expect(status(health({}), 'vercel')).toBeNull()
  })
})
