import type { ListPull } from './model.js'
import { anyChecks, ciStuck, healthOf } from './ci.js'
import { makeListPull } from './testing.js'

const makeActivity = (number: number, overrides: Partial<ListPull> = {}) =>
  makeListPull({ number, ...overrides })

const NOW = '2026-10-22T12:00:00Z'
const OLD = '2026-10-22T11:00:00Z'
const RECENT = '2026-10-22T11:50:00Z'
const check = (status: 'pass' | 'fail' | 'pending' | 'queued' | 'expected' | 'skip') => ({
  name: status,
  status,
  since: null,
})

describe('ciStuck', () => {
  it('flags a required check GitHub is still waiting on, at once', () => {
    const a = makeActivity(1, { checks: [check('pass'), check('expected')], headCommittedAt: RECENT })
    expect(ciStuck(a, NOW, true)).toBe('waiting for status to be reported')
  })

  it('flags checks that are all queued, or missing, once the commit is 20 minutes old', () => {
    expect(ciStuck(makeActivity(1, { checks: [check('queued')], headCommittedAt: OLD }), NOW, true)).toBe(
      'checks queued, none running'
    )
    expect(ciStuck(makeActivity(1, { headCommittedAt: OLD }), NOW, true)).toBe('no checks started')
  })

  it('leaves alone fresh commits, running checks, finished ones, and repos without CI', () => {
    expect(
      ciStuck(makeActivity(1, { checks: [check('queued')], headCommittedAt: RECENT }), NOW, true)
    ).toBeNull()
    expect(
      ciStuck(
        makeActivity(1, { checks: [check('queued'), check('pending')], headCommittedAt: OLD }),
        NOW,
        true
      )
    ).toBeNull()
    expect(ciStuck(makeActivity(1, { checks: [check('pass')], headCommittedAt: OLD }), NOW, true)).toBeNull()
    expect(ciStuck(makeActivity(1, { headCommittedAt: OLD }), NOW, false)).toBeNull()
    expect(ciStuck(makeActivity(1, { checks: [check('queued')] }), NOW, true)).toBeNull()
  })

  it('leaves alone a check just queued on an old commit, as a comment or a re-run queues one', () => {
    const queued = (since: string | null) => ({ ...check('queued'), since })
    expect(
      ciStuck(makeActivity(1, { checks: [check('pass'), queued(RECENT)], headCommittedAt: OLD }), NOW, true)
    ).toBeNull()
    expect(
      ciStuck(makeActivity(1, { checks: [queued(OLD), queued(RECENT)], headCommittedAt: OLD }), NOW, true)
    ).toBeNull()
    // Queued that long, or with no time GitHub gave, it is stuck as before.
    expect(
      ciStuck(makeActivity(1, { checks: [check('pass'), queued(OLD)], headCommittedAt: OLD }), NOW, true)
    ).toBe('checks queued, none running')
    expect(ciStuck(makeActivity(1, { checks: [queued(null)], headCommittedAt: OLD }), NOW, true)).toBe(
      'checks queued, none running'
    )
  })

  it('knows a repo runs CI when any PR has checks', () => {
    expect(anyChecks([makeActivity(1), makeActivity(2, { checks: [check('pass')] })])).toBe(true)
    expect(anyChecks([makeActivity(1)])).toBe(false)
  })
})

describe('healthOf', () => {
  it('counts failing checks, says why CI is stuck, and sees a conflict, all at once', () => {
    const a = makeActivity(1, {
      checks: [check('fail'), check('fail'), check('expected')],
      headCommittedAt: RECENT,
      mergeable: 'CONFLICTING',
    })
    expect(healthOf(a, NOW, true)).toEqual({
      ci: 'failing',
      failing: 2,
      stuck: 'waiting for status to be reported',
      conflict: true,
    })
  })

  it('tells running, passing and no checks apart, and an unknown merge state is no conflict', () => {
    const of = (checks: ReturnType<typeof check>[]) =>
      healthOf(makeActivity(1, { checks, headCommittedAt: RECENT, mergeable: 'UNKNOWN' }), NOW, true)
    expect(of([check('pass'), check('pending')]).ci).toBe('running')
    expect(of([check('pass'), check('skip')])).toEqual({
      ci: 'passing',
      failing: 0,
      stuck: null,
      conflict: false,
    })
    expect(of([]).ci).toBe('none')
  })
})
