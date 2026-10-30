// The rules both forges' fetches share: who reviewed a PR, and what on it waits on whom.
import type { Activity, ReviewNode, Said } from './model.js'
import { tallyMarkdown } from '../review/self-review.js'
import { authorPending, canvasOpenOf, canvasShasOf, mentions, reviewerPending, reviewersOf } from './rules.js'

const said = (author: string, createdAt: string, body = 'ok', bot = false): Said => ({
  author,
  bot,
  createdAt,
  body,
})

const review = (
  author: string,
  state: ReviewNode['state'],
  submittedAt: string,
  over: Partial<ReviewNode> = {}
): ReviewNode => ({ author, bot: false, state, submittedAt, inline: 0, body: '', ...over })

const activity = (over: Partial<Activity> = {}): Activity => ({
  comments: [],
  reviews: [],
  threads: [],
  ...over,
})

const T1 = '2026-10-01T10:00:00Z'
const T2 = '2026-10-02T10:00:00Z'
const T3 = '2026-10-03T10:00:00Z'
const T4 = '2026-10-04T10:00:00Z'
const MARKER = '<!-- pr-review-canvas:v1 -->'

describe('reviewersOf', () => {
  it('counts approvals, change requests, dismissals and comments, leaving the author out', () => {
    const reviewers = reviewersOf(
      'octo',
      [
        review('ana', 'APPROVED', T2),
        review('ana', 'APPROVED', T1),
        review('bob', 'CHANGES_REQUESTED', T1, { inline: 2 }),
        review('bob', 'CHANGES_REQUESTED', T3),
        review('cy', 'COMMENTED', T1),
        review('cy', 'DISMISSED', T2, { inline: 1 }),
        review('octo', 'COMMENTED', T1),
      ],
      [said('cy', T3), said('cy', T2), said('octo', T4)]
    )
    expect(reviewers.map(r => r.login)).toEqual(['bob', 'ana', 'cy'])
    const [bob, ana, cy] = reviewers
    expect(bob).toMatchObject({
      changesRequested: 2,
      comments: 2,
      lastChangeRequestAt: T3,
      lastCommentAt: T1,
    })
    expect(ana).toMatchObject({ approvals: 2, comments: 0, lastApprovalAt: T2, lastCommentAt: null })
    expect(cy).toMatchObject({ dismissed: 1, comments: 4, lastCommentAt: T3 })
  })

  it('puts every bot in one entry and canvas posts in another, after the people', () => {
    const reviewers = reviewersOf(
      'octo',
      [
        review('renovate[bot]', 'COMMENTED', T1, { bot: true }),
        review('ana', 'APPROVED', T2, { body: 'Posted from pr-review canvas', inline: 2 }),
      ],
      [
        said('renovate[bot]', T2, 'again', true),
        said('ci-bot', T3, 'hi', true),
        said('ana', T3, `${MARKER}\nPR Review Canvas for commit abcdef1`),
        said('dee', T1),
      ]
    )
    expect(reviewers.map(r => [r.login, r.kind])).toEqual([
      ['ana', 'person'],
      ['dee', 'person'],
      ['Canvas', 'canvas'],
      ['Bots', 'bots'],
    ])
    expect(reviewers[0]).toMatchObject({ approvals: 1, comments: 0 })
    expect(reviewers[2]).toMatchObject({ comments: 3 })
    expect(reviewers[3]).toMatchObject({ members: ['renovate[bot]', 'ci-bot'], comments: 3 })
  })

  it('drops someone whose only review came from the canvas with nothing of their own', () => {
    const reviewers = reviewersOf(
      'octo',
      [review('ana', 'COMMENTED', T1, { body: 'Sent from pr-review canvas' })],
      []
    )
    expect(reviewers.map(r => r.login)).toEqual(['Canvas'])
  })

  it('orders people with the same standing by comment count', () => {
    const reviewers = reviewersOf('octo', [], [said('ana', T1), said('bob', T1), said('bob', T2)])
    expect(reviewers.map(r => r.login)).toEqual(['bob', 'ana'])
  })
})

describe('mentions', () => {
  it('finds @login by itself, ignoring case', () => {
    expect(mentions('thanks @Ana!', 'ana')).toBe(true)
    expect(mentions('@ana please look', 'ana')).toBe(true)
    expect(mentions('(@ana)', 'ana')).toBe(true)
  })

  it('ignores longer names, emails, paths and an empty login', () => {
    expect(mentions('@anabel', 'ana')).toBe(false)
    expect(mentions('@ana-b', 'ana')).toBe(false)
    expect(mentions('mail ana@ana.dev', 'ana')).toBe(false)
    expect(mentions('see org/@ana', 'ana')).toBe(false)
    expect(mentions('@ana', '')).toBe(false)
    expect(mentions('no one here', 'ana')).toBe(false)
  })

  it('escapes logins with regex characters', () => {
    expect(mentions('cc @bot.x', 'bot.x')).toBe(true)
    expect(mentions('cc @botax', 'bot.x')).toBe(false)
  })
})

describe('authorPending', () => {
  it('counts open threads waiting on you, standing change requests and later comments', () => {
    const count = authorPending(
      activity({
        threads: [
          { resolved: false, comments: [said('me', T1), said('ana', T2)] },
          { resolved: false, comments: [said('ana', T1), said('me', T2)] },
          { resolved: false, comments: [said('me', T1)] },
          { resolved: false, comments: [] },
          { resolved: true, comments: [said('ana', T3)] },
        ],
        reviews: [
          review('bob', 'APPROVED', T1),
          review('bob', 'CHANGES_REQUESTED', T2),
          review('cy', 'CHANGES_REQUESTED', T2),
          review('cy', 'APPROVED', T1),
          review('dee', 'CHANGES_REQUESTED', T3),
          review('dee', 'APPROVED', T4),
          review('me', 'CHANGES_REQUESTED', T1),
          review('ana', 'COMMENTED', T4),
          { ...review('ci', 'CHANGES_REQUESTED', T1), bot: true },
        ],
        comments: [
          said('ana', T1),
          said('me', T2),
          said('ana', T3),
          said('ci', T4, 'build', true),
          said('ana', T4, MARKER),
          said('me', T4),
        ],
      }),
      'me'
    )
    // Threads: 2 (another's last word, only yours). Change requests: bob, cy. Comments: ana at T3
    // is before your last word at T4, so none.
    expect(count).toBe(4)
  })

  it('counts every comment when you never spoke', () => {
    expect(authorPending(activity({ comments: [said('ana', T1), said('bob', T2)] }), 'me')).toBe(2)
  })

  it('counts a comment after your last word in a thread', () => {
    const count = authorPending(
      activity({
        comments: [said('ana', T3)],
        threads: [{ resolved: true, comments: [said('me', T2)] }],
      }),
      'me'
    )
    expect(count).toBe(1)
  })
})

describe('reviewerPending', () => {
  it('splits threads by whether they name you after your last word there', () => {
    const counts = reviewerPending(
      activity({
        threads: [
          { resolved: false, comments: [said('ana', T1, '@me what do you think?')] },
          { resolved: false, comments: [said('ana', T1, '@me ping'), said('me', T2, 'answered')] },
          {
            resolved: false,
            comments: [said('me', T2, 'mine'), said('ana', T1, '@me out of order')],
          },
          { resolved: false, comments: [said('me', T1), said('ana', T2, '@me again')] },
          { resolved: false, comments: [said('ana', T1, 'no mention')] },
          { resolved: true, comments: [said('ana', T1, '@me resolved')] },
        ],
      }),
      'me'
    )
    expect(counts).toEqual({ you: 2, others: 3 })
  })

  it('splits standing change requests by whether they name you, skipping yours', () => {
    const counts = reviewerPending(
      activity({
        reviews: [
          review('ana', 'CHANGES_REQUESTED', T1, { body: '@me see the API' }),
          review('bob', 'CHANGES_REQUESTED', T1, { body: 'fix it' }),
          review('me', 'CHANGES_REQUESTED', T1),
          review('cy', 'APPROVED', T1),
        ],
      }),
      'me'
    )
    // ana's change request names you twice over: as a standing change request only.
    expect(counts).toEqual({ you: 1, others: 1 })
  })

  it('counts conversation comments and reviews that name you after your last word', () => {
    const counts = reviewerPending(
      activity({
        comments: [
          said('ana', T1, '@me before'),
          said('me', T2),
          said('ana', T3, '@me after'),
          said('bob', T3, 'no mention'),
          said('me', T1, '@me talking to myself'),
        ],
        reviews: [
          review('ana', 'COMMENTED', T1, { body: '@me early' }),
          review('bob', 'APPROVED', T3, { body: 'LGTM @me' }),
          review('cy', 'COMMENTED', T3, { body: 'nothing' }),
        ],
      }),
      'me'
    )
    expect(counts).toEqual({ you: 2, others: 0 })
  })

  it('counts every mention when you never spoke', () => {
    const counts = reviewerPending(
      activity({
        comments: [said('ana', T1, '@me hi')],
        reviews: [review('ana', 'COMMENTED', T1, { body: '@me look' })],
      }),
      'me'
    )
    expect(counts).toEqual({ you: 2, others: 0 })
  })
})

describe('canvasShasOf', () => {
  it('keeps the commits canvas comments name, oldest first', () => {
    const shas = canvasShasOf([
      said('ana', T1, `${MARKER}\nPR Review Canvas for commit abcdef1`),
      said('ana', T2, 'PR Review Canvas for commit 1234567 without the marker'),
      said('ana', T3, `${MARKER}\nno commit named`),
      said('ana', T4, `${MARKER}\nPR Review Canvas for commit ${'f'.repeat(40)}`),
    ])
    expect(shas).toEqual(['abcdef1', 'f'.repeat(40)])
  })
})

describe('canvasOpenOf', () => {
  /** A canvas comment whose tally the publish step writes. */
  const canvas = (
    at: string,
    reviewer: { decide: number; check: number; fyi: number },
    authorOpen = 0,
    settled = 0
  ) =>
    said(
      'ana',
      at,
      `${MARKER}\nPR Review Canvas for commit abcdef1\n\n${tallyMarkdown({ reviewer, authorOpen, settled })}`
    )

  it('is null without a canvas comment', () => {
    expect(canvasOpenOf([])).toBeNull()
    expect(canvasOpenOf([said('ana', T1, '**For the reviewer:** 2 attention points to judge.')])).toBeNull()
  })

  it('reads the reviewer’s and the author’s open points from the tally publish writes', () => {
    expect(canvasOpenOf([canvas(T1, { decide: 1, check: 2, fyi: 0 }, 3, 1)])).toEqual({
      author: 3,
      reviewer: 3,
    })
    expect(canvasOpenOf([canvas(T1, { decide: 0, check: 0, fyi: 1 })])).toEqual({ author: 0, reviewer: 1 })
  })

  it('reads no open points for the reviewer as zero, with or without the author’s', () => {
    expect(canvasOpenOf([canvas(T1, { decide: 0, check: 0, fyi: 0 })])).toEqual({ author: 0, reviewer: 0 })
    expect(canvasOpenOf([canvas(T1, { decide: 0, check: 0, fyi: 0 }, 2)])).toEqual({ author: 2, reviewer: 0 })
  })

  it('reads the latest canvas comment only, even when its tally does not read', () => {
    const older = canvas(T1, { decide: 2, check: 0, fyi: 0 }, 1)
    const newer = canvas(T3, { decide: 0, check: 1, fyi: 0 })
    expect(canvasOpenOf([older, said('bob', T2, 'Looks fine'), newer])).toEqual({ author: 0, reviewer: 1 })
    // A canvas comment of an older format, with no tally: nothing to count from.
    expect(
      canvasOpenOf([older, said('ana', T4, `${MARKER}\nPR Review Canvas for commit 1234567`)])
    ).toBeNull()
  })
})
