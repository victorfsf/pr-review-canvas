// @ts-check
// @vitest-environment happy-dom
// A saved search's row: Rename, Update to who is picked, and Delete, each saved for the repo.
import { flushSavedFilters, loadSearches, resetSavedFilters, saveSearches } from './filters.js'
import { savedSearchRow } from './saved-search-row.js'

const REPO = { owner: 'acme', name: 'widgets' }

/** @param {string} id */
const byId = id => /** @type {HTMLElement} */ (document.getElementById(id))
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  localStorage.clear()
  resetSavedFilters()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({}))
  )
  document.body.innerHTML = ''
  saveSearches(REPO, [
    { name: 'Core', logins: ['ana', 'bob'] },
    { name: 'Web', logins: ['cy'] },
  ])
})

afterEach(async () => {
  flushSavedFilters()
  await flush()
  vi.unstubAllGlobals()
})

/** The row for Core, with `picked` picked; `changed` counts the saves. */
const rowFor = (/** @type {readonly string[] | null} */ picked) => {
  const changed = vi.fn()
  const pick = /** @type {HTMLButtonElement} */ (document.createElement('button'))
  pick.className = 'saved-search'
  const row = savedSearchRow(document, pick, {
    repo: REPO,
    search: { name: 'Core', logins: ['ana', 'bob'] },
    picked,
    changed,
  })
  document.body.append(row)
  /** @param {string} label */
  const action = label =>
    /** @type {HTMLButtonElement} */ (row.querySelector(`[aria-label^="${label} saved search Core"]`))
  return { row, pick, changed, action }
}

describe('savedSearchRow', () => {
  it('puts the button first, then Rename, Update and Delete', () => {
    const { row, pick } = rowFor(['cy'])
    expect(row.className).toBe('preset-row people-row')
    expect(row.firstElementChild).toBe(pick)
    expect([...row.querySelectorAll('button')].slice(1).map(b => b.title)).toEqual([
      'Rename',
      'Update it to the people picked',
      'Delete',
    ])
  })

  it('renames it, refusing a blank name and one already taken, and keeps it on Cancel', async () => {
    const { action, changed } = rowFor(['cy'])
    action('Rename').click()
    const field = /** @type {HTMLInputElement} */ (byId('confirm-name'))
    expect(field.value).toBe('Core')
    field.value = ' '
    byId('confirm-ok').click()
    await flush()
    expect(document.querySelector('#confirm-dialog .notice')?.textContent).toBe('Give it a name.')
    field.value = 'Web'
    byId('confirm-ok').click()
    await flush()
    expect(document.querySelector('#confirm-dialog .notice')?.textContent).toBe(
      'There is already a saved search named “Web”.'
    )
    field.value = 'Backend'
    byId('confirm-ok').click()
    await flush()
    expect(loadSearches(REPO)).toEqual([
      { name: 'Backend', logins: ['ana', 'bob'] },
      { name: 'Web', logins: ['cy'] },
    ])
    expect(changed).toHaveBeenCalledTimes(1)
    // Its own name again, or Cancel, saves nothing.
    action('Rename').click()
    byId('confirm-ok').click()
    await flush()
    action('Rename').click()
    byId('confirm-cancel').click()
    await flush()
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('updates it to who is picked once confirmed, and only when that is someone else', async () => {
    expect(rowFor(null).action('Update').disabled).toBe(true)
    expect(rowFor([]).action('Update').title).toBe('Pick some people first')
    const same = rowFor(['bob', 'ana']).action('Update')
    expect([same.disabled, same.title]).toEqual([true, 'It has the people picked already'])
    document.body.replaceChildren()
    const { action, changed } = rowFor(['cy', 'ana'])
    action('Update').click()
    expect(byId('confirm-ok').className).toContain('primary-button')
    byId('confirm-cancel').click()
    await flush()
    expect(changed).not.toHaveBeenCalled()
    action('Update').click()
    byId('confirm-ok').click()
    await flush()
    expect(loadSearches(REPO)[0]).toEqual({ name: 'Core', logins: ['cy', 'ana'] })
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('deletes it once confirmed', async () => {
    const { action, changed, pick } = rowFor(['cy'])
    const clicked = vi.fn()
    pick.addEventListener('click', clicked)
    action('Delete').click()
    expect(byId('confirm-ok').className).toContain('danger-button')
    byId('confirm-cancel').click()
    await flush()
    expect(loadSearches(REPO)).toHaveLength(2)
    action('Delete').click()
    byId('confirm-ok').click()
    await flush()
    expect(loadSearches(REPO)).toEqual([{ name: 'Web', logins: ['cy'] }])
    expect(changed).toHaveBeenCalledTimes(1)
    // The actions are not the search's own button: they never apply it.
    expect(clicked).not.toHaveBeenCalled()
  })
})
