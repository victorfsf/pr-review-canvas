// @ts-check
// Who a PR asks to review it, on its row on Your PRs and the Review queue. A button opens a panel laid out as the Authors picker is: saved groups at the top, a click
// on one ticking all its people who can review (again, unticking them); then a searchable checkbox
// list, those ticked first, then the project's people, those on the PR before the
// rest, every one of them before anything is typed; then "Save as" to keep what is ticked as a
// group. The groups are the repo's saved searches, so the Authors
// pickers offer them too. Ticking sends nothing: closing the panel sends what changed, everyone in
// one request, in the background, and the canvas's toast says when the forge has it, or why it
// refused it.
// Anyone's PR in the lists can be changed. The page keeps one button and panel per PR, so a redraw
// puts the same button in the new row; the panel sits on the tables' main, fixed under its button,
// so a table that scrolls sideways or a column that is a CSS container neither clips nor moves it.
import { api } from './api.js'
import { button, debounce, el, iconNode, SEARCH_DEBOUNCE_MS } from './dom.js'
import { loadSearches, saveSearches } from './filters.js'
import { toast } from '../commands.js'
import { TEXTS } from './texts.js'

/**
 * Says what a send did in the canvas's own toast, as the review page says what it posted.
 * @param {{ title: string, context: string }} said
 * @param {boolean} failed
 */
const say = (said, failed) =>
  toast(
    /** @type {HTMLElement} */ (document.querySelector('main.lists') ?? document.body),
    said.context === '' ? said.title : `${said.title} · ${said.context}`,
    { failed }
  )

/** How many people the server lists for one lookup: past that, a group's people are each looked up. */
const LISTED = 100

/**
 * A page's review-request panels, one per PR. `list` is where the PR's routes sit: Your PRs'
 * (`pulls`) or the Review queue's.
 * @param {Document} doc
 * @param {{ owner: string, name: string }} repo
 * @param {'pulls' | 'queue'} list
 */
export function reviewRequests(doc, repo, list) {
  /** @type {Map<number, ReturnType<typeof make>>} */
  const kept = new Map()
  /** The PR whose panel is open. @type {number | null} */
  let open = null

  doc.addEventListener('click', event => {
    // A click that redrew what it hit, as a group or a box does, is inside: its target is gone.
    if (open === null || !(event.target instanceof Node) || !event.target.isConnected) return
    const found = kept.get(open)
    if (found === undefined || found.holds(event.target) || found.panel.contains(event.target)) return
    found.close()
  })
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape' && open !== null) kept.get(open)?.close(true)
  })
  // Fixed under its button, it follows the button when the page or a table scrolls.
  const follow = () => (open === null ? undefined : kept.get(open)?.place())
  doc.defaultView?.addEventListener('scroll', follow, true)
  doc.defaultView?.addEventListener('resize', follow)

  /**
   * The button and panel for PR `number`, made once.
   * @param {number} number
   */
  const make = number => {
    const T = TEXTS.pr.reviewRequests
    const base = `lists/${list}/${number}`
    const id = (/** @type {string} */ name) => `review-${number}-${name}`
    /** Every button made for the PR, one per row it shows on, a table's and Highest priority's. */
    const toggles = /** @type {HTMLButtonElement[]} */ ([])
    /** The button the panel opened from, which it sits under. */
    let toggle = /** @type {HTMLButtonElement | null} */ (null)

    const panel = el(doc, 'section', 'popover authors-panel review-panel')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-labelledby', id('title'))
    panel.hidden = true
    const title = el(doc, 'h2', 'panel-title', T.title(number))
    title.id = id('title')
    const groupSet = el(doc, 'fieldset', 'filter-group')
    const groups = el(doc, 'div')
    groupSet.append(el(doc, 'legend', 'filter-title', T.groups), groups)
    const head = el(doc, 'div', 'filter-head')
    const pickLabel = /** @type {HTMLLabelElement} */ (el(doc, 'label', 'filter-title', T.pick))
    pickLabel.htmlFor = id('search')
    const clear = button(doc, 'link-button', 'None')
    clear.setAttribute('aria-label', T.clear)
    const bulk = el(doc, 'span', 'filter-bulk')
    bulk.append(clear)
    head.append(pickLabel, bulk)
    const search = /** @type {HTMLInputElement} */ (el(doc, 'input', 'text-input'))
    search.type = 'search'
    search.id = id('search')
    search.placeholder = T.search
    search.autocomplete = 'off'
    const people = el(doc, 'ul', 'people-list')
    people.setAttribute('aria-label', T.pick)
    const count = el(doc, 'span', 'small muted')
    const changes = el(doc, 'p', 'small review-changes')
    const changeText = el(doc, 'span')
    const discard = button(doc, 'link-button', T.discard)
    changes.append(changeText, ' ', discard)
    const saveRow = el(doc, 'div', 'save-as')
    const saveLabel = /** @type {HTMLLabelElement} */ (el(doc, 'label', 'small', T.saveAs))
    saveLabel.htmlFor = id('save-as')
    const saveName = /** @type {HTMLInputElement} */ (el(doc, 'input', 'text-input'))
    saveName.type = 'text'
    saveName.id = id('save-as')
    saveName.maxLength = 40
    const save = button(doc, 'button small-button', T.save)
    saveRow.append(saveLabel, saveName, save)
    panel.append(title, groupSet, head, search, people, count, changes, saveRow)

    /** Whose PR it is, who cannot be asked. */
    let author = ''
    /** Who the forge asks, as last read, or as last sent while the forge has not answered yet. */
    let asked = /** @type {string[]} */ ([])
    /** Who is ticked: what closing the panel makes the forge ask. */
    let picked = /** @type {string[]} */ ([])
    /** Who the search offers for what is typed, with their names. */
    let offered = /** @type {{ login: string, name: string | null }[]} */ ([])
    /** Names as the lookup gave them, for those ticked. @type {Map<string, string | null>} */
    const names = new Map()
    /** What was sent and the forge has not answered yet: sends wait for the one before them. */
    let sending = Promise.resolve()
    let pending = 0
    /** Whether the panel waits for who the forge asks: nothing in it can be picked until then. */
    let loading = false

    const lower = (/** @type {string} */ s) => s.toLowerCase()
    const has = (/** @type {readonly string[]} */ logins, /** @type {string} */ login) =>
      logins.some(l => lower(l) === lower(login))
    const diff = () => ({
      add: picked.filter(l => !has(asked, l)),
      remove: asked.filter(l => !has(picked, l)),
    })
    /** The repo's collaborators the lookups found, by lower-case login: only they can be asked. */
    const known = new Set()
    /** Who can be ticked: a collaborator, never the PR's author. */
    const askable = (/** @type {string} */ login) => lower(login) !== lower(author) && known.has(lower(login))

    /** @param {string} login @param {boolean} on */
    const tick = (login, on) => {
      picked = on
        ? has(picked, login)
          ? picked
          : [...picked, login]
        : picked.filter(l => lower(l) !== lower(login))
      render()
    }

    const render = () => {
      const saved = loadSearches(repo)
      groups.replaceChildren(
        ...(saved.length === 0
          ? [el(doc, 'p', 'small muted', T.noGroups)]
          : saved.map(group => {
              const members = group.logins.filter(askable)
              const all = members.length > 0 && members.every(l => has(picked, l))
              const pick = button(doc, 'saved-search', '')
              pick.setAttribute('aria-pressed', String(all))
              pick.title = all ? T.groupRemove : T.groupAdd
              pick.append(el(doc, 'strong', undefined, group.name))
              if (group.logins.length > 0)
                pick.append(' ', el(doc, 'span', 'small muted', group.logins.join(', ')))
              pick.disabled = loading || members.length === 0
              pick.addEventListener('click', () => {
                picked = all
                  ? picked.filter(l => !has(members, l))
                  : [...picked, ...members.filter(l => !has(picked, l))]
                render()
              })
              return pick
            }))
      )
      const wanted = lower(search.value.trim().replace(/^@/, ''))
      const matches = (/** @type {string} */ login) =>
        wanted === '' || lower(login).includes(wanted) || lower(names.get(login) ?? '').includes(wanted)
      const rows = [
        ...picked.filter(matches).map(login => ({ login, name: names.get(login) ?? null })),
        ...offered.filter(p => askable(p.login) && !has(picked, p.login) && matches(p.login)),
      ]
      people.replaceChildren(
        ...(loading
          ? [el(doc, 'li', 'small muted', T.loading)]
          : rows.length === 0
            ? [el(doc, 'li', 'small muted', T.noMatch)]
            : rows.map(p => {
                const li = el(doc, 'li')
                const label = el(doc, 'label', 'check-row')
                const box = /** @type {HTMLInputElement} */ (el(doc, 'input'))
                box.type = 'checkbox'
                box.checked = has(picked, p.login)
                box.addEventListener('change', () => tick(p.login, box.checked))
                label.append(
                  box,
                  ` ${p.login}`,
                  ...(p.name === null ? [] : [el(doc, 'span', 'muted small people-count', p.name)])
                )
                li.append(label)
                return li
              }))
      )
      count.textContent = T.picked(picked.length)
      const { add, remove } = diff()
      changes.hidden = add.length === 0 && remove.length === 0
      changeText.textContent = changes.hidden ? '' : T.willSend(add, remove)
      save.disabled = loading || picked.length === 0
      clear.disabled = loading
      discard.disabled = loading
      place()
    }

    /**
     * The repo's collaborators matching `query`, those on the PR first, as the server lists them.
     * @param {string} query
     * @returns {Promise<{ login: string, name: string | null }[]>}
     */
    const collaborators = async query => {
      const found = /** @type {{ login: string, name: string | null }[]} */ (
        (await api(`${base}/reviewers/people?q=${encodeURIComponent(query)}`)).people
      )
      for (const p of found) {
        known.add(lower(p.login))
        names.set(p.login, p.name)
      }
      return found
    }

    /**
     * Who the list offers for what is typed. With nothing typed, every collaborator the forge lists;
     * typing filters them at once, then asks the forge for any it did not list.
     */
    let searches = 0
    const lookup = async () => {
      const query = search.value.trim().replace(/^@/, '')
      const mine = ++searches
      try {
        const found = await collaborators(query)
        if (mine !== searches) return
        offered =
          query === ''
            ? found
            : [
                ...found,
                ...offered.filter(
                  p =>
                    !has(
                      found.map(f => f.login),
                      p.login
                    )
                ),
              ]
      } catch {
        // The list offers whom it has; typing again asks again.
      }
      render()
    }

    /**
     * Looks up each saved group's people the list did not have, when the repo has more
     * collaborators than one lookup lists: a group ticks only those who can review.
     */
    const confirmGroups = async () => {
      if (offered.length < LISTED) return
      const unknown = [
        ...new Set(loadSearches(repo).flatMap(g => g.logins.filter(l => !known.has(lower(l))))),
      ].slice(0, 30)
      await Promise.all(unknown.map(login => collaborators(login).catch(() => [])))
      render()
    }
    search.addEventListener('input', () => render())
    search.addEventListener(
      'input',
      debounce(() => void lookup(), SEARCH_DEBOUNCE_MS)
    )
    search.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      // The first one not ticked yet.
      const first = people.querySelector('input:not(:checked)')
      if (first instanceof HTMLInputElement) first.click()
    })
    clear.addEventListener('click', () => {
      picked = []
      render()
    })
    discard.addEventListener('click', () => {
      picked = [...asked]
      render()
    })
    save.addEventListener('click', () => {
      const name = saveName.value.trim()
      if (name === '' || picked.length === 0) return
      saveSearches(repo, [...loadSearches(repo).filter(s => s.name !== name), { name, logins: [...picked] }])
      saveName.value = ''
      render()
    })

    /** Shows on the button that the forge has not answered yet, or that it has. */
    const busy = (/** @type {boolean} */ on) => {
      busyNow = on
      for (const t of toggles) paint(t)
    }

    /**
     * Sends what changed, in the background: the button says so until the forge answers, then a toast
     * says what it did, or why it refused, and who it asks goes back as it was.
     * @param {string[]} add
     * @param {string[]} remove
     */
    const send = (add, remove) => {
      const before = asked
      asked = [...picked]
      pending++
      busy(true)
      sending = sending.then(() => deliver(add, remove, before))
    }

    /**
     * One send, once the one before it is done. A later send still waiting keeps who it asks as
     * that one will make it.
     * @param {string[]} add
     * @param {string[]} remove
     * @param {string[]} before who it asked before this send
     */
    const deliver = async (add, remove, before) => {
      try {
        const answer = await api(`${base}/reviewers`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ add, remove }),
        })
        if (pending === 1) asked = answer.requested
        say(T.sent(number, add, remove), false)
      } catch (err) {
        asked = before
        say(T.failed(number, err instanceof Error ? err.message : String(err)), true)
      }
      pending--
      if (pending === 0) busy(false)
      if (open === number) render()
    }

    /** Under the button, ending at its right edge, kept on screen; above it when there is no room below. */
    const place = () => {
      const view = doc.defaultView
      if (view === null || panel.hidden) return
      // The text size zooms the page: places come zoomed, and the ones set are zoomed again.
      const zoom = Number(view.getComputedStyle(doc.documentElement).getPropertyValue('--zoom')) || 1
      if (toggle === null) return
      const box = toggle.getBoundingClientRect()
      const [right, top, bottom] = [box.right / zoom, box.top / zoom, box.bottom / zoom]
      const [wide, high] = [view.innerWidth / zoom, view.innerHeight / zoom]
      const [width, height] = [panel.offsetWidth, panel.offsetHeight]
      const left = Math.max(8, Math.min(right - width, wide - width - 8))
      const below = bottom + 6
      const up = below + height > high - 8 && top - 6 - height >= 8
      panel.style.left = `${left}px`
      panel.style.top = `${up ? top - 6 - height : Math.max(8, Math.min(below, high - height - 8))}px`
    }

    /** Closes the panel, and sends what changed. */
    const close = (refocus = false) => {
      if (panel.hidden) return
      panel.hidden = true
      panel.remove()
      toggle?.setAttribute('aria-expanded', 'false')
      if (open === number) open = null
      if (refocus) toggle?.focus()
      const { add, remove } = diff()
      if (add.length > 0 || remove.length > 0) send(add, remove)
    }

    /** Whether a send is on its way, which every button of the PR shows. */
    let busyNow = false
    /** @param {HTMLButtonElement} t */
    const paint = t => {
      t.classList.toggle('sending', busyNow)
      t.setAttribute('aria-busy', String(busyNow))
      t.title = busyNow ? T.sending : T.button
    }

    /** Opens the panel under `from`, or closes it when it is open under any of the PR's buttons. */
    const opened = async (/** @type {HTMLButtonElement} */ from) => {
      if (!panel.hidden) {
        const again = toggle === from
        close()
        if (again) return
      }
      if (open !== null) kept.get(open)?.close()
      open = number
      ;(doc.querySelector('main.lists') ?? doc.body).append(panel)
      panel.hidden = false
      toggle = from
      toggle.setAttribute('aria-expanded', 'true')
      search.value = ''
      // While a send is on its way, who it asks is what was sent; else the forge's, as last read.
      picked = [...asked]
      if (pending === 0) {
        loading = true
        render()
        try {
          const now = await api(`${base}/reviewers`)
          author = now.author
          asked = now.requested
        } catch {
          // Who it asked last stands; the forge's answer to the send says the rest.
        }
        loading = false
        picked = [...asked]
      }
      render()
      search.focus()
      await lookup()
      await confirmGroups()
    }

    /** A new button for one row: it opens the PR's panel. */
    const newButton = () => {
      const anchor = el(doc, 'span', 'review-anchor')
      const t = /** @type {HTMLButtonElement} */ (
        button(doc, 'icon-button small-icon-button review-open', '')
      )
      t.append(iconNode(doc, 'userPlus', 16))
      t.setAttribute('aria-label', T.buttonFor(number))
      t.setAttribute('aria-haspopup', 'dialog')
      t.setAttribute('aria-expanded', 'false')
      paint(t)
      t.addEventListener('click', () => void opened(t))
      anchor.append(t)
      toggles.push(t)
      return anchor
    }

    /** After a redraw: forgets the buttons gone, and the open panel moves under one still on the page, or closes. */
    const settle = () => {
      // A table draws its rows before it puts them on the page: only now can the buttons a redraw
      // left behind be told apart and forgotten.
      for (let i = toggles.length - 1; i >= 0; i--) if (!toggles[i]?.isConnected) toggles.splice(i, 1)
      if (panel.hidden) return
      if (toggle !== null && toggle.isConnected) {
        place()
        return
      }
      const still = toggles.find(t => t.isConnected)
      if (still === undefined) {
        close()
        return
      }
      toggle = still
      toggle.setAttribute('aria-expanded', 'true')
      place()
    }
    return {
      newButton,
      panel,
      close,
      place,
      settle,
      holds: (/** @type {Node} */ node) => toggles.some(t => t.contains(node)),
    }
  }

  return {
    /**
     * A button that opens PR `number`'s panel, for one row: a PR shown twice, in Highest priority
     * and its table, has one in each, both opening the same panel.
     * @param {number} number
     */
    button(number) {
      const found = kept.get(number) ?? make(number)
      kept.set(number, found)
      return found.newButton()
    },
    /** Call after each redraw: the open panel follows its button, or closes once its rows are gone. */
    drawn() {
      for (const found of kept.values()) found.settle()
    },
  }
}
