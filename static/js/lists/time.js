// @ts-check

/**
 * How long ago `iso` was, in the words the page uses: "just now", "5m ago", "3h ago",
 * "2 days ago".
 * @param {string} iso
 * @param {number} now milliseconds since the epoch
 */
export function ago(iso, now) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

/**
 * A length of time, compact: its largest unit and the next one down when that is not zero, as in
 * "1d 5h", "10h", "3h 10m", "3m 12s", "45s".
 * @param {number} ms
 */
export function duration(ms) {
  const seconds = Math.max(0, Math.round(ms / 1000))
  const units = /** @type {const} */ ([
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ])
  const i = units.findIndex(([, size]) => seconds >= size)
  if (i === -1) return '0s'
  const [unit, size] = /** @type {readonly [string, number]} */ (units[i])
  const whole = Math.floor(seconds / size)
  const next = units[i + 1]
  const rest = next === undefined ? 0 : Math.floor((seconds % size) / next[1])
  return next === undefined || rest === 0 ? `${whole}${unit}` : `${whole}${unit} ${rest}${next[0]}`
}

/**
 * Calls `tick` now and then once a second, until the function it returns is called: for a counter
 * of how long something has run.
 * @param {() => void} tick
 */
export function everySecond(tick) {
  tick()
  const id = setInterval(tick, 1000)
  return () => clearInterval(id)
}

/**
 * When `iso` was, as a clock time: "14:05" today, "Oct 22, 14:05" earlier this year, and with the
 * year before that, in the browser's locale.
 * @param {string} iso
 * @param {number} now milliseconds since the epoch
 */
export function stamp(iso, now) {
  const at = new Date(iso)
  const today = new Date(now)
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  if (at.toDateString() === today.toDateString()) return time
  const day = at.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  })
  return `${day}, ${time}`
}

/**
 * When `iso` was, in full, in the browser's locale and time zone: "October 28, 2026, 4:02 PM,
 * GMT-3". The tooltip of a time shown as how long ago it was.
 * @param {string} iso
 */
export function fullStamp(iso) {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  const day = at.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find(part => part.type === 'timeZoneName')?.value
  return zone === undefined ? `${day}, ${time}` : `${day}, ${time}, ${zone}`
}

/** Older than this, the page says when it last synced; younger, it stays quiet. */
export const STALE_MS = 10 * 60 * 1000

/**
 * The sync state in one line, for the Sync now button's title and the home page.
 * @param {{ syncedAt: string | null }} sync
 * @param {number} now
 */
export function syncedLabel(sync, now) {
  return sync.syncedAt === null ? 'Not synced yet' : `Synced ${ago(sync.syncedAt, now)}`
}

/**
 * The Sync now button's tooltip: what it does, then the sync state or why the last one failed.
 * @param {{ syncedAt: string | null, error?: string | null }} sync
 * @param {number} now
 */
export function syncNowTip(sync, now) {
  const state = sync.error ? `Last sync failed: ${sync.error}` : syncedLabel(sync, now)
  return `Sync now · ${state}`
}
