// @ts-check
// The tables' Sync now button, an icon that spins while the list is read from the forge again, and
// each row's own sync button, which reads just that PR.
import { api } from './api.js'
import { iconNode } from './dom.js'
import { syncNowTip } from './time.js'

/** @param {Document} doc */
export function wireSyncNow(doc) {
  const button = doc.getElementById('sync-now')
  const main = doc.querySelector('main[data-page]')
  if (!(button instanceof HTMLButtonElement) || !(main instanceof HTMLElement)) return
  const kind = main.dataset['page'] === 'queue' ? 'queue' : 'pulls'
  button.addEventListener('click', async () => {
    button.disabled = true
    button.classList.add('syncing')
    button.setAttribute('aria-label', 'Syncing…')
    try {
      const { state } = await api(`lists/${kind}/sync`, { method: 'POST' })
      button.title = syncNowTip({ syncedAt: state.fetchedAt, error: state.error }, Date.now())
    } catch (err) {
      button.title = `Sync now · ${err instanceof Error ? err.message : String(err)}`
    } finally {
      button.disabled = false
      button.classList.remove('syncing')
      button.setAttribute('aria-label', 'Sync now')
      main.dispatchEvent(new Event('pr-greenlight:synced'))
    }
  })
}

/**
 * A row's sync button: it reads just that PR from the forge and spins until it lands, then the
 * table loads again. A failure stays in its tooltip until the next try.
 * @param {Document} doc
 * @param {'pulls' | 'queue'} kind the table the row is on
 * @param {number} number
 */
export function rowSyncButton(doc, kind, number) {
  const button = /** @type {HTMLButtonElement} */ (doc.createElement('button'))
  button.type = 'button'
  button.className = 'icon-button small-icon-button row-sync'
  button.append(iconNode(doc, 'refresh', 14))
  const name = (/** @type {string} */ text) => {
    button.title = text
    button.setAttribute('aria-label', text)
  }
  name(`Sync #${number}`)
  button.addEventListener('click', async () => {
    button.disabled = true
    button.classList.add('syncing')
    button.classList.remove('bad')
    button.setAttribute('aria-label', `Syncing #${number}…`)
    try {
      await api(`lists/${kind}/${number}/sync`, { method: 'POST' })
      name(`Sync #${number}`)
      doc.querySelector('main[data-page]')?.dispatchEvent(new Event('pr-greenlight:synced'))
    } catch (err) {
      button.classList.add('bad')
      name(`Sync #${number} · failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      button.disabled = false
      button.classList.remove('syncing')
    }
  })
  return button
}
