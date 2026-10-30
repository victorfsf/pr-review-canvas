// @ts-check
// The "Reviewed by" column: the one entry that matters most for the PR with its approvals,
// change requests, dismissed reviews and comments, then "+N" for the others, whose counts show in
// a popup on hover or keyboard focus. An entry is a person, every bot together ("Bots"), or what
// was posted from PR Review Canvas ("Canvas"). The Your PRs page uses it, and the Review
// queue will. Logins come from GitHub and only ever become text.
import { iconSvg } from './icons.js'
import { TEXTS } from './texts.js'

/** @typedef {{ login: string, kind?: 'person' | 'bots' | 'canvas', members?: string[], approvals: number, changesRequested: number, comments: number, dismissed: number, lastApprovalAt: string | null, lastChangeRequestAt: string | null, lastCommentAt: string | null }} Reviewer */

/**
 * The kinds, in the order they show, each with its icon, tone, words (singular, plural) and the
 * line that explains it in the column's legend. A dismissed approval or change request counts
 * only as dismissed.
 * @type {readonly { key: 'approvals' | 'changesRequested' | 'dismissed' | 'comments', icon: string, tone: string, one: string, many: string, legend: string }[]}
 */
export const KINDS = [
  {
    key: 'approvals',
    icon: 'check',
    tone: 'ok',
    one: 'approval',
    many: 'approvals',
    legend: TEXTS.pr.reviewers.approvals,
  },
  {
    key: 'changesRequested',
    icon: 'fileDiff',
    tone: 'bad',
    one: 'change request',
    many: 'change requests',
    legend: TEXTS.pr.reviewers.changesRequested,
  },
  {
    key: 'dismissed',
    icon: 'ban',
    tone: 'muted',
    one: 'dismissed review',
    many: 'dismissed reviews',
    legend: TEXTS.pr.reviewers.dismissed,
  },
  {
    key: 'comments',
    icon: 'message',
    tone: 'muted',
    one: 'comment',
    many: 'comments',
    legend: TEXTS.pr.reviewers.comments,
  },
]

/**
 * The entry the column names, so the row says who matters at a glance. Among people: the last one
 * to request changes while any change request stands; else the last to approve; else the last to
 * comment. Only when no person did any of those, Canvas, then Bots. Null when nothing but
 * dismissed reviews is left.
 * @param {readonly Reviewer[]} reviewers
 * @returns {{ reviewer: Reviewer, why: 'changesRequested' | 'approvals' | 'comments' } | null}
 */
export function featured(reviewers) {
  const people = reviewers.filter(r => (r.kind ?? 'person') === 'person')
  return (
    lastBy(people) ??
    lastBy(reviewers.filter(r => r.kind === 'canvas')) ??
    lastBy(reviewers.filter(r => r.kind === 'bots'))
  )
}

/**
 * @param {readonly Reviewer[]} reviewers
 * @returns {{ reviewer: Reviewer, why: 'changesRequested' | 'approvals' | 'comments' } | null}
 */
function lastBy(reviewers) {
  /** @type {readonly ['changesRequested' | 'approvals' | 'comments', 'lastChangeRequestAt' | 'lastApprovalAt' | 'lastCommentAt'][]} */
  const order = [
    ['changesRequested', 'lastChangeRequestAt'],
    ['approvals', 'lastApprovalAt'],
    ['comments', 'lastCommentAt'],
  ]
  for (const [why, when] of order) {
    const candidates = reviewers.filter(r => r[why] > 0)
    if (candidates.length === 0) continue
    const last = candidates.reduce((best, r) => ((r[when] ?? '') > (best[when] ?? '') ? r : best))
    return { reviewer: last, why }
  }
  return null
}

/**
 * One kind's count in words: "1 approval", "23 comments".
 * @param {(typeof KINDS)[number]} kind
 * @param {number} count
 */
function countWords(kind, count) {
  return `${count} ${count === 1 ? kind.one : kind.many}`
}

/**
 * An entry's name: a login, "PR Review Canvas", or "Bots" with the bots it stands for.
 * @param {Reviewer} reviewer
 */
export function reviewerName(reviewer) {
  if (reviewer.kind === 'canvas') return 'Canvas'
  if (reviewer.kind === 'bots') return `Bots (${(reviewer.members ?? []).join(', ')})`
  return reviewer.login
}

/**
 * An entry and its counts in words, for the button's label: "bob: 1 change request, 3 comments".
 * @param {Reviewer} reviewer
 */
export function reviewerText(reviewer) {
  const parts = KINDS.filter(k => reviewer[k.key] > 0).map(k => countWords(k, reviewer[k.key]))
  return `${reviewerName(reviewer)}: ${parts.join(', ')}`
}

/**
 * An icon and a number in the kind's tone.
 * @param {Document} doc
 * @param {(typeof KINDS)[number]} kind
 * @param {number} count
 */
function countNode(doc, kind, count) {
  const part = doc.createElement('span')
  part.className = `reviewer-count ${kind.tone}`
  const template = doc.createElement('template')
  template.innerHTML = iconSvg(kind.icon, 14)
  part.append(template.content, String(count))
  return part
}

/**
 * A person's own counts, then their whole login: the featured pill and each popup row.
 * @param {Document} doc
 * @param {string} tag
 * @param {string} className
 * @param {Reviewer} reviewer
 */
function personNode(doc, tag, className, reviewer) {
  const node = doc.createElement(tag)
  node.className = className
  const counts = doc.createElement('span')
  counts.className = 'reviewer-counts'
  for (const kind of KINDS) {
    if (reviewer[kind.key] > 0) counts.append(countNode(doc, kind, reviewer[kind.key]))
  }
  const name = doc.createElement('span')
  name.className = `reviewer-login${reviewer.kind === 'bots' || reviewer.kind === 'canvas' ? ' reviewer-group' : ''}`
  name.textContent = reviewer.login
  if (reviewer.kind === 'bots') name.title = (reviewer.members ?? []).join(', ')
  node.append(counts, name)
  return node
}

/**
 * The column's content, two pills. The first is the featured person with their own counts. The
 * second, "+N", stands for everyone else; its popup lists them with their counts and whole
 * logins, on hover and on keyboard focus, and Escape closes it until the pointer or focus leaves.
 * Either pill is left out when it would be empty. A dash when nobody has reviewed yet.
 * @param {Document} doc
 * @param {readonly Reviewer[]} reviewers
 */
export function reviewersNode(doc, reviewers) {
  const box = doc.createElement('div')
  box.className = 'reviewers'
  if (reviewers.length === 0) {
    const none = doc.createElement('span')
    none.className = 'muted small'
    none.textContent = '—'
    none.title = TEXTS.pr.reviewers.none
    none.setAttribute('aria-label', TEXTS.pr.reviewers.none)
    box.append(none)
    return box
  }

  const first = featured(reviewers)?.reviewer ?? null
  if (first !== null) {
    const pill = personNode(doc, 'span', 'reviewer-pill', first)
    pill.title = reviewerText(first)
    pill.setAttribute('role', 'img')
    pill.setAttribute('aria-label', reviewerText(first))
    box.append(pill)
  }

  const others = reviewers.filter(r => r !== first)
  if (others.length === 0) return box

  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'reviewer-pill reviewer-more-button'
  button.textContent = `+${others.length}`
  const more = first === null ? '' : ' more'
  const people = others.length === 1 ? `1${more} reviewer` : `${others.length}${more} reviewers`
  button.setAttribute('aria-label', `${people}: ${others.map(reviewerText).join('; ')}`)

  // What a sighted reader sees on hover. The button's label already says all of it in words, so
  // the popup is hidden from assistive tech.
  const popup = doc.createElement('ul')
  popup.className = 'reviewer-popup'
  popup.setAttribute('aria-hidden', 'true')
  for (const reviewer of others) popup.append(personNode(doc, 'li', 'reviewer', reviewer))

  const wrap = doc.createElement('span')
  wrap.className = 'reviewer-more'
  wrap.addEventListener('keydown', event => {
    if (event.key === 'Escape') wrap.classList.add('popup-closed')
  })
  const reset = () => wrap.classList.remove('popup-closed')
  wrap.addEventListener('mouseleave', reset)
  wrap.addEventListener('focusout', reset)
  wrap.append(button, popup)
  box.append(wrap)
  return box
}
