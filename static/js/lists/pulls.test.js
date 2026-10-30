// @ts-check
// Your PRs' filters and sort as plain functions: the attention point flags and column, and the
// review states and reviewers they sit beside.
import {
  checkedFlags,
  filterPulls,
  keepsReviews,
  NO_REVIEWER,
  openTotal,
  pullCompare,
  PULLS_ACCEPT,
  PULLS_DEFAULTS,
  reviewFilterLabel,
  reviewFlags,
  reviewLabel,
  reviewState,
  upgradePulls,
} from './pulls.js'

/** @param {Partial<import('./pulls.js').Pull>} o @returns {import('./pulls.js').Pull} */
const pull = o => ({
  number: 1,
  title: 't',
  url: 'u',
  isDraft: false,
  createdAt: '',
  updatedAt: '',
  headRefName: 'h',
  baseRefName: 'develop',
  reviewDecision: null,
  author: 'me',
  reviewers: [],
  ...o,
})

/** @param {string} login @param {Partial<import('./reviewers.js').Reviewer>} [extra] */
const reviewer = (login, extra = {}) => ({
  login,
  kind: /** @type {const} */ ('person'),
  members: [],
  approvals: 0,
  changesRequested: 0,
  comments: 0,
  dismissed: 0,
  lastApprovalAt: null,
  lastChangeRequestAt: null,
  lastCommentAt: null,
  ...extra,
})

describe('openTotal', () => {
  it('adds both kinds, and counts no canvas below none open', () => {
    expect(openTotal({ author: 2, reviewer: 3 })).toBe(5)
    expect(openTotal({ author: 0, reviewer: 0 })).toBe(0)
    expect(openTotal(undefined)).toBe(-1)
  })
})

describe('the attention point flags', () => {
  /** @type {import('./pulls.js').ReviewsPicked} */
  const none = { reviews: null, authorPoints: false, reviewerPoints: false }

  it('are the same two on both tables', () => {
    expect(reviewFlags().map(([key]) => key)).toEqual(['authorPoints', 'reviewerPoints'])
    expect(reviewFlags(true)).toBe(reviewFlags())
  })

  it('keep a PR only with each checked kind open, none without a canvas', () => {
    const pr = pull({})
    const keeps = (/** @type {Partial<typeof none>} */ f, /** @type {any} */ points) =>
      keepsReviews(pr, { ...none, ...f }, { points })
    expect(keeps({}, undefined)).toBe(true)
    expect(keeps({ authorPoints: true }, { author: 1, reviewer: 0 })).toBe(true)
    expect(keeps({ authorPoints: true }, { author: 0, reviewer: 4 })).toBe(false)
    expect(keeps({ authorPoints: true }, undefined)).toBe(false)
    expect(keeps({ reviewerPoints: true }, { author: 0, reviewer: 4 })).toBe(true)
    expect(keeps({ reviewerPoints: true }, undefined)).toBe(false)
    expect(keeps({ authorPoints: true, reviewerPoints: true }, { author: 1, reviewer: 1 })).toBe(true)
    expect(keeps({ authorPoints: true, reviewerPoints: true }, { author: 1, reviewer: 0 })).toBe(false)
    // With review states ticked, the flags must hold as well.
    expect(keeps({ reviews: ['none'], reviewerPoints: true }, { author: 0, reviewer: 2 })).toBe(true)
    expect(keeps({ reviews: ['none'], reviewerPoints: true }, { author: 2, reviewer: 0 })).toBe(false)
  })

  it('are named on the Reviews button, one by its word and more by their count', () => {
    expect(checkedFlags({ ...none, authorPoints: true })).toEqual(['authorPoints'])
    expect(reviewFilterLabel({ ...none, authorPoints: true })).toBe('All · Author points')
    expect(reviewFilterLabel({ ...none, reviewerPoints: true }, true)).toBe('All · Reviewer points')
    expect(reviewFilterLabel({ ...none, authorPoints: true, reviewerPoints: true })).toBe('All · 2 more')
    expect(reviewFilterLabel(none)).toBe('All')
  })

  it('are saved as booleans, off by default, and the old pending flag is no longer read', () => {
    expect([PULLS_DEFAULTS.authorPoints, PULLS_DEFAULTS.reviewerPoints]).toEqual([false, false])
    expect([PULLS_ACCEPT.authorPoints(true), PULLS_ACCEPT.reviewerPoints('1')]).toEqual([true, false])
    expect(Object.keys(PULLS_DEFAULTS)).not.toContain('pending')
    expect(PULLS_ACCEPT.sort(['pending'])).toBe(false)
    expect(PULLS_ACCEPT.sort(['-points'])).toBe(true)
  })
})

describe('filterPulls', () => {
  const pulls = [pull({ number: 1 }), pull({ number: 2 }), pull({ number: 3 })]

  it('reads each PR’s open points by number, none without its canvas', () => {
    const points = { 1: { author: 1, reviewer: 0 }, 2: { author: 0, reviewer: 2 } }
    const kept = (/** @type {Partial<typeof PULLS_DEFAULTS>} */ f) =>
      filterPulls(pulls, { ...PULLS_DEFAULTS, ...f }, {}, {}, undefined, points).map(p => p.number)
    expect(kept({})).toEqual([1, 2, 3])
    expect(kept({ authorPoints: true })).toEqual([1])
    expect(kept({ reviewerPoints: true })).toEqual([2])
    // Without a points map, no PR has any open.
    expect(filterPulls(pulls, { ...PULLS_DEFAULTS, reviewerPoints: true })).toEqual([])
    expect(filterPulls(pulls, PULLS_DEFAULTS)).toHaveLength(3)
  })

  it('keeps by reviewer, a PR nobody reviewed under No reviewers', () => {
    const reviewed = [pull({ number: 1, reviewers: [reviewer('sam')] }), pull({ number: 2 })]
    const kept = (/** @type {string[]} */ reviewers) =>
      filterPulls(reviewed, { ...PULLS_DEFAULTS, reviewers }).map(p => p.number)
    expect(kept(['sam'])).toEqual([1])
    expect(kept([NO_REVIEWER])).toEqual([2])
    expect(kept([])).toEqual([])
  })
})

describe('pullCompare', () => {
  it('sorts by open points with no canvas first, and with no points map every PR alike', () => {
    const a = pull({ number: 1 })
    const b = pull({ number: 2 })
    const c = pull({ number: 3 })
    const by = pullCompare({}, {}, { 1: { author: 2, reviewer: 1 }, 3: { author: 0, reviewer: 0 } }).points
    expect([a, b, c].sort(by).map(p => p.number)).toEqual([2, 3, 1])
    expect(pullCompare({}, {}).points(a, b)).toBe(0)
  })

  it('sorts a status it does not know after those it does', () => {
    const compare = pullCompare(
      {},
      { 1: { canvas: 'Ready', codeRabbit: 'Odd' }, 2: { canvas: 'Odd', codeRabbit: 'Ready' } }
    )
    const a = pull({ number: 1 })
    const b = pull({ number: 2 })
    expect(compare.canvas(a, b)).toBeLessThan(0)
    expect(compare.codeRabbit(a, b)).toBeGreaterThan(0)
  })
})

describe('reviewState and upgradePulls', () => {
  it('reads a change request not approved since over an approval, and a comment over none', () => {
    const asked = reviewer('a', {
      changesRequested: 1,
      lastChangeRequestAt: '2026-10-02',
      approvals: 1,
      lastApprovalAt: '2026-10-01',
    })
    expect(reviewState({ reviewers: [asked] })).toBe('changesRequested')
    expect(reviewState({ reviewers: [{ ...asked, lastApprovalAt: '2026-10-03' }] })).toBe('approved')
    expect(reviewState({ reviewers: [reviewer('c', { comments: 1 })] })).toBe('commented')
    // A bots group is no person's review.
    expect(reviewState({ reviewers: [reviewer('Bots', { kind: 'bots', approvals: 2 })] })).toBe('none')
  })

  it('turns the old review boxes into the review states', () => {
    expect(upgradePulls({ approved: true, commented: true, changesRequested: false })).toEqual({
      reviews: ['approved', 'commented'],
    })
    expect(upgradePulls({ approved: false, sort: ['pr'] })).toEqual({ sort: ['pr'] })
  })
})

describe('reviewLabel and the plain sorts', () => {
  it('says each review decision, none as No review yet', () => {
    expect(
      /** @type {const} */ (['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED', null]).map(
        d => reviewLabel({ reviewDecision: d }).text
      )
    ).toEqual(['Approved', 'Changes requested', 'Review required', 'No review yet'])
  })

  it('sorts by number and by health', () => {
    const compare = pullCompare({ 2: { ci: 'failing', failing: 1, stuck: null, conflict: false } }, {})
    const a = pull({ number: 1 })
    const b = pull({ number: 2 })
    expect(compare.pr(a, b)).toBeLessThan(0)
    expect(compare.status(a, b)).not.toBe(0)
    expect(PULLS_ACCEPT.reviewers(['sam', 1])).toBe(false)
    expect(PULLS_ACCEPT.reviewers(['sam'])).toBe(true)
  })
})
