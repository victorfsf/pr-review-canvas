// The project home page's two tabs, Your PRs and the Review queue: their filter bars, tables,
// dialogs and legends, which the page scripts (static/js/lists/) fill. Each tab is its own page, so
// the two never share an id.
import { html, raw } from 'hono/html'
import type { HtmlEscapedString } from 'hono/utils/html'
import { MAX_SEARCH } from '../../static/js/lists/filters.js'
import { STATUS_LEGEND } from '../../static/js/lists/health.js'
import { iconSvg } from '../../static/js/lists/icons.js'
import { INTEGRATION_SECTIONS } from '../../static/js/lists/integrations.js'
import { MAX_PRIORITY_COUNT, MAX_PRIORITY_NAME, MAX_PRIORITY_PROMPT } from '../../static/js/lists/priority.js'
import { reviewChoices, reviewFlags } from '../../static/js/lists/pulls.js'
import { KINDS } from '../../static/js/lists/reviewers.js'
import { OPEN_STATES, STATE_WORDS, STATES, stateLabel } from '../../static/js/lists/states.js'
import { TEXTS } from '../../static/js/lists/texts.js'

type Html = HtmlEscapedString | Promise<HtmlEscapedString>

const T = TEXTS.server
const icon = (name: string, size?: number) => raw(iconSvg(name, size))

/** Which tab a home page shows. */
export type ListTab = 'pulls' | 'queue'

/** What the tables' markup needs to know of the project. */
export interface ListsPageData {
  tab: ListTab
  owner: string
  repo: string
  /** The project's base path on the server, with a trailing slash. */
  base: string
  /** `GitHub` or `GitLab`, for the links out. */
  forge: string
  /** `PR` or `MR`. */
  nounShort: string
  /** An agent can run here: rows offer to generate a canvas, and the AI features show. */
  canGenerate: boolean
  /** The filters the pages saved, which they arrive with. */
  savedFilters: Record<string, unknown>
}

/** Which tab of the project a page is: its home, or one of the two tables. */
export type ProjectTab = 'home' | ListTab

/**
 * The project's tabs, under the header on its home page and both tables: Home, Your PRs and the
 * Review queue. The tables' scripts fill their counts.
 */
export function projectTabs(opts: { base: string; nounShort: string; tab: ProjectTab }): Html {
  const tab = (key: ProjectTab, href: string, label: string, count?: string) =>
    html`<a class="project-tab${opts.tab === key ? ' on' : ''}" href="${href}"${opts.tab === key ? raw(' aria-current="page"') : ''}>${label}${count === undefined ? '' : html` <span class="count-badge" id="${count}"></span>`}</a>`
  return html`<nav class="project-tabs" aria-label="Project pages">
${tab('home', opts.base, 'Home')}
${tab('pulls', `${opts.base}pulls`, `Your ${opts.nounShort}s`, 'nav-pull-count')}
${tab('queue', `${opts.base}queue`, 'Review queue', 'nav-queue-count')}
</nav>`
}

/**
 * The tables' own commands, at the right of the search line, in groups split by a rule: how the
 * tables show (Columns, slim rows), the project's setup (base branches, sections), and Sync.
 */
const tableTools = (): Html => html`<div class="table-tools">
<div class="tool-group" role="group" aria-labelledby="tools-view"><span class="tool-label" id="tools-view">View</span>${COLUMNS_PICKER}</div>
<span class="tool-rule" aria-hidden="true"></span>
<div class="tool-group" role="group" aria-labelledby="tools-setup"><span class="tool-label" id="tools-setup">Setup</span>
<button type="button" class="button small-button" id="branches-open" aria-haspopup="dialog" title="${T.settings.branchesNote}">${icon('gitMerge', 14)} Base branches</button>
<button type="button" class="button small-button" id="sections-open" data-open-sections aria-haspopup="dialog" title="${T.sections.note}">${icon('listDetails', 14)} Sections</button>
</div>
<span class="tool-rule" aria-hidden="true"></span>
<button type="button" class="button small-button row-sync" id="sync-now" aria-label="Sync now" title="Read the list from the forge again">${icon('refresh', 14)} Sync</button>
</div>`

function stateFilter(start: readonly string[]): Html {
  const option = (state: string) =>
    html`<label class="check-row"><input type="checkbox" data-state="${state}"${start.includes(state) ? raw(' checked') : ''}> ${STATE_WORDS[state] ?? state}<span class="muted small people-count" data-count="${state}"></span></label>`
  return html`<div class="menu-anchor" id="state-filter">
<button type="button" class="button" id="state-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="state-panel"><span class="muted">State:</span> <span id="state-label">${stateLabel(start)}</span></button>
<section class="popover filter-popover" id="state-panel" role="dialog" aria-label="Filter by state" hidden>
<fieldset class="filter-group"><legend class="visually-hidden">Show PRs that are</legend>
<div class="filter-head"><span class="filter-title" aria-hidden="true">Show PRs that are</span><span class="filter-bulk"><button type="button" class="link-button" id="state-all" aria-label="Select every state">All</button></span></div>
${STATES.map(option)}
</fieldset>
</section>
</div>`
}

/** Filters: the button that shows the row of filters under the search, with how many are on. */
const FILTERS_TOGGLE = html`<button type="button" class="button" id="filters-toggle" aria-expanded="false" aria-controls="more-filters">${icon('filter', 14)} Filters <span class="count-badge" id="filters-count" hidden></span></button>`

const SYNC_NOTICES = html`<p class="notice bad" id="sync-error" role="status" hidden></p>
<p class="notice muted" id="sync-stale" hidden></p>`

/** Text with `**bold**` as markup, split into small paragraphs at its blank lines. */
function prose(text: string): Html {
  return html`${text
    .split('\n\n')
    .map(
      p =>
        html`<p class="small">${p
          .split(/\*\*(.+?)\*\*/)
          .map((part, i) => (i % 2 === 1 ? html`<strong>${part}</strong>` : part))}</p>`
    )}`
}

function helpTip(id: string, label: string, text: string): Html {
  return html`<span class="help-anchor">
<button type="button" class="help-button" aria-describedby="${id}" aria-label="${label}">${icon('help', 14)}</button>
<div class="popover help-popover" id="${id}" role="tooltip">${prose(text)}</div>
</span>`
}

/** The "Reviewed by" header's legend: what each icon means, who the first pill shows, and "+N". */
function reviewedByHelp(id: string): Html {
  const legend = `reviewed-by-help-${id}`
  return html`<span class="help-anchor">
<button type="button" class="help-button" aria-describedby="${legend}" aria-label="What the Reviewed by icons mean">${icon('help', 14)}</button>
<div class="popover help-popover" id="${legend}" role="tooltip">
<ul class="legend">
${KINDS.map(k => html`<li><span class="reviewer-count ${k.tone}">${icon(k.icon, 14)}</span><span>${k.legend}</span></li>`)}
</ul>
${prose(T.legends.reviewedBy)}
</div>
</span>`
}

/** The Status header's "?": what each icon means; the Review queue's adds "Awaiting your review". */
function statusHelp(tab: ListTab): Html {
  const legend = `status-help-${tab}`
  return html`<span class="help-anchor">
<button type="button" class="help-button" aria-describedby="${legend}" aria-label="What the Status icons mean">${icon('help', 14)}</button>
<div class="popover help-popover" id="${legend}" role="tooltip">
<ul class="legend">
${STATUS_LEGEND.filter(l => l.vercel !== true && (tab === 'queue' || l.queue !== true)).map(l => html`<li><span class="health">${l.tones.map(tone => html`<span class="health-mark ${tone}">${icon(l.icon, 14)}</span>`)}</span><span>${l.text}</span></li>`)}
</ul>
${prose(T.legends.status)}
</div>
</span>`
}

/**
 * A table's heading, which folds the table like an accordion's: its button names the table and its
 * count and opens or closes `body`; `after` sits beside it, outside the button.
 */
function foldHeading(opts: {
  id: string
  fold: string
  title: string
  body: string
  count: string
  after?: Html
}): Html {
  return html`<h2 class="section-heading fold-heading" id="${opts.id}"><button type="button" class="fold-button" aria-expanded="true" aria-controls="${opts.body}" data-fold="${opts.fold}">${icon('chevronRight', 14)}<span class="fold-title">${opts.title}</span> <span class="count-badge" id="${opts.count}"></span></button>${opts.after ?? ''}</h2>`
}

/** Beside a main table named after one stack: clears the Stack filter (stack-pick.js). */
const showAll = (tab: ListTab): Html =>
  html`<button type="button" class="link-button small show-all-prs" id="${tab}-show-all" hidden>Show all PRs</button>`

/** The Columns button and its popover, then the slim and Expand all toggles. */
const COLUMNS_PICKER = html`<div class="menu-anchor">
<button type="button" class="button" id="columns-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="columns-panel"><span class="muted">Columns:</span> <span id="columns-label">All</span></button>
<section class="popover filter-popover columns-panel" id="columns-panel" role="dialog" aria-label="Show columns" hidden>
<fieldset class="filter-group"><legend class="visually-hidden">Columns</legend>
<div class="filter-head"><span class="filter-title" aria-hidden="true">Show columns</span><span class="filter-bulk"><button type="button" class="link-button" id="columns-all" aria-label="Show every column">All</button><button type="button" class="link-button" id="columns-none" aria-label="Hide every column that can hide">None</button></span></div>
<div class="filter-options" id="columns-options"></div>
</fieldset>
<p class="small muted">${T.filters.columnsNote}</p>
</section>
</div>
<button type="button" class="icon-button small-icon-button" id="fold-rows" data-icon="chevronsDown" title="${TEXTS.lists.rows.expandAll}" aria-label="${TEXTS.lists.rows.expandAll}" hidden>${icon('chevronsDown', 16)}</button>
<button type="button" class="icon-button small-icon-button" id="slim-rows" data-icon="list" title="${TEXTS.lists.rows.slim}" aria-label="${TEXTS.lists.rows.slim}" aria-pressed="false">${icon('list', 16)}</button>`

const SEARCH_BOX = html`<div class="search-box" role="search">
<label class="visually-hidden" for="pr-search">Search pull requests</label>
${icon('search', 14)}
<input type="search" class="text-input search-input" id="pr-search" placeholder="${T.filters.searchPlaceholder}" autocomplete="off" spellcheck="false" maxlength="${MAX_SEARCH}" title="${T.filters.searchTip}">
<kbd class="search-key" aria-hidden="true">/</kbd>
<button type="button" class="icon-button small-icon-button search-clear" id="pr-search-clear" aria-label="Clear search" title="Clear search" hidden>${icon('x', 14)}</button>
</div>`

const SAVED_FILTERS = html`<div class="menu-anchor">
<button type="button" class="button" id="presets-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="presets-panel"><span class="muted">Saved:</span> <span id="presets-label">None</span></button>
<section class="popover authors-panel" id="presets-panel" role="dialog" aria-labelledby="presets-title" hidden>
<h2 id="presets-title" class="panel-title">Saved filters</h2>
<input type="search" class="text-input" id="presets-search" aria-label="Search saved filters" placeholder="${T.filters.savedSearchPlaceholder}">
<ul class="people-list preset-list" id="presets-list" aria-label="Saved filters"></ul>
<div class="save-as"><label class="small" for="presets-name">Save current as</label><input type="text" class="text-input" id="presets-name" maxlength="40"><button type="button" class="button small-button" id="presets-save">Save</button></div>
</section>
</div>`

/** The Authors button and its picker; `people` names the list for screen readers. */
function authorsPicker(slug: string, people: string, prefix = '', title = 'Authors'): Html {
  const id = (name: string) => `${prefix}${name}`
  return html`<div class="menu-anchor">
<button type="button" class="button" id="${id('authors-button')}" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id('authors-panel')}"><span class="muted">${title}:</span> <span id="${id('authors-label')}">Everyone</span></button>
<section class="popover authors-panel" id="${id('authors-panel')}" role="dialog" aria-labelledby="${id('authors-title')}" hidden>
<h2 id="${id('authors-title')}" class="panel-title">${title}</h2>
<fieldset class="filter-group"><legend class="filter-title">Saved searches</legend><div id="${id('saved-options')}"></div></fieldset>
<div class="filter-head"><label class="filter-title" for="${id('people-search')}">Pick people</label><span class="filter-bulk"><button type="button" class="link-button" id="${id('people-all')}" aria-label="Select everyone">All</button><button type="button" class="link-button" id="${id('people-none')}" aria-label="Deselect everyone">None</button></span></div>
<input type="search" class="text-input" id="${id('people-search')}" placeholder="${T.filters.searchIn(title.toLowerCase(), slug)}">
<ul class="people-list" id="${id('people-list')}" aria-label="${people}"></ul>
<span class="small muted" id="${id('people-count')}"></span>
<div class="save-as"><label class="small" for="${id('save-as')}">Save as</label><input type="text" class="text-input" id="${id('save-as')}" maxlength="40"><button type="button" class="button small-button" id="${id('save-search')}">Save</button></div>
</section>
</div>`
}

/** The Builder button: it opens the builder, and pressed, its blocks filter the page in place of the bar. */
const BUILDER_BUTTON = html`<button type="button" class="button toggle-button" id="builder-toggle" aria-pressed="false" aria-haspopup="dialog" aria-controls="filter-builder" title="${T.builder.buttonTip}">${icon('filter', 14)}<span id="builder-label">Builder</span></button>`

/** The filter builder, a modal dialog the page script fills; Ask AI shows where an agent can run. */
function builderPanel(canAsk: boolean): Html {
  return html`<dialog class="sections-dialog filter-builder" id="filter-builder" aria-labelledby="filter-builder-title">
<div class="dialog-head"><h2 id="filter-builder-title">Filter builder</h2><span class="spacer"></span>${
    canAsk
      ? html`<button type="button" class="button small-button toggle-button" id="builder-chat-toggle" aria-pressed="false" aria-controls="builder-chat">${icon('messageChatbot', 14)}<span>Ask AI</span></button>`
      : ''
  }<button type="button" class="icon-button small-icon-button" id="builder-close" aria-label="Close" title="Close">${icon('x', 14)}</button></div>
<p class="small muted">${T.builder.notePrs}</p>
<section class="builder-chat" id="builder-chat" aria-label="Ask AI to fill the builder" hidden>
<ol class="builder-talk" id="builder-talk" aria-live="polite" hidden></ol>
<div class="builder-ask">
<textarea class="text-input" id="builder-ask-input" rows="3" maxlength="2000" aria-label="What to show" placeholder="${T.builder.askPlaceholder}"></textarea>
<button type="button" class="button primary-button" id="builder-ask" aria-label="Send" title="Send">${icon('send')}</button>
</div>
<p class="small muted">${T.builder.askNote}</p>
<p class="notice bad small" id="builder-ask-error" role="status" hidden></p>
</section>
<div class="builder-root" id="filter-builder-root"></div>
<div class="dialog-foot">
<button type="button" class="link-button small" id="builder-off">Use the filter bar instead</button>
<span class="spacer"></span>
<span class="small muted" id="builder-shown" role="status"></span>
<button type="button" class="button primary-button" id="builder-done">Done</button>
</div>
</dialog>`
}

/** A filter group's heading line: its title, then All and None, with ids `<id>-all` and `<id>-none`. */
function bulkHead(title: string, id: string, what: string): Html {
  return html`<div class="filter-head"><span class="filter-title" aria-hidden="true">${title}</span><span class="filter-bulk"><button type="button" class="link-button" id="${id}-all" aria-label="Select every ${what}">All</button><button type="button" class="link-button" id="${id}-none" aria-label="Deselect every ${what}">None</button></span></div>`
}

/** The Reviews filter: the review states, on the queue whether a PR awaits your review, then the flags. */
function reviewsFilter(tab: ListTab): Html {
  return html`<div class="menu-anchor">
<button type="button" class="button" id="review-filter-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="review-filter"><span class="muted">Reviews:</span> <span id="review-filter-label">All</span></button>
<section class="popover filter-popover" id="review-filter" role="dialog" aria-label="Filter by reviews" hidden>
<fieldset class="filter-group"><legend class="visually-hidden">Show PRs whose review is</legend>
${bulkHead('Show PRs whose review is', 'reviews', 'review state')}
${reviewChoices(tab === 'queue').map(([key, label]) => html`<label class="check-row"><input type="checkbox" data-review="${key}"> ${label}</label>`)}
</fieldset>
<fieldset class="filter-group"><legend class="filter-title">Only PRs with</legend>
${reviewFlags(tab === 'queue').map(([key, label]) => html`<label class="check-row"><input type="checkbox" data-filter="${key}"> ${label}</label>`)}
</fieldset>
</section>
</div>`
}

/** The Status filter: the checks and merge state, and the canvas status, each with its counts. */
function integrationsFilter(): Html {
  return html`<div class="menu-anchor">
<button type="button" class="button" id="integrations-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="integrations-panel"><span class="muted">Status:</span> <span id="integrations-label">All</span></button>
<section class="popover filter-popover integrations-filter" id="integrations-panel" role="dialog" aria-label="Filter by status" hidden>
${bulkHead('Show PRs with', 'integrations', 'status')}
<div class="integration-groups">
${INTEGRATION_SECTIONS.filter(s => s.key === 'github' || s.key === 'canvas').map(
  section => html`<fieldset class="filter-group" data-integration="${section.key}"><legend class="filter-title">${section.title}</legend>
${section.choices.map(
  ([value, words]) =>
    html`<label class="check-row"><input type="checkbox" data-section="${section.key}" value="${value}"> ${words}<span class="muted small people-count"></span></label>`
)}
</fieldset>`
)}
</div>
</section>
</div>`
}

/** The Stack filter: hidden until the page script finds a PR in a stack. */
const STACK_FILTER = html`<div class="menu-anchor" id="stack-filter" hidden>
<button type="button" class="button" id="stack-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="stack-panel"><span class="muted">Stack:</span> <span class="stack-label" id="stack-label">All</span></button>
<div class="menu stack-menu" id="stack-panel" role="dialog" aria-label="Filter by stack" hidden><div class="menu-title">Show PRs in</div><div class="menu-scroll" id="stack-options" role="menu" aria-label="Stacks"></div></div>
</div>`

/** The Base filter: hidden until the page script finds the repo has more than one base branch. */
const BASE_FILTER = html`<div class="menu-anchor" id="bases-filter" hidden>
<button type="button" class="button" id="bases-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="bases-panel"><span class="muted">Base:</span> <span id="bases-label">All</span></button>
<section class="popover filter-popover" id="bases-panel" role="dialog" aria-label="Filter by base branch" hidden><fieldset class="filter-group"><legend class="visually-hidden">Show PRs on</legend>${bulkHead('Show PRs on', 'bases', 'base branch')}<div class="filter-options" id="bases-options"></div></fieldset></section>
</div>`

function labelsFilter(slug: string): Html {
  return html`<div class="menu-anchor" data-filter-group="labels">
<button type="button" class="button" id="labels-button" aria-haspopup="dialog" aria-expanded="false" aria-controls="labels-panel"><span class="muted">Labels:</span> <span id="labels-label">All</span></button>
<section class="popover filter-popover searchable-filter" id="labels-panel" role="dialog" aria-label="Filter by labels" hidden><fieldset class="filter-group"><legend class="visually-hidden">Labels</legend>${bulkHead('Labels', 'labels', 'label')}<input type="search" class="text-input" id="labels-search" aria-label="Search labels" placeholder="${T.filters.searchIn('labels', slug)}"><div class="filter-options people-list" id="labels-options"></div></fieldset></section>
</div>`
}

/** The sections editor, a modal dialog the page script fills. */
function sectionsDialog(slug: string): Html {
  return html`<dialog class="sections-dialog" id="sections-dialog" aria-labelledby="sections-title">
<div class="dialog-head"><h2 id="sections-title">Sections · ${slug}</h2><button type="button" class="icon-button small-icon-button" id="sections-close" aria-label="Close" title="Close">${icon('x', 14)}</button></div>
<p class="small muted">${T.sections.note}</p>
<div class="section-head small muted" aria-hidden="true"><span>Order</span><span>Section name</span><span>Color</span><span>PRs with any of these labels</span><span></span></div>
<ol class="section-rows" id="section-rows"></ol>
<datalist id="label-options"></datalist>
<button type="button" class="link-button small section-add" id="section-add">+ Add section above the catch-all</button>
<p class="small section-preview" id="section-preview" aria-live="polite"></p>
<p class="notice bad small" id="sections-error" role="status" hidden></p>
<div class="dialog-foot">
<button type="button" class="link-button small" id="sections-reset">Reset to Critical, Bugs, Tasks</button>
<span class="spacer"></span>
<button type="button" class="button" id="sections-cancel">Cancel</button>
<button type="button" class="button primary-button" id="sections-save">Save sections</button>
</div>
</dialog>`
}

/** The base branches' editor, a modal dialog the page script fills. */
function branchesDialog(slug: string): Html {
  return html`<dialog class="sections-dialog branches-dialog" id="branches-dialog" aria-labelledby="branches-title">
<div class="dialog-head"><h2 id="branches-title">Base branches · ${slug}</h2><button type="button" class="icon-button small-icon-button" id="branches-close" aria-label="Close" title="Close">${icon('x', 14)}</button></div>
<p class="small muted">${T.settings.branchesNote}</p>
<ul class="branch-rows" id="branch-rows" aria-labelledby="branches-title"></ul>
<button type="button" class="link-button small branch-add" id="branch-add">+ Add branch</button>
<p class="notice bad small" id="branches-error" role="status" hidden></p>
<div class="dialog-foot">
<span class="spacer"></span>
<button type="button" class="button" id="branches-cancel">Cancel</button>
<button type="button" class="button primary-button" id="branches-save">Save branches</button>
</div>
</dialog>`
}

/** Highest priority's editor: the saved prompts, the one in use, how many PRs the agent may pick. */
function priorityDialog(slug: string): Html {
  return html`<dialog class="sections-dialog priority-dialog" id="priority-dialog" aria-labelledby="priority-title">
<div class="dialog-head"><h2 id="priority-title">Highest priority · ${slug}</h2><button type="button" class="icon-button small-icon-button" id="priority-close" aria-label="Close" title="Close">${icon('x', 14)}</button></div>
<p class="small muted">${T.priority.note}</p>
<div class="priority-prompts">
<div class="priority-prompts-head"><span class="setting-label" id="priority-list-label">Saved prompts</span><span class="small muted">${T.priority.pickNote}</span><span class="spacer"></span><button type="button" class="link-button small" id="priority-add">+ New prompt</button></div>
<ul class="priority-list" id="priority-list" aria-labelledby="priority-list-label"></ul>
</div>
<label class="prompt-field" for="priority-name"><span class="setting-label">Name</span></label>
<input type="text" class="text-input" id="priority-name" maxlength="${MAX_PRIORITY_NAME}">
<label class="prompt-field" for="priority-prompt"><span class="setting-label">Prompt</span></label>
<textarea class="text-input prompt-input" id="priority-prompt" rows="9" maxlength="${MAX_PRIORITY_PROMPT}"></textarea>
<label class="priority-count small" for="priority-count"><span class="setting-label">PRs to show</span><input type="number" class="text-input" id="priority-count" min="1" max="${MAX_PRIORITY_COUNT}" step="1" required></label>
<p class="notice bad small" id="priority-error" role="status" hidden></p>
<div class="dialog-foot">
<button type="button" class="link-button small" id="priority-reset">Reset default</button>
<span class="spacer"></span>
<button type="button" class="button" id="priority-cancel">Cancel</button>
<button type="button" class="button primary-button" id="priority-save">Save</button>
</div>
</dialog>`
}

/** The search, Saved, Filters, Reset and Columns line, then the row of filters it opens. */
function filterBars(filters: Html, tools: Html): Html {
  return html`<div class="toolbar filter-bar">
${SEARCH_BOX}
${SAVED_FILTERS}
${FILTERS_TOGGLE}
<button type="button" class="link-button" id="reset-filters" aria-label="Reset filters" title="Reset filters" hidden>Reset</button>
<button type="button" class="link-button" id="clear-sort" hidden>Clear sort</button>
<span class="spacer"></span>
${tools}
</div>
<div class="toolbar filter-bar more-filters" id="more-filters" hidden>
${BUILDER_BUTTON}
<div class="bar-filters" id="bar-filters">
${filters}
${helpTip('filters-help', 'How the filters combine', T.filters.helpPrs)}
</div>
</div>`
}

/** Your PRs: those on a base branch fill the main table, the rest sit in a stacked table below. */
function pullsBody(slug: string, tools: Html): Html {
  return html`${filterBars(
    html`${stateFilter(OPEN_STATES)}
${reviewsFilter('pulls')}
${BASE_FILTER}
${integrationsFilter()}
${authorsPicker(slug, 'People who reviewed your PRs', 'reviewers-', 'Reviewers')}
${STACK_FILTER}`,
    tools
  )}
${SYNC_NOTICES}
<section class="table-section" id="pulls-main" aria-labelledby="pulls-main-heading">
${foldHeading({ id: 'pulls-main-heading', fold: 'main', title: 'On base branches', body: 'pulls-main-body', count: 'pulls-main-count', after: showAll('pulls') })}
<div class="table-body" id="pulls-main-body">
<div class="card queue-table" id="pull-table" hidden></div>
<p class="card empty muted loading" id="pulls-empty" role="status">Loading…</p>
</div>
</section>
<section class="table-section stacked-section" id="stacked-section" aria-labelledby="stacked-heading" hidden>
${foldHeading({ id: 'stacked-heading', fold: 'stacked', title: 'Stacked on other branches', body: 'stacked-body', count: 'stacked-count' })}
<div class="card queue-table" id="stacked-body"></div>
</section>
<template id="reviewed-by-help">${reviewedByHelp('pulls')}</template>
<template id="status-help">${statusHelp('pulls')}</template>`
}

/** The Review queue: Highest priority, then the PRs waiting for review in their sections, then the stacked ones. */
function queueBody(slug: string, canAsk: boolean, tools: Html): Html {
  return html`${filterBars(
    html`${stateFilter(OPEN_STATES)}
${authorsPicker(slug, 'Authors with open PRs')}
${labelsFilter(slug)}
${reviewsFilter('queue')}
${BASE_FILTER}
${integrationsFilter()}
${STACK_FILTER}`,
    tools
  )}
<p class="notice bad" id="queue-error" role="status" hidden></p>
<p class="notice" id="queue-target" role="status" hidden></p>
<section class="table-section priority-section" id="queue-priority" aria-labelledby="queue-priority-heading"${canAsk ? '' : raw(' hidden')}>
${foldHeading({
  id: 'queue-priority-heading',
  fold: 'priority',
  title: 'Highest priority',
  body: 'queue-priority-body',
  count: 'queue-priority-count',
  after: html`<span class="small muted priority-when" id="queue-priority-when"></span><span class="spacer"></span><button type="button" class="button small-button priority-prompt" id="queue-priority-edit" aria-haspopup="dialog" title="Edit prompt"><span class="muted">Prompt:</span> <span class="priority-prompt-name" id="queue-priority-prompt">Default</span></button><button type="button" class="button small-button row-sync priority-ask" id="queue-priority-sync" aria-label="${T.queue.prioritySync}" title="${T.queue.prioritySync}">${icon('bulb', 14)} Ask AI</button>`,
})}
<div class="table-body" id="queue-priority-body">
<p class="small muted" id="queue-priority-note" role="status"></p>
<p class="notice bad small" id="queue-priority-error" role="status" hidden></p>
<div class="card queue-table" id="queue-priority-table" hidden></div>
</div>
</section>
<section class="table-section notified-section" id="queue-notified" aria-labelledby="queue-notified-heading" hidden>
${foldHeading({
  id: 'queue-notified-heading',
  fold: 'notified',
  title: 'Linked here',
  body: 'queue-notified-body',
  count: 'queue-notified-count',
  after: html`<button type="button" class="link-button small" id="queue-notified-hide">Hide</button>`,
})}
<div class="table-body" id="queue-notified-body">
<p class="small muted">${T.queue.notifiedNote}</p>
<div class="card queue-table" id="queue-notified-table"></div>
</div>
</section>
<section class="table-section" id="queue-main" aria-labelledby="queue-main-heading">
${foldHeading({ id: 'queue-main-heading', fold: 'main', title: 'Waiting for review', body: 'queue-main-body', count: 'queue-main-count', after: showAll('queue') })}
<div class="table-body" id="queue-main-body">
<div class="card queue-table" id="queue-table" hidden></div>
<p class="card empty muted loading" id="queue-empty" role="status">Loading…</p>
</div>
</section>
<section class="table-section stacked-section" id="queue-stacked" aria-labelledby="queue-stacked-heading" hidden>
${foldHeading({ id: 'queue-stacked-heading', fold: 'stacked', title: 'Stacked on other branches', body: 'queue-stacked-table', count: 'queue-stacked-count' })}
<div class="card queue-table" id="queue-stacked-table"></div>
</section>
${priorityDialog(slug)}
<template id="reviewed-by-help">${reviewedByHelp('queue')}</template>
<template id="status-help">${statusHelp('queue')}</template>`
}

/** JSON inside a <script> element, with nothing that could end it early. */
const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

/**
 * One table's page main: its commands, filters, tables and dialogs. It names the project for the
 * page scripts.
 */
export function listsMain(data: ListsPageData): Html {
  const slug = `${data.owner}/${data.repo}`
  return html`<main id="main" class="lists" data-page="${data.tab}" data-owner="${data.owner}" data-name="${data.repo}" data-base="${data.base}" data-forge="${data.forge}" data-agent="${data.canGenerate ? 'true' : 'false'}">
<script type="application/json" id="saved-filters">${raw(scriptJson(data.savedFilters))}</script>
${data.tab === 'queue' ? queueBody(slug, data.canGenerate, tableTools()) : pullsBody(slug, tableTools())}
${builderPanel(data.canGenerate)}
${sectionsDialog(slug)}
${branchesDialog(slug)}
</main>`
}
