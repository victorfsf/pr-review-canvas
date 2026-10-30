// @ts-check

/** An API call that failed, with the server's code and hint when it sent the envelope. */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {string | undefined} hint
   */
  constructor(message, code, hint) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.hint = hint
  }
}

/**
 * Whether the page has started to leave, as a link to another page does: the browser cuts
 * off what the page was still asking for, which is no failure to show for the moment it has left.
 * A navigation that does not happen after all, or a page back from the cache, clears it.
 */
let leaving = false
globalThis.addEventListener?.('beforeunload', () => {
  leaving = true
})
globalThis.addEventListener?.('pageshow', () => {
  leaving = false
})

/** Tests start on a page that is not leaving. */
export function resetLeaving() {
  leaving = false
}

/**
 * The project's base path on the server, with a trailing slash, as the page's `main` names it: one
 * server serves every project under its own base.
 * @returns {string}
 */
export function projectBase() {
  const main = globalThis.document?.querySelector('main[data-base]')
  return main instanceof HTMLElement ? (main.dataset['base'] ?? '/') : '/'
}

/**
 * Calls this project's API and returns the parsed JSON.
 * A call the page's leaving cuts off never settles, so nothing shows an error on the way out.
 * @param {string} path under the project's api/
 * @param {RequestInit} [init]
 * @returns {Promise<any>}
 */
export async function api(path, init = {}) {
  let res
  try {
    res = await fetch(`${projectBase()}api/${path}`, init)
  } catch {
    if (leaving) return new Promise(() => undefined)
    throw new ApiError(
      'the review server did not answer',
      'SERVER_UNREACHABLE',
      'is pr-review serve still running?'
    )
  }
  const body = await res.json().catch(() => null)
  // Every answer is JSON: none is an answer cut off on its way.
  if (body === null && res.ok) {
    if (leaving) return new Promise(() => undefined)
    throw new ApiError('the answer from the review server was cut off', 'SERVER_UNREACHABLE', undefined)
  }
  if (!res.ok) {
    const error = body?.error
    throw new ApiError(
      error?.message ?? `request failed (${res.status})`,
      error?.code ?? 'INTERNAL',
      error?.hint
    )
  }
  return body
}
