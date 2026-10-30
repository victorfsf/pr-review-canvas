// Rows for the lists' tests: every field filled, any of them overridden.
import type { ListPull, Reviewer } from './model.js'

export function makeListPull(overrides: Partial<ListPull> = {}): ListPull {
  const number = overrides.number ?? 1
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/acme/widgets/pull/${number}`,
    author: 'octo',
    authorBot: false,
    isDraft: false,
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-02T10:00:00Z',
    readyAt: '2026-10-01T10:00:00Z',
    queuedAt: null,
    headRefName: `feature-${number}`,
    baseRefName: 'main',
    headSha: 'a'.repeat(40),
    labels: [],
    additions: 10,
    deletions: 2,
    reviewDecision: null,
    requested: false,
    requestedReviewers: [],
    reviewers: [],
    checks: [],
    headCommittedAt: null,
    mergeable: 'MERGEABLE',
    canvasShas: [],
    canvasOpen: null,
    pending: 0,
    waiting: 0,
    ...overrides,
  }
}

export function makeReviewer(overrides: Partial<Reviewer> = {}): Reviewer {
  return {
    login: 'ana',
    kind: 'person',
    members: [],
    approvals: 0,
    changesRequested: 0,
    comments: 0,
    dismissed: 0,
    lastApprovalAt: null,
    lastChangeRequestAt: null,
    lastCommentAt: null,
    ...overrides,
  }
}
