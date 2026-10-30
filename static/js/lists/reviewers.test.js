// @ts-check
// @vitest-environment happy-dom
import { makeReviewer as reviewer } from '../../../src/lists/testing.ts'
import { baseColor, DEFAULT_BRANCHES } from './branches.js'
import { featured, reviewersNode, reviewerText } from './reviewers.js'

/**
 * A synthetic reviewer named `login`.
 * @param {string} login
 * @param {Partial<import('../../../src/lists/model.ts').Reviewer>} [overrides]
 */
const makeReviewer = (login, overrides = {}) => reviewer({ login, ...overrides })

const THREE = [
  makeReviewer('bob', { changesRequested: 1, comments: 23, lastChangeRequestAt: '2026-10-02T10:00:00Z' }),
  makeReviewer('alice', { approvals: 1, lastApprovalAt: '2026-10-03T10:00:00Z' }),
  makeReviewer('a-reviewer-with-a-rather-long-username', {
    approvals: 1,
    comments: 2,
    dismissed: 1,
    lastApprovalAt: '2026-10-01T10:00:00Z',
  }),
]

describe('reviewerText', () => {
  it("says a person's counts in words, singular or plural", () => {
    expect(reviewerText(makeReviewer('bob', { changesRequested: 1, comments: 23 }))).toBe(
      'bob: 1 change request, 23 comments'
    )
    expect(
      reviewerText(makeReviewer('x', { approvals: 2, changesRequested: 2, dismissed: 2, comments: 1 }))
    ).toBe('x: 2 approvals, 2 change requests, 2 dismissed reviews, 1 comment')
  })
})

describe('featured', () => {
  it('names the last person to request changes while any change request stands, approvals or not', () => {
    const reviewers = [
      makeReviewer('early', { changesRequested: 1, lastChangeRequestAt: '2026-10-01T00:00:00Z' }),
      makeReviewer('late', { changesRequested: 1, lastChangeRequestAt: '2026-10-05T00:00:00Z' }),
      makeReviewer('approver', { approvals: 1, lastApprovalAt: '2026-10-09T00:00:00Z' }),
    ]
    expect(featured(reviewers)).toEqual({ reviewer: reviewers[1], why: 'changesRequested' })
  })

  it('names the last approver when no change request stands', () => {
    const reviewers = [
      makeReviewer('first', { approvals: 1, lastApprovalAt: '2026-10-01T00:00:00Z' }),
      makeReviewer('second', { approvals: 2, lastApprovalAt: '2026-10-04T00:00:00Z' }),
      makeReviewer('talker', { comments: 9, lastCommentAt: '2026-10-09T00:00:00Z' }),
      // A dismissed change request no longer counts as one.
      makeReviewer('dismissed', { dismissed: 1 }),
    ]
    expect(featured(reviewers)?.reviewer.login).toBe('second')
  })

  it('names the last commenter when there are only comments', () => {
    const reviewers = [
      makeReviewer('a', { comments: 5, lastCommentAt: '2026-10-02T00:00:00Z' }),
      makeReviewer('b', { comments: 1, lastCommentAt: '2026-10-07T00:00:00Z' }),
    ]
    expect(featured(reviewers)).toEqual({ reviewer: reviewers[1], why: 'comments' })
  })

  it('names nobody when there are only dismissed reviews, and copes with missing times', () => {
    expect(featured([makeReviewer('x', { dismissed: 1 })])).toBeNull()
    const noTimes = [makeReviewer('a', { comments: 1 }), makeReviewer('b', { comments: 1 })]
    expect(featured(noTimes)?.reviewer.login).toBe('a')
  })
})

describe('reviewersNode', () => {
  it('shows the featured person with only their own counts, then +N for the others', () => {
    const box = reviewersNode(document, THREE)
    const pill = /** @type {HTMLElement} */ (box.querySelector(':scope > .reviewer-pill'))
    expect(pill.querySelector('.reviewer-login')?.textContent).toBe('bob')
    expect([...pill.querySelectorAll('.reviewer-count')].map(c => [c.className, c.textContent])).toEqual([
      ['reviewer-count bad', '1'],
      ['reviewer-count muted', '23'],
    ])
    expect(pill.getAttribute('aria-label')).toBe('bob: 1 change request, 23 comments')
    const more = /** @type {HTMLButtonElement} */ (box.querySelector('button.reviewer-more-button'))
    expect(more.textContent).toBe('+2')
    expect(more.getAttribute('aria-label')).toBe(
      '2 more reviewers: alice: 1 approval; a-reviewer-with-a-rather-long-username: 1 approval, 1 dismissed review, 2 comments'
    )
  })

  it('lists only the others in the popup, with their counts and whole logins', () => {
    const popup = /** @type {HTMLElement} */ (reviewersNode(document, THREE).querySelector('.reviewer-popup'))
    expect(popup.getAttribute('aria-hidden')).toBe('true')
    const rows = [...popup.querySelectorAll('li')].map(li => ({
      counts: [...li.querySelectorAll('.reviewer-count')].map(c => c.textContent),
      login: li.querySelector('.reviewer-login')?.textContent,
    }))
    expect(rows).toEqual([
      { counts: ['1'], login: 'alice' },
      { counts: ['1', '1', '2'], login: 'a-reviewer-with-a-rather-long-username' },
    ])
  })

  it('shows no +N when the featured person is the only one', () => {
    const box = reviewersNode(document, [makeReviewer('alice', { approvals: 1 })])
    expect(box.querySelector('.reviewer-pill')?.textContent).toBe('1alice')
    expect(box.querySelector('button')).toBeNull()
  })

  it('shows only +N, for everyone, when nobody can be featured', () => {
    const box = reviewersNode(document, [
      makeReviewer('x', { dismissed: 2 }),
      makeReviewer('y', { dismissed: 1 }),
    ])
    expect(box.querySelectorAll('.reviewer-pill')).toHaveLength(1)
    const more = /** @type {HTMLButtonElement} */ (box.querySelector('button'))
    expect(more.textContent).toBe('+2')
    expect(more.getAttribute('aria-label')).toBe('2 reviewers: x: 2 dismissed reviews; y: 1 dismissed review')
    const one = reviewersNode(document, [makeReviewer('x', { dismissed: 1 })]).querySelector('button')
    expect(one?.getAttribute('aria-label')).toBe('1 reviewer: x: 1 dismissed review')
    const oneMore = reviewersNode(document, [
      makeReviewer('a', { approvals: 1 }),
      makeReviewer('b', { comments: 1 }),
    ]).querySelector('button')
    expect(oneMore?.getAttribute('aria-label')).toBe('1 more reviewer: b: 1 comment')
  })

  it('closes the popup on Escape until the pointer or focus leaves', () => {
    const wrap = /** @type {HTMLElement} */ (reviewersNode(document, THREE).querySelector('.reviewer-more'))
    wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(wrap.classList.contains('popup-closed')).toBe(false)
    wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrap.classList.contains('popup-closed')).toBe(true)
    wrap.dispatchEvent(new MouseEvent('mouseleave'))
    expect(wrap.classList.contains('popup-closed')).toBe(false)
    wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    wrap.dispatchEvent(new FocusEvent('focusout'))
    expect(wrap.classList.contains('popup-closed')).toBe(false)
  })

  it('says nobody reviewed yet', () => {
    const box = reviewersNode(document, [])
    expect(box.textContent).toBe('—')
    expect(box.querySelector('[aria-label="No reviews yet"]')).not.toBeNull()
  })

  it('keeps a login as text', () => {
    const box = reviewersNode(document, [makeReviewer('<b>x</b>', { approvals: 1 })])
    expect(box.querySelector('b')).toBeNull()
  })
})

describe('baseColor', () => {
  it('gives a main branch its color and any other branch gray', () => {
    const branches = [...DEFAULT_BRANCHES, { name: 'hotfix', color: /** @type {const} */ ('red') }]
    expect(baseColor('main', branches)).toBe('green')
    expect(baseColor('hotfix', branches)).toBe('red')
    expect(baseColor('feature-a', branches)).toBe('gray')
    expect(baseColor('Main', branches)).toBe('gray')
  })
})

describe('Canvas and Bots in the column', () => {
  const canvas = makeReviewer('Canvas', {
    kind: 'canvas',
    comments: 3,
    lastCommentAt: '2026-10-09T00:00:00Z',
  })
  const bots = makeReviewer('Bots', {
    kind: 'bots',
    members: ['coderabbitai[bot]', 'sourcery-ai[bot]'],
    changesRequested: 1,
    comments: 9,
    lastChangeRequestAt: '2026-10-10T00:00:00Z',
  })

  it('puts any person first, even one who only commented, before Canvas and Bots', () => {
    const carol = makeReviewer('carol', { comments: 1, lastCommentAt: '2026-10-01T00:00:00Z' })
    expect(featured([carol, canvas, bots])?.reviewer).toBe(carol)
  })

  it('names Canvas, then Bots, when no person reviewed', () => {
    expect(featured([canvas, bots])?.reviewer).toBe(canvas)
    expect(featured([bots])).toEqual({ reviewer: bots, why: 'changesRequested' })
    expect(featured([makeReviewer('erin', { dismissed: 1 }), bots])?.reviewer).toBe(bots)
  })

  it('says who a group stands for in words, and shows its short name', () => {
    expect(reviewerText(bots)).toBe(
      'Bots (coderabbitai[bot], sourcery-ai[bot]): 1 change request, 9 comments'
    )
    expect(reviewerText(canvas)).toBe('Canvas: 3 comments')
    const node = reviewersNode(document, [canvas, bots])
    const logins = [...node.querySelectorAll('.reviewer-login')]
    expect(logins.map(l => [l.textContent, l.className, l.getAttribute('title')])).toEqual([
      ['Canvas', 'reviewer-login reviewer-group', null],
      ['Bots', 'reviewer-login reviewer-group', 'coderabbitai[bot], sourcery-ai[bot]'],
    ])
  })

  it('reads an entry saved before kinds and members as a person, and a group without members', () => {
    const old = /** @type {import('../../../src/lists/model.ts').Reviewer} */ (
      /** @type {unknown} */ ({
        ...makeReviewer('dave', { approvals: 1, lastApprovalAt: '2026-10-02T00:00:00Z' }),
        kind: undefined,
      })
    )
    expect(featured([old, canvas])?.reviewer).toBe(old)
    const bare = /** @type {import('../../../src/lists/model.ts').Reviewer} */ (
      /** @type {unknown} */ ({
        ...makeReviewer('Bots', { kind: 'bots', comments: 1 }),
        members: undefined,
      })
    )
    expect(reviewerText(bare)).toBe('Bots (): 1 comment')
    expect(reviewersNode(document, [bare]).querySelector('.reviewer-login')?.getAttribute('title')).toBe('')
  })
})
