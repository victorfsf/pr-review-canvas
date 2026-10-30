// @ts-check
// The Review queue: other people's open PRs waiting for review, in the repo's sections, then the
// ones stacked on other branches; their drafts show when the state filter asks. Above them, Highest
// priority: the few PRs Claude picked by the repo's prompt, in its order, whatever the filters show.
// Filters stack and are saved per repo, or with the experimental filter builder on, its blocks
// filter in their place; the sort applies inside each section; saved author searches
// are the repo's, shared with the Inbox. Each table and section folds, and the rows are whole or
// slim (pr-table.js). Rows are built with DOM calls, and titles, logins, labels and Claude's
// reasons only ever become text.
import { api, projectBase } from './api.js'
import { baseColor, DEFAULT_BRANCHES } from './branches.js'
import {
  debounce,
  el,
  locNode,
  reloadOnChange,
  SYNCING_RELOAD_MS,
  showEmpty,
  SEARCH_DEBOUNCE_MS,
  showNavCounts,
  scrollWhenWide,
  trackHeadHeight,
  wireFilterPanel,
} from './dom.js'
import { filterKey, loadFilters, saveFilters, tick, ticked } from './filters.js'
import { ALL_STATES, countPulls, splitByBase } from './pulls.js'
import { activeBases, filterBases, wireBaseFilter } from './bases.js'
import {
  activeStack,
  byStackPosition,
  filterStack,
  nameStackHeading,
  shownStack,
  picksStack,
  stackNames,
  wireStackFilter,
} from './stack-pick.js'
import {
  filterQueue,
  isFiltered,
  labelChoices,
  pickedLabel,
  QUEUE_ACCEPT,
  QUEUE_DEFAULTS,
  queueAuthors,
  upgradeQueue,
  queueEmptyText,
  sortQueue,
  STATUS_TONE,
} from './queue.js'
import { reviewersNode } from './reviewers.js'
import { labelsNode, openRow, prTable, rowSpan, wireRowView } from './pr-table.js'
import { DEFAULT_SECTIONS, groupBySection, sectionTone } from './sections.js'
import { wireAuthorsPicker } from './authors-picker.js'
import { duration } from './time.js'
import { healthNode } from './health.js'
import { hasIntegration, wireIntegrationsFilter } from './integrations.js'
import {
  addKeyChips,
  markMatches,
  parseSearch,
  plural,
  searchEmpty,
  searchMatch,
  searchTerms,
  wireSearch,
} from './search.js'
import { quickLinks, stackPlace, titleMenu, wireTitleMenus } from './title-menu.js'
import { canvasAction, canvasCell, generating, pointsCell } from './canvas-cell.js'
import { withoutColumns } from './sorting.js'
import { columnsOn, QUEUE_COLUMNS, wireColumnsPicker } from './columns.js'
import { wireFolds } from './folds.js'
import { wireReviewsFilter } from './reviews-filter.js'
import { wireSavedFilters } from './saved-filters.js'
import { wireFilterBuilder } from './filter-builder.js'
import { filtersOn, markChanged, QUEUE_GROUPS, wireMoreFilters, wireStateFilter } from './filter-bar.js'
import { asOf, readyNode, stateMark } from './ready.js'
import { queueFields, queueSeed } from './builder-fields.js'
import { DEFAULT_PRIORITY_NAME, pickedRows } from './priority.js'
import { wirePriorityEditor } from './priority-editor.js'
import { ago, everySecond, fullStamp } from './time.js'
import { TEXTS } from './texts.js'
import { rowSyncButton } from './repo-actions.js'
import { reviewRequests } from './review-requests.js'

/** @typedef {import('./queue.js').QueueRow} QueueRow */
/** @typedef {import('./queue.js').SortKey} SortKey */

/**
 * One status cell's badge.
 * @param {Document} doc
 * @param {keyof typeof STATUS_TONE} status
 */
const statusBadge = (doc, status) => el(doc, 'span', `badge ${STATUS_TONE[status]}`, status)

/**
 * The Pending cell: what waits on you, then what waits on the author or other reviewers, as
 * "3 | 5"; nothing before a fetch read the PR's activity.
 * @param {Document} doc
 * @param {number | undefined} count
 * @param {number} [waiting]
 */
export function pendingBadge(doc, count, waiting) {
  const wrap = el(doc, 'span', 'pull-pending')
  if (count === undefined) return wrap
  const pill = el(doc, 'span', 'badge pending-pill')
  const mine = el(doc, 'span', count > 0 ? 'pending-count' : 'pending-count muted', String(count))
  mine.title = TEXTS.lists.queue.waitingOnYou(count)
  pill.append(mine)
  if (waiting !== undefined) {
    // A drawn line between the two numbers, not a character a screen reader would read out.
    const divider = el(doc, 'span', 'pending-divider')
    divider.setAttribute('aria-hidden', 'true')
    const others = el(doc, 'span', 'pending-count muted', String(waiting))
    others.title = TEXTS.lists.queue.waitingOnOthers(waiting)
    pill.append(divider, others)
  }
  wrap.append(pill)
  return wrap
}

/**
 * One PR's row; a Highest priority row also says why Claude picked it.
 * @param {Document} doc
 * @param {QueueRow & { why?: string }} row
 * @param {readonly import('./branches.js').MainBranch[]} branches
 * @param {(column: string) => boolean} shows which columns show (see columns.js)
 * @param {number} now
 * @param {boolean} anchor whether this row carries the PR's `pr-N` id, which links land on
 * @param {(stack: string) => void} pickStack keeps the list to a stack
 * @param {{ view: import('./pr-table.js').RowView, span: number } | null} slim the row on one line,
 *   with its arrow, and the cells its open part spans; null for a whole row
 * @param {(pr: number) => HTMLElement} reviewers the button that opens who it asks to review it
 * @returns {HTMLTableRowElement[]} the row, and its open part under it when slim and open
 */
function queueRow(doc, row, branches, shows, now, anchor, pickStack, slim, reviewers) {
  const tr = /** @type {HTMLTableRowElement} */ (el(doc, 'tr', 'queue-row'))
  // A notification or Inbox row about this PR links here, by this id: the copy in "From
  // notifications" when it is there, else the one in the queue.
  if (anchor) tr.id = `pr-${row.number}`
  const pr = el(doc, 'td', 'queue-pr')
  // Its canvas comes first in the title's menu and its links.
  const title = titleMenu(doc, row)
  // Its state's mark before the title, as on Your PRs: open, a draft, or in the merge queue; slim,
  // the arrow that opens the rest before it.
  const main = el(doc, 'div', 'pull-main')
  const text = el(doc, 'div', 'pull-text')
  if (slim !== null) main.append(slim.view.arrow(row.number))
  main.append(stateMark(doc, row), text)
  pr.append(main)
  text.append(title)
  const branch = el(doc, 'span', 'small muted pull-branch')
  const arrow = el(doc, 'span', 'branch-arrow', '←')
  arrow.setAttribute('aria-hidden', 'true')
  branch.append(
    el(doc, 'span', `branch-pill pill-${baseColor(row.baseRefName, branches)}`, row.baseRefName),
    arrow,
    el(doc, 'span', 'visually-hidden', ' from '),
    el(doc, 'span', 'branch-head', row.headRefName)
  )
  // A stacked PR's place in its stack, which keeps this list to the stack.
  const place = stackPlace(doc, row.stack, pickStack)
  if (place !== null) branch.append(place)
  branch.append(' · ', locNode(doc, row.additions, row.deletions))
  // The title menu's ways out, as icons after the size.
  branch.append(quickLinks(doc, row))
  const reason = row.why !== undefined && row.why !== ''
  const why = el(doc, 'span', 'small priority-why', row.why)
  // A long reason ends in an ellipsis; all of it shows on hover, and on a slim row, over its cell.
  why.title = row.why ?? ''
  if (slim === null) {
    text.append(branch)
    if (reason) text.append(why)
  } else {
    text.append(el(doc, 'span', 'slim-marks'))
    if (reason) pr.title = row.why ?? ''
  }

  /** A cell holding one node. @param {Node} node @param {string} [className] */
  const cell = (node, className) => {
    const td = el(doc, 'td', className)
    td.append(node)
    return td
  }
  const badges = labelsNode(doc, row.labels, slim !== null)
  /** @type {Record<(typeof QUEUE_COLUMNS)[number][0], () => HTMLElement>} */
  const cells = {
    status: () => cell(healthNode(doc, row.health, row.requested)),
    pending: () => cell(pendingBadge(doc, row.pending, row.waiting)),
    points: () => cell(pointsCell(doc, row.points)),
    reviewed: () => cell(reviewersNode(doc, row.reviewers)),
    author: () => el(doc, 'td', undefined, row.author),
    ready: () => cell(readyNode(doc, row, now)),
    labels: () => cell(badges),
    canvas: () => cell(canvasCell(doc, row)),
    codeRabbit: () => cell(statusBadge(doc, row.codeRabbit)),
  }
  const actions = el(doc, 'td', 'queue-actions')
  // Side by side, as on Your PRs.
  const buttons = el(doc, 'div', 'row-actions')
  // Generate, Regenerate or Open, by where its canvas stands.
  buttons.append(canvasAction(doc, row), reviewers(row.number), rowSyncButton(doc, 'queue', row.number))
  actions.append(buttons)

  tr.append(pr)
  for (const [key] of QUEUE_COLUMNS) if (shows(key)) tr.append(cells[key]())
  tr.append(actions)
  if (slim === null || !slim.view.isOpen(row.number)) return [tr]
  // Open: what its line left out, its branches and links, then why it was picked.
  const parts = /** @type {Node[]} */ ([branch])
  if (reason) parts.push(el(doc, 'span', 'small muted', row.why))
  return [tr, openRow(doc, slim.span, parts)]
}

/** @param {Document} doc */
export function wireQueuePage(doc) {
  const main = doc.querySelector('main[data-page="queue"]')
  if (!(main instanceof HTMLElement)) return
  wireTitleMenus(doc)
  const repo = { owner: main.dataset['owner'] ?? '', name: main.dataset['name'] ?? '' }
  /** Who each PR asks to review it: a popup per row, kept across redraws. */
  const requests = reviewRequests(doc, repo, 'queue')
  const key = filterKey(repo, 'queue')
  let filters = loadFilters(key, QUEUE_DEFAULTS, QUEUE_ACCEPT, upgradeQueue)
  /** @type {QueueRow[] | null} */
  let rows = null
  /** The project's people, whom the pickers offer beside those on the PRs. */
  let people = /** @type {string[]} */ ([])
  let sections = [...DEFAULT_SECTIONS]
  // The canvas is this app: its column always shows; CodeRabbit and Vercel are not read here.
  const codeRabbit = false
  const canvas = true
  const vercel = false
  /** @type {readonly import('./branches.js').MainBranch[]} */
  let branches = DEFAULT_BRANCHES
  /** @type {{ fetchedAt: string | null, error: string | null }} */
  let state = { fetchedAt: null, error: null }
  /** When the page last loaded the queue: the Ready column's clock while no fetch time is known. */
  let loadedAt = Date.now()
  /** No Jira cards are read here, so the search reads no keys. */
  const jiraOn = false
  /** The rows the filters and the search keep now, for Enter in the search box. */
  let matching = /** @type {readonly QueueRow[]} */ ([])
  /** What the search reads of a row. @param {QueueRow} r */
  const searchable = r => ({
    number: r.number,
    title: r.title,
    head: r.headRefName,
    base: r.baseRefName,
    keys: [],
  })

  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id))
  const table = get('queue-table')
  // Section rows stick under the column header, as far down as it is tall.
  const headHeight = trackHeadHeight(table)
  scrollWhenWide(main.querySelectorAll('.queue-table'))
  const empty = get('queue-empty')
  const error = get('queue-error')
  const stacked = get('queue-stacked')
  const stackedTable = get('queue-stacked-table')
  const reset = get('reset-filters')
  const stateFilter = wireStateFilter(doc, {
    picked: () => filters.state,
    pick: next => change({ state: next }),
    needs: () => filters.needsUpdate,
    setNeeds: on => change({ needsUpdate: on }),
  })
  const moreFilters = wireMoreFilters(doc, 'queue')
  // Each table folds from its heading and each section from its row; a fold redraws the tables.
  const folds = wireFolds(doc, { repo, page: 'queue', onChange: () => render() })
  // The rows whole or slim, from the toolbar, and which slim ones are open.
  const rowView = wireRowView(doc, { folds, render: () => render() })

  const change = (/** @type {Partial<typeof QUEUE_DEFAULTS>} */ next) => {
    filters = { ...filters, ...next }
    saveFilters(key, filters, QUEUE_DEFAULTS)
    render()
  }
  /** Keeps the list to `stack`, from its place on a row: the filter bar's Stack, every state. */
  // Only the open page keeps it (filters.js, `PAGE_ONLY`): a reload shows every PR again.
  const pickStack = (/** @type {string} */ stack) => change({ stack })

  /** A checkbox in a filter popover, with its count at the far end when given. */
  const box = (
    /** @type {string} */ label,
    /** @type {boolean} */ checked,
    /** @type {(on: boolean) => void} */ set,
    /** @type {number} */ count = -1
  ) => {
    const wrap = el(doc, 'label', 'check-row')
    const input = /** @type {HTMLInputElement} */ (el(doc, 'input'))
    input.type = 'checkbox'
    input.checked = checked
    input.addEventListener('change', () => set(input.checked))
    wrap.append(input, ` ${label}`)
    if (count >= 0) wrap.append(el(doc, 'span', 'muted small people-count', String(count)))
    return wrap
  }
  /** What the Labels search holds; the list shows only the labels that contain it. */
  let labelQuery = ''

  /**
   * Fills a status, label or problem popover.
   * @param {'labels'} name
   * @param {{ value: string, text: string, count?: number }[]} choices
   * @param {string} [query] keeps only the choices that contain it
   */
  const fillPicker = (name, choices, query = '') => {
    const chosen = filters[name]
    const wanted = query.trim().toLowerCase()
    const shown = choices.filter(c => wanted === '' || c.text.toLowerCase().includes(wanted))
    const all = choices.map(c => c.value)
    get(`${name}-label`).textContent = pickedLabel(
      chosen?.map(v => choices.find(c => c.value === v)?.text ?? v) ?? null,
      all.length
    )
    get(`${name}-options`).replaceChildren(
      ...(shown.length === 0
        ? [el(doc, 'span', 'small muted', TEXTS.lists.queue.noLabels)]
        : shown.map(c =>
            box(
              c.text,
              ticked(chosen, c.value),
              on => change({ [name]: tick(chosen, c.value, on, all) }),
              c.count
            )
          ))
    )
  }

  const integrations = wireIntegrationsFilter(doc, { picked: () => filters, pick: change })
  const reviews = wireReviewsFilter(doc, { picked: () => filters, pick: change, queue: true })
  const baseFilter = wireBaseFilter(doc, { picked: () => filters.bases, pick: bases => change({ bases }) })
  const stackFilter = wireStackFilter(doc, { picked: () => filters.stack, pick: stack => change({ stack }) })
  get('queue-show-all').addEventListener('click', () => change({ stack: '' }))
  const search = wireSearch(doc, {
    value: () => filters.q,
    set: q => change({ q }),
    single: () => {
      const [only, other] = matching
      return search.active() && only !== undefined && other === undefined
        ? `${projectBase()}review/${only.number}`
        : null
    },
  })
  const columns = wireColumnsPicker(doc, {
    repo,
    page: 'queue',
    columns: QUEUE_COLUMNS,
    available: () => columnsOn(QUEUE_COLUMNS, { canvas, codeRabbit }),
    // A hidden column leaves the sort too.
    onChange: hidden => change({ sort: withoutColumns(filters.sort, hidden) }),
  })
  const presets = wireSavedFilters(doc, {
    repo,
    page: 'queue',
    defaults: QUEUE_DEFAULTS,
    accept: QUEUE_ACCEPT,
    current: () => filters,
    apply: picked => change(picked),
    upgrade: upgradeQueue,
  })
  /** Which integrations the repo uses. */
  const on = () => ({ codeRabbit, vercel, canvas })
  const builder = wireFilterBuilder(doc, {
    fields: () =>
      queueFields({
        on: on(),
        branches,
        people,
        search: (r, words) => searchMatch(searchable(r), parseSearch(words), jiraOn) !== null,
      }),
    rows: () => rows ?? [],
    filters: () => filters,
    change,
    seed: f =>
      queueSeed(f, {
        on: on(),
        bases: activeBases(f.bases, branches),
        stack: activeStack(f.stack, stackNames(rows ?? [])),
      }),
    page: 'queue',
    saved: presets.saved,
    groups: () => authors.searches(),
    ask: body =>
      api('lists-builder/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  })
  const authors = wireAuthorsPicker(doc, {
    repo,
    picked: () => filters.authors,
    pick: picked => change({ authors: picked }),
    people: () => queueAuthors(rows ?? [], people),
  })

  /**
   * A table for some rows: the header with its sort buttons, then one body per non-empty group.
   * @param {{ name: string | null, tone: string, rows: QueueRow[] }[]} groups
   * @param {string} label
   * @param {(number: number) => boolean} [anchor] which rows carry their `pr-N` id
   * @param {{ sorted?: boolean }} [opts] unsorted, the rows keep their order and the header no sort
   *   buttons
   */
  const tableOf = (groups, label, anchor = n => !notified.includes(n), opts = {}) => {
    const sorted = opts.sorted !== false
    // Times count to the queue's last fetch, so they move with it alone.
    const now = asOf(state.fetchedAt, loadedAt)
    const shown = QUEUE_COLUMNS.filter(([column]) => columns.shows(column))
    const slim = rowView.slim() ? { view: rowView, span: rowSpan(shown.length) } : null
    const t = prTable(doc, {
      label,
      columns: shown,
      // Status says what its icons are, Pending what its two numbers are, and Reviewed by its
      // marks, behind a "?" each.
      help: { status: 'status-help', pending: 'pending-help', reviewed: 'reviewed-by-help' },
      sort: sorted
        ? { sort: filters.sort, onSort: sort => change({ sort }), sortable: column => column !== 'reviewed' }
        : null,
      groups: groups.map(g => ({ ...g, rows: sorted ? sortQueue(g.rows, filters.sort) : g.rows })),
      folds,
      rows: r =>
        queueRow(doc, r, branches, columns.shows, now, anchor(r.number), pickStack, slim, pr =>
          requests.button(pr)
        ),
      slim: slim !== null,
    })
    for (const line of t.querySelectorAll('[data-legend="vercel"]')) line.toggleAttribute('hidden', !vercel)
    return t
  }

  const renderLabels = () => fillPicker('labels', labelChoices(rows ?? [], filters.labels), labelQuery)

  /** Draws the page, then tells Expand all which slim rows it can open. */
  const render = () => {
    draw()
    rowView.drawn(
      [...main.querySelectorAll('button[data-arrow]')].map(b => Number(b.getAttribute('data-arrow')))
    )
    requests.drawn()
  }

  const draw = () => {
    const shownFilters = {
      ...filters,
      codeRabbit: codeRabbit ? filters.codeRabbit : null,
      vercel: vercel ? filters.vercel : null,
      canvas: canvas ? filters.canvas : null,
      bases: activeBases(filters.bases, branches),
      stack: activeStack(filters.stack, stackNames(rows ?? [])),
    }
    builder.render()
    // With Builder in use, Reset always shows: it goes back to the filter bar at its defaults.
    reset.hidden = !builder.on() && !isFiltered(shownFilters)
    stateFilter.render()
    moreFilters.render(filtersOn(shownFilters, QUEUE_DEFAULTS))
    markChanged(doc, QUEUE_GROUPS, shownFilters, QUEUE_DEFAULTS)
    search.sync()
    baseFilter.render(branches, rows ?? [])
    stackFilter.render(rows ?? [])
    get('clear-sort').hidden = filters.sort.length === 0
    columns.render()
    authors.render()
    presets.render()
    renderLabels()
    reviews.render()
    // Each choice counts the PRs in its state.
    integrations.render(
      { codeRabbit, vercel, canvas },
      (section, value) => (rows ?? []).filter(r => hasIntegration(r, section, value)).length
    )
    error.hidden = state.error === null
    error.textContent = state.error === null ? '' : TEXTS.lists.queue.fetchFailed(state.error)

    renderPriority()
    if (rows === null) return
    // Drafts wait for nobody yet, so the nav counts the rest.
    showNavCounts(doc, { queue: rows.filter(r => !r.isDraft).length })
    // Open and Draft count what the other filters keep, so each says what picking it would show.
    const all = rows
    /** The rows every filter keeps, the state as `f` has it; with Builder on, its blocks. */
    const unsearched = (/** @type {typeof filters} */ f) => {
      const stack = activeStack(f.stack, stackNames(all))
      // A stack picked shows whole, drafts too, whatever the State filter keeps for the rest.
      const each = stack === '' ? f : { ...f, state: ALL_STATES }
      return filterStack(
        builder.keep(all) ??
          filterBases(filterQueue(all, each, codeRabbit, vercel, canvas), f.bases, branches),
        stack,
        r => r.stack
      )
    }
    // The search narrows whatever the filters keep.
    const query = search.query()
    /** @type {Map<number, string[]>} */
    const foundBy = new Map()
    /** @param {readonly QueueRow[]} list */
    const searched = list =>
      search.active()
        ? list.filter(r => {
            const match = searchMatch(searchable(r), query, jiraOn)
            if (match !== null && match.keys.length > 0) foundBy.set(r.number, match.keys)
            return match !== null
          })
        : list
    const kept = (/** @type {typeof filters} */ f) => searched(unsearched(f))
    const counts = countPulls(kept({ ...filters, state: ALL_STATES }))
    for (const [name, value] of Object.entries(counts)) {
      const span = main.querySelector(`[data-count="${name}"]`)
      if (span !== null) span.textContent = String(value)
    }
    renderNotified()
    const shown = kept(filters)
    matching = shown
    search.showCount(`${shown.length} of ${plural(unsearched(filters).length, 'PR')}`)
    // Down to one stack, by the Stack filter or the builder, its PRs go in its order, 1/5 to 5/5,
    // whatever the sort, and stay whole in one table though most of them are on other branches.
    const stack = shownStack(shown, r => r.stack, picksStack(filters, stackNames(rows)))
    const whole = stack !== null
    nameStackHeading(doc, {
      heading: get('queue-main-heading'),
      words: 'Waiting for review',
      stack,
      showAll: get('queue-show-all'),
      // Show all PRs clears the Stack filter, so it shows only while that filter picks the stack.
      builder: activeStack(filters.stack, stackNames(rows)) === '',
    })
    const { onMain, stacked: onOther } = whole
      ? { onMain: byStackPosition(shown, r => r.stack), stacked: [] }
      : splitByBase(shown, branches)
    const groups = whole
      ? [{ name: null, tone: '', rows: onMain }]
      : groupBySection(onMain, sections).map(g => ({
          name: g.section.name,
          tone: sectionTone(g.index, sections.length, g.section.color),
          rows: g.items,
        }))
    const grid = tableOf(groups, 'Pull requests waiting for review', undefined, { sorted: !whole })
    table.replaceChildren(grid)
    headHeight(grid.querySelector('thead'))
    stackedTable.replaceChildren(
      tableOf([{ name: null, tone: '', rows: onOther }], 'Stacked pull requests waiting for review')
    )
    table.hidden = onMain.length === 0
    get('queue-main-count').textContent = String(onMain.length)
    stacked.hidden = onOther.length === 0
    get('queue-stacked-count').textContent = String(onOther.length)
    for (const where of [table, stackedTable]) {
      markMatches(where, searchTerms(query))
      addKeyChips(where, foundBy)
    }
    empty.hidden = onMain.length > 0
    if (shown.length === 0 && search.active() && rows.length > 0) {
      searchEmpty(empty, {
        query: search.text(),
        hidden: searched(rows).length,
        clear: search.clear,
        reset: () => reset.click(),
      })
    } else if (shown.length === 0) {
      showEmpty(
        empty,
        rows.length === 0 && state.fetchedAt === null && state.error === null,
        builder.filtered()
          ? TEXTS.lists.empty.noPrs
          : queueEmptyText(shownFilters, `${repo.owner}/${repo.name}`)
      )
    } else if (onMain.length === 0) {
      showEmpty(empty, false, TEXTS.lists.empty.allStacked)
    }
    showTarget()
  }

  /**
   * Highest priority as the server has it: the prompts, the one in use and count, the last picks,
   * and whether a sync runs now; null until the queue loads.
   * @type {{ prompts: import('./priority.js').NamedPrompt[], active: string, prompt: string,
   *   count: number, syncedAt: string | null, error: string | null,
   *   picks: import('./priority.js').PriorityPick[], syncing: boolean, syncStartedAt?: string | null,
   *   stale: boolean } | null}
   */
  let priority = null
  /** Stops the counter of how long the running sync has taken; null while none runs. */
  let stopCounter = /** @type {(() => void) | null} */ (null)
  /** Why the last sync from this page could not start, such as another one running. */
  let priorityFailure = /** @type {string | null} */ (null)

  /** Highest priority: Claude's picks still in the queue, in its order, and what the table says. */
  const renderPriority = () => {
    const syncButton = /** @type {HTMLButtonElement} */ (get('queue-priority-sync'))
    const syncing = priority?.syncing === true
    syncButton.disabled = priority === null || syncing
    syncButton.classList.toggle('syncing', syncing)
    // A pick that went back to draft no longer waits for your review.
    const waiting = (rows ?? []).filter(r => !r.isDraft)
    const picked =
      priority === null || rows === null ? [] : pickedRows(priority.picks, waiting, priority.count)
    get('queue-priority-count').textContent = String(picked.length)
    // The prompt in use, cut short with an ellipsis when long: the tooltip names it whole.
    const inUse = priority?.active ?? DEFAULT_PRIORITY_NAME
    get('queue-priority-prompt').textContent = inUse
    get('queue-priority-edit').title = TEXTS.lists.priority.editPrompt(inUse)
    const when = get('queue-priority-when')
    if (syncing && stopCounter === null) {
      // How long Claude has been at it, so a long sync still shows it is going.
      const since = Date.parse(priority?.syncStartedAt ?? new Date().toISOString())
      stopCounter = everySecond(() => {
        when.textContent = TEXTS.lists.priority.runningFor(duration(Date.now() - since))
      })
    } else if (!syncing) {
      stopCounter?.()
      stopCounter = null
      when.textContent =
        priority === null || priority.syncedAt === null
          ? ''
          : TEXTS.lists.priority.pickedAgo(ago(priority.syncedAt, Date.now()))
      when.title = priority === null || priority.syncedAt === null ? '' : fullStamp(priority.syncedAt)
    }
    const failure = priorityFailure ?? priority?.error ?? null
    const failed = get('queue-priority-error')
    failed.hidden = failure === null
    failed.textContent = failure === null ? '' : TEXTS.lists.priority.couldNotPick(failure)
    get('queue-priority-note').textContent =
      priority === null
        ? ''
        : syncing
          ? TEXTS.lists.priority.picking(priority.count)
          : priority.syncedAt === null
            ? TEXTS.lists.priority.pressSync(priority.count)
            : priority.stale
              ? TEXTS.lists.priority.stale
              : picked.length === 0
                ? priority.picks.length === 0
                  ? TEXTS.lists.priority.noneFits
                  : TEXTS.lists.priority.noLongerWait
                : ''
    const pickedTable = get('queue-priority-table')
    pickedTable.hidden = picked.length === 0
    pickedTable.replaceChildren(
      tableOf([{ name: null, tone: '', rows: picked }], 'Highest priority pull requests', () => false, {
        sorted: false,
      })
    )
  }

  get('queue-priority-sync').addEventListener('click', async () => {
    if (priority === null) return
    const before = priority
    priority = { ...before, syncing: true, syncStartedAt: new Date().toISOString() }
    priorityFailure = null
    render()
    try {
      priority = await api('lists-priority/sync', { method: 'POST' })
    } catch (err) {
      priorityFailure = /** @type {Error} */ (err).message
      priority = { ...before, syncing: false }
    }
    render()
  })
  wirePriorityEditor(doc, {
    repo,
    current: () => priority,
    saved: next => {
      priority = next
      render()
    },
  })

  /**
   * "From notifications": the PRs you opened a notification about while on this page, in the
   * queue's sort, whatever the filters hide. It lives in this page only: the link's `#pr-N` leaves the
   * address once read, so a reload or another page starts without it.
   */
  const renderNotified = () => {
    const found = notified.flatMap(n => (rows ?? []).filter(r => r.number === n))
    get('queue-notified').hidden = found.length === 0
    get('queue-notified-count').textContent = String(found.length)
    get('queue-notified-table').replaceChildren(
      tableOf([{ name: null, tone: '', rows: found }], 'Pull requests from notifications', () => true)
    )
  }
  /** @type {number[]} */
  let notified = []
  /** The PR a link asked for (`#pr-123`), shown once the queue has loaded. */
  let target = /** @type {string | null} */ (null)
  /** Takes a `#pr-N` from the address: it joins "From notifications", and leaves the address. */
  const takeHash = () => {
    const view = doc.defaultView
    const asked = /^#pr-(\d+)$/.exec(view?.location.hash ?? '')?.[1] ?? null
    if (asked === null || view === null) return
    target = asked
    notified = [Number(asked), ...notified.filter(n => n !== Number(asked))]
    // A slim row opens to show the PR whole.
    rowView.open(Number(asked))
    // The PR asked for shows, even when From notifications was folded.
    folds.open('notified')
    try {
      view.history.replaceState(view.history.state, '', `${view.location.pathname}${view.location.search}`)
    } catch {
      // The address keeps it; the table still shows.
    }
  }
  takeHash()
  get('queue-notified-hide').addEventListener('click', () => {
    notified = []
    render()
  })
  const showTarget = () => {
    const loading = rows === null || (rows.length === 0 && state.fetchedAt === null && state.error === null)
    if (target === null || loading) return
    const row = doc.getElementById(`pr-${target}`)
    const note = get('queue-target')
    note.hidden = row !== null
    note.textContent = row === null ? TEXTS.lists.queue.noLongerWaits(target) : ''
    if (row !== null) {
      row.scrollIntoView({ block: 'center' })
      row.classList.remove('row-flash')
      // Restarts the highlight when the same row is asked for again.
      void row.offsetWidth
      row.classList.add('row-flash')
      const title = /** @type {HTMLButtonElement | null} */ (row.querySelector('button.pull-title'))
      title?.focus({ preventScroll: true })
    }
    target = null
  }
  doc.defaultView?.addEventListener('hashchange', () => {
    takeHash()
    render()
  })

  const load = async () => {
    try {
      const data = await api('lists/queue')
      rows = data.rows
      state = data.state
      loadedAt = Date.now()
      sections = data.sections
      people = data.people ?? []
      // Both tabs' counts, the other's as last fetched.
      if (data.counts !== undefined) showNavCounts(doc, data.counts)
      search.setJira(jiraOn)
      branches = data.branches ?? DEFAULT_BRANCHES
      priority = data.priority ?? null
      // A list the server is reading again behind its answer loads again once that read is in.
      // So does one with a canvas generation under way, until it ends.
      if (data.state.syncing || data.rows.some(generating))
        doc.defaultView?.setTimeout(() => void load(), SYNCING_RELOAD_MS)
    } catch (err) {
      state = { ...state, error: /** @type {Error} */ (err).message }
    }
    render()
  }

  reset.addEventListener('click', () => {
    // Back to the filter bar at its defaults, Builder off and its blocks gone.
    filters = { ...QUEUE_DEFAULTS, sort: filters.sort, q: filters.q }
    saveFilters(key, filters, QUEUE_DEFAULTS)
    render()
  })
  get('clear-sort').addEventListener('click', () => change({ sort: [] }))
  for (const name of ['labels', 'integrations']) {
    wireFilterPanel(doc, get(`${name}-button`), get(`${name}-panel`))
  }
  get('labels-all').addEventListener('click', () => change({ labels: null }))
  get('labels-none').addEventListener('click', () => change({ labels: [] }))
  const labelSearch = /** @type {HTMLInputElement} */ (get('labels-search'))
  // The search only narrows the label list, once typing pauses.
  labelSearch.addEventListener(
    'input',
    debounce(() => {
      labelQuery = labelSearch.value
      renderLabels()
    }, SEARCH_DEBOUNCE_MS)
  )
  reloadOnChange(doc, main, load)
  render()
  return load()
}
