// @ts-check
// The Your PRs page: the list from the cache, the Open / Draft / Both, Reviews and Reviewers
// filters (saved per repo) or the experimental filter builder's blocks in their place, and a fresh list each time the repo's data changes. Its tables are the
// Review queue's (pr-table.js), whole or slim. Rows are built with DOM calls; PR titles come
// from GitHub and only ever become text.
import { api, projectBase } from './api.js'
import { baseColor, DEFAULT_BRANCHES } from './branches.js'
import { reviewersNode } from './reviewers.js'
import { labelsNode, openRow, prTable, rowSpan, wireRowView } from './pr-table.js'
import { DEFAULT_SECTIONS, groupBySection, sectionTone } from './sections.js'
import {
  el,
  locNode,
  reloadOnChange,
  showEmpty,
  showNavCounts,
  showSync,
  SYNCING_RELOAD_MS,
  scrollWhenWide,
  trackHeadHeight,
  wireFilterPanel,
} from './dom.js'
import { filterKey, isDefault, loadFilters, saveFilters } from './filters.js'
import {
  ALL_STATES,
  branchNames,
  countPulls,
  emptyText,
  filterPulls,
  OPEN_STATES,
  PULLS_ACCEPT,
  PULLS_DEFAULTS,
  pullCompare,
  reviewerCounts,
  reviewLabel,
  splitByBase,
  upgradePulls,
} from './pulls.js'
import { wireAuthorsPicker } from './authors-picker.js'
import { healthNode } from './health.js'
import { hasIntegration, wireIntegrationsFilter } from './integrations.js'
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
import { STATUS_TONE } from './queue.js'
import {
  keyChip,
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
import { sortBy, withoutColumns } from './sorting.js'
import { columnsOn, PULL_COLUMNS, wireColumnsPicker } from './columns.js'
import { wireFolds } from './folds.js'
import { wireReviewsFilter } from './reviews-filter.js'
import { wireSavedFilters } from './saved-filters.js'
import { wireFilterBuilder } from './filter-builder.js'
import { filtersOn, markChanged, PULLS_GROUPS, wireMoreFilters, wireStateFilter } from './filter-bar.js'
import { asOf, readyNode, stateMark } from './ready.js'
import { pullFields, pullsSeed } from './builder-fields.js'
import { TEXTS } from './texts.js'
import { rowSyncButton } from './repo-actions.js'
import { reviewRequests } from './review-requests.js'

/**
 * @param {Document} doc
 * @param {import('./pulls.js').Pull} pull
 * @param {readonly import('./branches.js').MainBranch[]} branches
 * @param {{ stack: { name: string, position: number, total: number } | undefined,
 *   health: import('./health.js').Health | undefined,
 *   statuses: { canvas: keyof typeof STATUS_TONE, codeRabbit: keyof typeof STATUS_TONE } | undefined,
 *   pending: number | undefined, shows: (column: string) => boolean,
 *   pickStack: (stack: string) => void, now: number,
 *   generation: import('./canvas-cell.js').RowGeneration | undefined,
 *   points: import('./canvas-cell.js').OpenPoints | undefined,
 *   reviewers: (pr: number) => HTMLElement,
 *   foundBy: readonly string[], slim: { view: import('./pr-table.js').RowView, span: number } | null }} info
 *   where it sits in its stack; how many pending items it has (none before a sync read it); its
 *   checks and conflicts for Status; its canvas status; and which columns show (see
 *   columns.js); how to keep the list to a stack; the keys alone the search found it by; and
 *   slim, its arrow and the cells its open part spans
 * @returns {HTMLTableRowElement[]} the row, and its open part under it when slim and open
 */
function pullRow(doc, pull, branches, info) {
  const { stack, health, statuses, slim } = info
  const row = /** @type {HTMLTableRowElement} */ (el(doc, 'tr', 'queue-row'))

  const main = el(doc, 'div', 'pull-main')
  // Its state's mark: open, a draft, or in the merge queue; slim, the arrow that opens the rest
  // before it.
  const state = stateMark(doc, pull)
  const text = el(doc, 'div', 'pull-text')
  // The title opens a menu: its canvas, then the forge, each in a new tab.
  const title = titleMenu(doc, pull)
  // GitHub's order: the base it merges into, then the branch it comes from.
  const branchLine = el(doc, 'span', 'small muted pull-branch')
  const pill = el(doc, 'span', `branch-pill pill-${baseColor(pull.baseRefName, branches)}`, pull.baseRefName)
  const arrow = el(doc, 'span', 'branch-arrow', '←')
  arrow.setAttribute('aria-hidden', 'true')
  branchLine.append(
    pill,
    arrow,
    el(doc, 'span', 'visually-hidden', ' from '),
    el(doc, 'span', 'branch-head', pull.headRefName)
  )
  // A stacked PR's place in its stack, which keeps this list to the stack.
  const place = stackPlace(doc, stack, info.pickStack)
  if (place !== null) branchLine.append(place)
  branchLine.append(' · ', locNode(doc, pull.additions ?? 0, pull.deletions ?? 0))
  // The title menu's ways out, as icons after the size.
  branchLine.append(quickLinks(doc, pull))
  const chip = info.foundBy.length > 0 ? keyChip(doc, info.foundBy) : null
  if (slim === null) {
    if (chip !== null) branchLine.append(chip)
    text.append(title, branchLine)
  } else {
    // Slim, the search's key chip stays beside the title.
    const marks = el(doc, 'span', 'slim-marks')
    if (chip !== null) marks.append(chip)
    text.append(title, marks)
    main.append(slim.view.arrow(pull.number))
  }
  main.append(state, text)

  const label = reviewLabel(pull)
  const review = el(doc, 'span', `badge ${label.tone}`, label.text)

  // Its canvas, and generating it while it has none for its head.
  const actions = el(doc, 'td', 'queue-actions')
  const buttons = el(doc, 'div', 'row-actions')
  // Generate, Regenerate or Open, by where its canvas stands.
  buttons.append(
    canvasAction(doc, {
      number: pull.number,
      canvas: statuses?.canvas ?? 'Pending',
      ...(info.generation === undefined ? {} : { generation: info.generation }),
    }),
    info.reviewers(pull.number),
    rowSyncButton(doc, 'pulls', pull.number)
  )
  actions.append(buttons)
  /** A status badge, or an empty cell before a sync read the PR. */
  const status = (/** @type {keyof typeof STATUS_TONE | undefined} */ value) =>
    value === undefined ? el(doc, 'span') : el(doc, 'span', `badge ${STATUS_TONE[value]}`, value)

  // How many pending items it has; none to show before a sync read it.
  const pending = el(doc, 'span', 'pull-pending')
  if (info.pending !== undefined) {
    const count = el(doc, 'span', `badge ${info.pending > 0 ? 'acc' : 'muted'}`, String(info.pending))
    count.title = TEXTS.lists.pulls.pendingItems(info.pending)
    pending.append(count)
  }
  /** @type {Record<(typeof PULL_COLUMNS)[number][0], () => HTMLElement>} */
  const cells = {
    status: () => healthNode(doc, health),
    pending: () => pending,
    points: () => pointsCell(doc, info.points),
    review: () => review,
    reviewed: () => reviewersNode(doc, pull.reviewers),
    ready: () => readyNode(doc, pull, info.now),
    labels: () => labelsNode(doc, pull.labels ?? [], slim !== null),
    canvas: () =>
      canvasCell(doc, {
        number: pull.number,
        isDraft: pull.isDraft,
        canvas: statuses?.canvas ?? 'Pending',
        ...(info.generation === undefined ? {} : { generation: info.generation }),
      }),
    codeRabbit: () => status(statuses?.codeRabbit),
  }
  /** A cell holding one node. @param {Node} node @param {string} [className] */
  const cell = (node, className) => {
    const td = el(doc, 'td', className)
    td.append(node)
    return td
  }
  row.append(cell(main, 'queue-pr'))
  for (const [key] of PULL_COLUMNS) if (info.shows(key)) row.append(cell(cells[key]()))
  row.append(actions)
  if (slim === null || !slim.view.isOpen(pull.number)) return [row]
  // Open: what its line left out, its branches and links.
  const parts = /** @type {Node[]} */ ([branchLine])
  return [row, openRow(doc, slim.span, parts)]
}

/** @param {Document} doc */
export function wirePullsPage(doc) {
  const main = doc.querySelector('main[data-page="pulls"]')
  if (!(main instanceof HTMLElement)) return
  const repo = { owner: main.dataset['owner'] ?? '', name: main.dataset['name'] ?? '' }
  /** Who each PR asks to review it: a popup per row, kept across redraws. */
  const requests = reviewRequests(doc, repo, 'pulls')
  const slug = `${repo.owner}/${repo.name}`
  const key = filterKey(repo, 'pulls')
  let filters = loadFilters(key, PULLS_DEFAULTS, PULLS_ACCEPT, upgradePulls)
  /** @type {import('./pulls.js').Pull[] | null} */
  let pulls = null
  /** @type {{ syncedAt: string | null, error: string | null }} */
  let sync = { syncedAt: null, error: null }
  let syncing = false
  /** When the page last loaded its data: the Ready column's clock while no sync time is known. */
  let loadedAt = Date.now()
  /** @type {readonly import('./branches.js').MainBranch[]} */
  let branches = DEFAULT_BRANCHES
  /** @type {Record<number, { name: string, position: number, total: number, base?: string }>} */
  let stacks = {}
  /** @type {Record<number, import('./health.js').Health>} */
  let health = {}
  // The canvas is this app: its column always shows; CodeRabbit and Vercel are not read here.
  const vercel = false
  const codeRabbit = false
  const canvas = true
  /** @type {Record<number, { canvas: keyof typeof STATUS_TONE, codeRabbit: keyof typeof STATUS_TONE }>} */
  let statuses = {}
  /** Each PR's pending items, by number. */
  /** @type {Record<number, number>} */
  let pending = {}
  /** Each PR's open attention points, for the author and the reviewer, by number; none with no canvas. */
  /** @type {Record<number, import('./canvas-cell.js').OpenPoints>} */
  let points = {}
  /** Each PR's canvas generation from the table, by number: queued, running, or failed. */
  /** @type {Record<number, import('./canvas-cell.js').RowGeneration>} */
  let generations = {}
  /** No Jira cards are read here, so the search reads no keys. */
  const jiraOn = false
  /** The PRs the filters and the search keep now, for Enter in the search box. */
  let matching = /** @type {readonly import('./pulls.js').Pull[]} */ ([])
  /** What the search reads of a PR. @param {import('./pulls.js').Pull} p */
  const searchable = p => ({
    number: p.number,
    title: p.title,
    head: p.headRefName,
    base: p.baseRefName,
    keys: [],
  })
  /** The project's people, whom the pickers offer beside those on the PRs. */
  let people = /** @type {string[]} */ ([])
  /** @type {readonly import('./sections.js').Section[]} */
  let sections = DEFAULT_SECTIONS

  const get = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id))
  const table = get('pull-table')
  // Section rows stick under the column header, as far down as it is tall.
  const headHeight = trackHeadHeight(table)
  scrollWhenWide(main.querySelectorAll('.queue-table'))
  const empty = get('pulls-empty')
  const stackedSection = get('stacked-section')
  const stackedTable = get('stacked-body')
  const stackedCount = get('stacked-count')
  const reset = get('reset-filters')
  const stateFilter = wireStateFilter(doc, {
    picked: () => filters.state,
    pick: state => {
      filters = { ...filters, state }
      saveFilters(key, filters, PULLS_DEFAULTS)
      render()
    },
    needs: () => filters.needsUpdate,
    setNeeds: on => {
      filters = { ...filters, needsUpdate: on }
      saveFilters(key, filters, PULLS_DEFAULTS)
      render()
    },
  })
  const moreFilters = wireMoreFilters(doc, 'pulls')

  const setSort = (/** @type {string[]} */ sort) => {
    filters = { ...filters, sort }
    saveFilters(key, filters, PULLS_DEFAULTS)
    render()
  }

  /**
   * A table of PRs: the header with its sort buttons, then the PRs, in their sections when named.
   * @param {readonly import('./pr-table.js').RowGroup<import('./pulls.js').Pull>[]} groups
   * @param {string} label
   * @param {(p: import('./pulls.js').Pull) => Parameters<typeof pullRow>[3]} info
   */
  const tableOf = (groups, label, info) => {
    const shown = PULL_COLUMNS.filter(([column]) => columns.shows(column))
    const t = prTable(doc, {
      label,
      columns: shown,
      // Status says what its icons are, and Reviewed by its marks, behind a "?" each.
      help: { status: 'status-help', pending: 'pending-help', reviewed: 'reviewed-by-help' },
      sort: { sort: filters.sort, onSort: setSort, sortable: () => true },
      groups,
      folds,
      rows: p => pullRow(doc, p, branches, info(p)),
      slim: rowView.slim(),
    })
    for (const line of t.querySelectorAll('[data-legend="vercel"]')) line.toggleAttribute('hidden', !vercel)
    return t
  }

  /** Draws the page, then tells Expand all which slim rows it can open. */
  const render = () => {
    draw()
    rowView.drawn(
      [...main.querySelectorAll('button[data-arrow]')].map(b => Number(b.getAttribute('data-arrow')))
    )
    requests.drawn()
  }

  const draw = () => {
    reviews.render()
    const on = { codeRabbit, vercel, canvas }
    main.classList.toggle('no-coderabbit', !codeRabbit)
    main.classList.toggle('no-canvas', !canvas)
    columns.render()
    // Each choice counts the PRs in its state.
    integrations.render(
      on,
      (section, value) =>
        (pulls ?? []).filter(p =>
          hasIntegration({ health: health[p.number] ?? null, ...statuses[p.number] }, section, value)
        ).length
    )
    reviewersPicker.render()
    presets.render()
    const placed = (pulls ?? []).map(p => ({ baseRefName: p.baseRefName, stack: stacks[p.number] }))
    baseFilter.render(branches, placed)
    stackFilter.render(placed)
    // Reset clears the filters; Clear sort, the sort. A base the repo no longer has filters nothing.
    builder.render()
    const shownFilters = {
      ...filters,
      bases: activeBases(filters.bases, branches),
      stack: activeStack(filters.stack, stackNames(placed)),
    }
    // With Builder in use, Reset always shows: it goes back to the filter bar at its defaults.
    reset.hidden =
      !builder.on() &&
      isDefault(
        {
          ...shownFilters,
          sort: [],
          builder: false,
          where: '',
          // The search box has its own ×; Reset leaves it.
          q: '',
        },
        PULLS_DEFAULTS
      )
    stateFilter.render()
    moreFilters.render(filtersOn(shownFilters, PULLS_DEFAULTS))
    markChanged(doc, PULLS_GROUPS, shownFilters, PULLS_DEFAULTS)
    search.sync()
    get('clear-sort').hidden = filters.sort.length === 0
    showSync(doc, sync)

    if (pulls === null) return
    const all = pulls
    /** The PRs every filter but the state keeps, or with `state`, every filter, before the search. */
    const unsearched = (/** @type {typeof filters} */ f) => {
      const stack = activeStack(f.stack, stackNames(placed))
      // A stack picked shows whole, drafts too, whatever the State filter keeps for the rest.
      const each = stack === '' ? f : { ...f, state: ALL_STATES }
      return filterStack(
        builder.keep(all) ??
          filterBases(
            filterPulls(all, each, health, statuses, on, points, pending),
            f.bases,
            branches,
            p => stacks[p.number]
          ),
        stack,
        p => stacks[p.number]
      )
    }
    // The search narrows whatever the filters keep.
    const query = search.query()
    /** @type {Map<number, string[]>} */
    const foundBy = new Map()
    /** @param {readonly import('./pulls.js').Pull[]} list */
    const searched = list =>
      search.active()
        ? list.filter(p => {
            const match = searchMatch(searchable(p), query, jiraOn)
            if (match !== null && match.keys.length > 0) foundBy.set(p.number, match.keys)
            return match !== null
          })
        : list
    const kept = (/** @type {typeof filters} */ f) => searched(unsearched(f))
    // Open and Draft count what the other filters keep, so each says what picking it would show.
    const counts = countPulls(kept({ ...filters, state: ALL_STATES }))
    for (const [name, value] of Object.entries(counts)) {
      const span = main.querySelector(`[data-count="${name}"]`)
      if (span !== null) span.textContent = String(value)
    }
    showNavCounts(doc, { pulls: pulls.length })

    const filtered = kept(filters)
    matching = filtered
    search.showCount(`${filtered.length} of ${plural(unsearched(filters).length, 'PR')}`)
    // Down to one stack, by the Stack filter or the builder, its PRs go in its order, 1/5 to 5/5,
    // whatever the sort, and stay whole in one list though most of them are on other branches.
    const stack = shownStack(filtered, p => stacks[p.number], picksStack(filters, stackNames(placed)))
    const whole = stack !== null
    nameStackHeading(doc, {
      heading: get('pulls-main-heading'),
      words: 'On base branches',
      stack,
      showAll: get('pulls-show-all'),
      // Show all PRs clears the Stack filter, so it shows only while that filter picks the stack.
      builder: activeStack(filters.stack, stackNames(placed)) === '',
    })
    const shown = whole
      ? byStackPosition(filtered, p => stacks[p.number])
      : sortBy(filtered, filters.sort, pullCompare(health, statuses, pending, points))
    /** @param {import('./pulls.js').Pull} p */
    const info = p => ({
      reviewers: (/** @type {number} */ pr) => requests.button(pr),
      stack: stacks[p.number],
      health: health[p.number],
      statuses: statuses[p.number],
      shows: columns.shows,
      pickStack,
      generation: generations[p.number],
      pending: pending[p.number],
      points: points[p.number],
      now: asOf(sync.syncedAt, loadedAt),
      foundBy: foundBy.get(p.number) ?? [],
      slim: rowView.slim()
        ? { view: rowView, span: rowSpan(PULL_COLUMNS.filter(([c]) => columns.shows(c)).length) }
        : null,
    })
    const { onMain, stacked } = whole ? { onMain: shown, stacked: [] } : splitByBase(shown, branches)
    // Your PRs sit in the repo's review queue sections, each under its colored row; empty ones
    // hide, and a folded one keeps only its row. A whole stack keeps its order instead.
    const mainTable = tableOf(
      whole
        ? [{ name: null, tone: '', rows: onMain }]
        : groupBySection(onMain, sections).map(g => ({
            name: g.section.name,
            tone: sectionTone(g.index, sections.length, g.section.color),
            rows: g.items,
          })),
      'Your PRs',
      info
    )
    table.replaceChildren(mainTable)
    headHeight(mainTable.querySelector('thead'))
    get('pulls-main-count').textContent = String(onMain.length)
    stackedTable.replaceChildren(
      tableOf([{ name: null, tone: '', rows: stacked }], 'Stacked pull requests', info)
    )
    markMatches(table, searchTerms(query))
    markMatches(stackedTable, searchTerms(query))
    table.hidden = onMain.length === 0
    stackedSection.hidden = stacked.length === 0
    stackedCount.textContent = String(stacked.length)
    empty.hidden = onMain.length > 0
    if (shown.length === 0 && search.active() && pulls.length > 0) {
      searchEmpty(empty, {
        query: search.text(),
        hidden: searched(pulls).length,
        clear: search.clear,
        reset: () => reset.click(),
      })
    } else if (shown.length === 0) {
      showEmpty(
        empty,
        pulls.length === 0 && (syncing || (sync.syncedAt === null && sync.error === null)),
        // With no PRs at all, the state filter is not what hides them.
        emptyText(
          pulls.length === 0 ? ALL_STATES : filters.state,
          slug,
          builder.on()
            ? builder.filtered()
            : !isDefault(
                {
                  ...filters,
                  state: OPEN_STATES,
                  sort: [],
                  bases: activeBases(filters.bases, branches),
                  builder: false,
                  where: '',
                },
                PULLS_DEFAULTS
              )
        )
      )
    } else if (onMain.length === 0) {
      showEmpty(empty, false, TEXTS.lists.empty.noneTarget(branchNames(branches)))
    }
  }

  const load = async () => {
    try {
      const data = await api('lists/pulls')
      loadedAt = Date.now()
      /** @type {(import('./pulls.js').Pull & { health: import('./health.js').Health,
       *   canvas: keyof typeof STATUS_TONE, pending: number,
       *   stack?: { name: string, position: number, total: number, base?: string },
       *   points?: import('./canvas-cell.js').OpenPoints, generation?: import('./canvas-cell.js').RowGeneration })[]} */
      const rows = data.rows
      // Each row carries what its cells show; the table keeps them by number, as it reads them.
      pulls = rows
      health = Object.fromEntries(rows.map(r => [r.number, r.health]))
      statuses = Object.fromEntries(
        rows.map(r => [r.number, { canvas: r.canvas, codeRabbit: /** @type {const} */ ('Pending') }])
      )
      pending = Object.fromEntries(rows.map(r => [r.number, r.pending]))
      points = Object.fromEntries(rows.flatMap(r => (r.points === undefined ? [] : [[r.number, r.points]])))
      generations = Object.fromEntries(
        rows.flatMap(r => (r.generation === undefined ? [] : [[r.number, r.generation]]))
      )
      stacks = Object.fromEntries(rows.flatMap(r => (r.stack === undefined ? [] : [[r.number, r.stack]])))
      sync = { syncedAt: data.state.fetchedAt, error: data.state.error }
      syncing = data.state.syncing === true
      branches = data.branches ?? DEFAULT_BRANCHES
      search.setJira(jiraOn)
      sections = data.sections ?? DEFAULT_SECTIONS
      people = data.people ?? []
      // Both tabs' counts, the other's as last fetched.
      if (data.counts !== undefined) showNavCounts(doc, data.counts)
      // A list the server is reading again behind its answer loads again once that read is in.
      // So does one with a canvas generation under way, until it ends.
      if (syncing || rows.some(generating)) doc.defaultView?.setTimeout(() => void load(), SYNCING_RELOAD_MS)
    } catch (err) {
      sync = { ...sync, error: err instanceof Error ? err.message : String(err) }
    }
    render()
  }

  /** @param {Partial<typeof PULLS_DEFAULTS>} next */
  const change = next => {
    filters = { ...filters, ...next }
    saveFilters(key, filters, PULLS_DEFAULTS)
    render()
  }
  const reviews = wireReviewsFilter(doc, { picked: () => filters, pick: change })
  const integrations = wireIntegrationsFilter(doc, { picked: () => filters, pick: change })
  wireFilterPanel(doc, get('integrations-button'), get('integrations-panel'))
  const baseFilter = wireBaseFilter(doc, { picked: () => filters.bases, pick: bases => change({ bases }) })
  const stackFilter = wireStackFilter(doc, { picked: () => filters.stack, pick: stack => change({ stack }) })
  get('pulls-show-all').addEventListener('click', () => change({ stack: '' }))
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
  /** Keeps the list to `stack`, from its place on a row: the filter bar's Stack, every state. */
  // Only the open page keeps it (filters.js, `PAGE_ONLY`): a reload shows every PR again.
  const pickStack = (/** @type {string} */ stack) => change({ stack })
  wireTitleMenus(doc)
  const columns = wireColumnsPicker(doc, {
    repo,
    page: 'pulls',
    columns: PULL_COLUMNS,
    available: () => columnsOn(PULL_COLUMNS, { canvas, codeRabbit }),
    // A hidden column leaves the sort too.
    onChange: hidden => setSort(withoutColumns(filters.sort, hidden)),
  })
  const reviewersPicker = wireAuthorsPicker(doc, {
    repo,
    prefix: 'reviewers-',
    picked: () => filters.reviewers,
    pick: reviewers => change({ reviewers }),
    people: () => reviewerCounts(pulls ?? [], people),
  })
  const presets = wireSavedFilters(doc, {
    repo,
    page: 'pulls',
    defaults: PULLS_DEFAULTS,
    accept: PULLS_ACCEPT,
    current: () => filters,
    apply: picked => change({ ...picked, sort: filters.sort }),
    upgrade: upgradePulls,
  })
  const builder = wireFilterBuilder(doc, {
    fields: () =>
      pullFields({
        on: { codeRabbit, vercel, canvas },
        branches,
        stacks,
        health,
        statuses,
        pending,
        points,
        people,
        search: (p, words) => searchMatch(searchable(p), parseSearch(words), jiraOn) !== null,
      }),
    rows: () => pulls ?? [],
    filters: () => filters,
    change,
    seed: f =>
      pullsSeed(f, {
        on: { codeRabbit, vercel, canvas },
        bases: activeBases(f.bases, branches),
        stack: activeStack(f.stack, stackNames((pulls ?? []).map(p => ({ stack: stacks[p.number] })))),
      }),
    page: 'pulls',
    saved: presets.saved,
    groups: reviewersPicker.searches,
    ask: body =>
      api('lists-builder/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  })
  reset.addEventListener('click', () => {
    // Back to the filter bar at its defaults, Builder off and its blocks gone.
    filters = { ...PULLS_DEFAULTS, sort: filters.sort, q: filters.q }
    saveFilters(key, filters, PULLS_DEFAULTS)
    render()
  })
  get('clear-sort').addEventListener('click', () => setSort([]))

  const folds = wireFolds(doc, { repo, page: 'pulls', onChange: () => render() })
  // The rows whole or slim, from the toolbar, and which slim ones are open.
  const rowView = wireRowView(doc, { folds, render: () => render() })

  reloadOnChange(doc, main, load)

  render()
  return load()
}
