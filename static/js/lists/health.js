// @ts-check
// A PR's health at a glance, as the Your PRs and Review queue tables show it in their Status
// column: an icon for its CI (failing, running, stuck, or a check when its checks pass), then one
// for a merge conflict, side by side. A queue PR that
// asks you by name for your review leads with that. The server works it out from
// the head commit's checks; the pages only draw it.
import { el, iconNode } from './dom.js'
import { TEXTS } from './texts.js'

/**
 * `ci` is how the head commit's checks stand, failing first; `stuck` says why CI looks stuck
 * (see `ciStuck`), which can be so while other checks fail. `preview` is its Vercel preview, left
 * out where the repo does not show Vercel.
 * @typedef {{ ci: 'failing' | 'running' | 'passing' | 'none', failing: number,
 *   stuck: string | null, conflict: boolean,
 *   preview?: { state: 'ready' | 'building' | 'failed', url: string | null } | null }} Health
 */

const VERCEL_STATE = /** @type {Record<string, 'ready' | 'building' | 'failed'>} */ ({
  vercelReady: 'ready',
  vercelRunning: 'building',
  vercelFailed: 'failed',
})

/**
 * A PR's CI as one state, so the CI choices never overlap: failing first, then stuck, then running,
 * then passing; `none` when it has no checks and nothing is stuck.
 * @param {Health} health
 * @returns {'failing' | 'stuck' | 'running' | 'passing' | 'none'}
 */
export function ciState(health) {
  if (health.ci === 'failing') return 'failing'
  return health.stuck !== null ? 'stuck' : health.ci
}

/** What each status speaks of: a PR has exactly one status of each kind. */
export const STATUS_KIND = /** @type {Record<string, string>} */ ({
  failing: 'ci',
  passing: 'ci',
  running: 'ci',
  stuck: 'ci',
  conflict: 'merge',
  noConflict: 'merge',
  vercelReady: 'vercel',
  vercelRunning: 'vercel',
  vercelFailed: 'vercel',
})

/**
 * A PR's status of one kind: its CI state, its merge state, its Vercel preview. Null before a
 * sync read them, for CI with no checks, and for Vercel with no preview: every PR has both, so
 * neither has a choice for none.
 * @param {Health | null | undefined} health
 * @param {string} kind
 * @returns {string | null}
 */
export function healthStatus(health, kind) {
  if (health === null || health === undefined) return null
  if (kind === 'ci') return ciState(health) === 'none' ? null : ciState(health)
  if (kind === 'merge') return health.conflict ? 'conflict' : 'noConflict'
  const state = health.preview?.state
  return Object.keys(VERCEL_STATE).find(k => VERCEL_STATE[k] === state) ?? null
}

/**
 * The Status column's legend, in the cell's order: each icon with the tones it shows in and what it
 * means. `queue` lines show on the Review queue only; `vercel` lines only where the repo shows
 * Vercel previews.
 * @type {readonly { key: string, icon: string, tones: readonly string[], text: string, queue?: true, vercel?: true }[]}
 */
export const STATUS_LEGEND = [
  {
    key: 'requested',
    icon: 'userCheck',
    tones: ['acc'],
    text: TEXTS.pr.health.legend.requested,
    queue: true,
  },
  { key: 'failing', icon: 'circleX', tones: ['bad'], text: TEXTS.pr.health.legend.failing },
  { key: 'running', icon: 'rotateDot', tones: ['warn'], text: TEXTS.pr.health.legend.running },
  { key: 'stuck', icon: 'alertCircleFilled', tones: ['warn'], text: TEXTS.pr.health.legend.stuck },
  { key: 'passing', icon: 'check', tones: ['ok'], text: TEXTS.pr.health.legend.passing },
  { key: 'conflict', icon: 'pullConflict', tones: ['bad'], text: TEXTS.pr.health.legend.conflict },
  {
    key: 'vercel',
    icon: 'brandVercelFilled',
    tones: ['ok', 'warn', 'bad'],
    text: TEXTS.pr.health.legend.vercel,
    vercel: true,
  },
]

/**
 * The Status cell's marks, each with its icon, tone and what its tooltip says: the CI's state
 * (failing, running, stuck or passing), then a conflict, then the Vercel preview. Checks still
 * running show in yellow unless CI is stuck, which says more. Unknown health (before the
 * first sync that read the PR) and no checks show none.
 * @param {Health | null | undefined} health
 * @param {boolean} [requested] a queue PR that asks you by name for your review
 * @returns {{ icon: string, tone: string, text: string }[]}
 */
export function healthMarks(health, requested = false) {
  /** @type {{ icon: string, tone: string, text: string }[]} */
  const marks = requested ? [{ icon: 'userCheck', tone: 'acc', text: TEXTS.pr.health.marks.requested }] : []
  if (health === null || health === undefined) return marks
  if (health.ci === 'failing') {
    marks.push({ icon: 'circleX', tone: 'bad', text: TEXTS.pr.health.marks.failing(health.failing) })
  }
  if (health.ci === 'running' && health.stuck === null)
    marks.push({ icon: 'rotateDot', tone: 'warn', text: TEXTS.pr.health.marks.running })
  if (health.stuck !== null)
    marks.push({ icon: 'alertCircleFilled', tone: 'warn', text: TEXTS.pr.health.marks.stuck(health.stuck) })
  if (ciState(health) === 'passing')
    marks.push({ icon: 'check', tone: 'ok', text: TEXTS.pr.health.marks.passing })
  if (health.conflict) marks.push({ icon: 'pullConflict', tone: 'bad', text: TEXTS.pr.health.marks.conflict })
  const preview = health.preview
  if (preview !== null && preview !== undefined) {
    const [tone, said] =
      preview.state === 'ready'
        ? ['ok', 'ready']
        : preview.state === 'failed'
          ? ['bad', 'failed']
          : ['warn', 'running']
    marks.push({ icon: 'brandVercelFilled', tone, text: TEXTS.pr.health.marks.vercel(said) })
  }
  return marks
}

/**
 * The Status cell: one icon per mark, named for screen readers and with a tooltip on hover or focus.
 * @param {Document} doc
 * @param {Health | null | undefined} health
 * @param {boolean} [requested] a queue PR that asks you by name for your review
 */
export function healthNode(doc, health, requested = false) {
  const wrap = el(doc, 'span', 'health')
  for (const mark of healthMarks(health, requested)) {
    const icon = el(doc, 'span', `health-mark ${mark.tone}`)
    icon.setAttribute('role', 'img')
    icon.setAttribute('aria-label', mark.text)
    icon.title = mark.text
    // Problems take focus, so their tooltip shows from the keyboard too.
    if (mark.tone !== 'ok') icon.tabIndex = 0
    icon.append(iconNode(doc, mark.icon, 16))
    wrap.append(icon)
  }
  return wrap
}

/**
 * A PR's place when Status sorts ascending: what needs you most first, CI failing, a conflict,
 * CI stuck, checks running, passing, none, then a PR no sync has read yet.
 * @param {Health | null | undefined} health
 */
export function healthRank(health) {
  if (health === null || health === undefined) return 6
  if (health.ci === 'failing') return 0
  if (health.conflict) return 1
  if (health.stuck !== null) return 2
  return { running: 3, passing: 4, none: 5 }[health.ci] ?? 5
}
