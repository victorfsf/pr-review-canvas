// CI that never ran: a forge leaves a required check "waiting for status to be reported" when its
// workflow never started (for example, pull_request workflows do not run while a PR has merge
// conflicts), and a check can sit queued with no runner. This tells such a PR apart from one
// whose CI is just slow, or was just pushed.
import type { Health } from '../../static/js/lists/health.js'
import type { ListPull } from './model.js'

/** How long the head commit may go without its checks starting before it counts as stuck. */
export const STUCK_AFTER_MS = 20 * 60 * 1000

/**
 * Why a PR's CI is stuck, or null when it is not. A required check GitHub still expects counts at
 * once. Otherwise, once the head commit is older than `STUCK_AFTER_MS`: checks that are all queued
 * or none at all, the latter only when other PRs in the repo do have checks (some repos run none).
 * Queued checks count only once each has waited that long too: a comment or a re-run can queue a
 * new one on an old commit, and it usually starts within seconds.
 */
export function ciStuck(
  activity: Pick<ListPull, 'checks' | 'headCommittedAt'>,
  now: string,
  repoHasChecks: boolean
): string | null {
  const { checks } = activity
  if (checks.some(c => c.status === 'expected')) return 'waiting for status to be reported'
  if (activity.headCommittedAt === null) return null
  if (Date.parse(now) - Date.parse(activity.headCommittedAt) < STUCK_AFTER_MS) return null
  if (checks.length === 0) return repoHasChecks ? 'no checks started' : null
  const unfinished = checks.filter(c => c.status === 'queued' || c.status === 'pending')
  const waitedLong = (c: (typeof checks)[number]) =>
    c.since === undefined || c.since === null || Date.parse(now) - Date.parse(c.since) >= STUCK_AFTER_MS
  if (unfinished.length > 0 && unfinished.every(c => c.status === 'queued' && waitedLong(c)))
    return 'checks queued, none running'
  return null
}

/** Whether any PR in a fetch has checks, which says the repo runs CI at all. */
export function anyChecks(pulls: readonly Pick<ListPull, 'checks'>[]): boolean {
  return pulls.some(p => p.checks.length > 0)
}

/**
 * A PR's health for the Status column: how its head commit's checks stand, whether CI is stuck,
 * and whether it conflicts with its base. The forge's "not known yet" is no conflict.
 */
export function healthOf(
  head: Pick<ListPull, 'checks' | 'headCommittedAt' | 'mergeable'>,
  now: string,
  repoHasChecks: boolean
): Health {
  const failing = head.checks.filter(c => c.status === 'fail').length
  const running = head.checks.some(
    c => c.status === 'pending' || c.status === 'queued' || c.status === 'expected'
  )
  return {
    ci: failing > 0 ? 'failing' : running ? 'running' : head.checks.length > 0 ? 'passing' : 'none',
    failing,
    stuck: ciStuck(head, now, repoHasChecks),
    conflict: head.mergeable === 'CONFLICTING',
  }
}
