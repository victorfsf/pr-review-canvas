// @ts-check
// The page's view in its address: filters, sorts, tabs, which tables are folded, and the thread on
// screen go in the query, so a copied or bookmarked URL opens the same view. Changes replace the
// current history entry, so Back still leaves the page instead of stepping through each click.
import { notePath } from './back-link.js'

/** This page's query; empty outside a browser. */
export function queryParams() {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '')
  } catch {
    return new URLSearchParams()
  }
}

/**
 * Sets or removes query parameters: a string sets one value, a list one entry per item, and null
 * or an empty list removes the parameter. The others in the address stay as they are.
 * @param {Record<string, string | readonly string[] | null>} changes
 */
export function setQuery(changes) {
  const view = globalThis.window
  if (view?.history === undefined || view.location === undefined) return
  const url = new URL(view.location.href)
  for (const [name, value] of Object.entries(changes)) {
    url.searchParams.delete(name)
    if (value === null) continue
    for (const v of typeof value === 'string' ? [value] : value) url.searchParams.append(name, v)
  }
  const next = `${url.pathname}${url.search}${url.hash}`
  if (next === `${view.location.pathname}${view.location.search}${view.location.hash}`) return
  try {
    view.history.replaceState(view.history.state, '', next)
  } catch {
    return
  }
  if (view.document !== undefined) notePath(view.document)
}
