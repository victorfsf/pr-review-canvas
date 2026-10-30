// @ts-check
// The texts of the Inbox, Your PRs and the Review queue: filters, rows, editors; read as `TEXTS.lists`. See texts.js.
export const LISTS = {
  /** The filter bar's Filters button and its State checklist, on every list page. */
  filterBar: {
    stateKept: 'One state stays ticked',
    showFilters: 'Show the filters',
    filtersOn: (/** @type {number} */ on) => `${on} ${on === 1 ? 'filter' : 'filters'} on`,
  },

  /** What an empty list says, on the Inbox, Your PRs and the Review queue. */
  empty: {
    inboxNothingYet: 'Nothing yet. New comments, reviews, checks and conflicts on your PRs show here.',
    noEvents: 'No events match these filters.',
    noPrs: 'No PRs match these filters.',
    pullsOpen: 'No open PRs of yours that are ready for review.',
    pullsDraft: 'No draft PRs of yours.',
    pullsQueued: 'None of your PRs is in the merge queue.',
    pullsNone: (/** @type {string} */ slug) => `You have no open PRs in ${slug}.`,
    queueOpen: (/** @type {string} */ slug) => `Nobody is waiting on your review in ${slug}.`,
    queueDraft: (/** @type {string} */ slug) => `Nobody else has a draft PR in ${slug}.`,
    queueQueued: (/** @type {string} */ slug) => `Nobody else has a PR in the merge queue in ${slug}.`,
    queueNone: (/** @type {string} */ slug) => `Nobody else has an open PR in ${slug}.`,
    noneTarget: (/** @type {string} */ names) => `None of these PRs target ${names}.`,
    allStacked: 'Every PR shown is stacked on another branch.',
  },

  /** Your PRs' rows. */
  /** The mark before a PR's title on Your PRs and the Review queue: its tooltip, by state. */
  state: { open: 'Open', draft: 'Draft', queued: 'Queued' },
  /** The Ready column of Your PRs and the Review queue, for a PR in GitHub's merge queue. */
  ready: {
    queuedFor: (/** @type {string} */ time) => `In the merge queue for ${time}`,
    openQueue: 'Open merge queue',
    openQueueFor: (/** @type {string} */ time) => `Open merge queue: in it for ${time}`,
  },
  pulls: {},

  /** The rows of Your PRs and the Review queue (pr-table.js): slim or whole, and opening them. */
  rows: {
    /** The toolbar's view button: what a click does, by whether the rows are slim. */
    slim: 'Compact view',
    whole: 'Full view',
    /** The toolbar's fold-all button, while the rows are slim. */
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    /** A slim row's arrow. */
    show: (/** @type {number} */ pr) => `Show more about #${pr}`,
    hide: (/** @type {number} */ pr) => `Show less about #${pr}`,
    /** A slim row's labels past the first: their count, and their names on hover. */
    moreLabels: (/** @type {readonly string[]} */ labels) =>
      `${labels.length} more ${labels.length === 1 ? 'label' : 'labels'}: ${labels.join(', ')}`,
  },

  /** The Review queue: its rows' pending counts, its Labels filter, its notices. */
  queue: {
    noLabels: 'No labels match.',
    fetchFailed: (/** @type {string} */ error) => `The review queue could not be fetched: ${error}`,
    noLongerWaits: (/** @type {number | string} */ pr) => `#${pr} no longer waits for your review.`,
  },

  /** The Review queue's Highest priority table: its Edit button, its status and its note. */
  priority: {
    editPrompt: (/** @type {string} */ name) => `Edit prompt: ${name}`,
    runningFor: (/** @type {string} */ duration) => `Running for ${duration}`,
    pickedAgo: (/** @type {string} */ ago) => `Picked ${ago}`,
    couldNotPick: (/** @type {string} */ failure) => `AI could not pick: ${failure}`,
    picking: (/** @type {number} */ count) =>
      `AI is picking ${count === 1 ? 'the PR' : `up to ${count} PRs`} to review first…`,
    pressSync: (/** @type {number} */ count) =>
      `Press sync to have AI pick ${count === 1 ? 'the PR' : `up to ${count} PRs`} to review first, by your prompt.`,
    stale: 'The prompt changed since these were picked: sync for new ones.',
    noneFits: 'AI found no PR in the queue that fits your prompt.',
    noLongerWait: 'The PRs AI picked no longer wait for your review: sync for new ones.',
  },

  /** The Highest priority prompt editor, its tooltips and what it says when a prompt is not right. */
  priorityEditor: {
    usePrompt: 'Use and edit this prompt',
    removePrompt: 'Remove this prompt',
    removeConfirm: (/** @type {string} */ name) =>
      `“${name}” and its prompt will be removed. Nothing is saved until you press Save.`,
    defaultKeepsName: 'The default prompt keeps its name',
    needsName: (/** @type {number} */ n) => `Prompt ${n} needs a name.`,
    nameTooLong: (/** @type {number} */ max) => `Keep each name to ${max} characters.`,
    sameName: (/** @type {string} */ name) => `Two prompts are named “${name}”.`,
    needsPrompt: (/** @type {string} */ name) => `Write what makes a PR highest priority in “${name}”.`,
    promptTooLong: (/** @type {string} */ name, /** @type {number} */ max) =>
      `Keep “${name}” to ${max} characters.`,
    keepOne: 'Keep at least one prompt.',
    tooMany: (/** @type {number} */ max) => `Keep up to ${max} prompts.`,
    countRange: (/** @type {number} */ max) => `Show 1 to ${max} PRs.`,
  },

  /** The Sections editor on Your PRs. */
  sectionsEditor: {
    catchAll: 'Everything that matches no section above. Can be renamed, not moved or deleted.',
    addLabel: 'Add label…',
    needsName: 'Every section needs a name.',
    couldNotLoad: (/** @type {string} */ message) => `Could not load the sections: ${message}`,
  },

  /** What the Sections and Highest priority editors say when saving fails. */
  editors: {
    notSaved: (/** @type {string} */ message) => `Not saved: ${message}`,
  },

  /** What the base branches setting says when the list is not right. */
  branches: {
    keepOne: 'Keep at least one base branch.',
    tooMany: (/** @type {number} */ max) => `At most ${max} base branches.`,
    needsName: 'Every branch needs a name.',
    notBranch: (/** @type {string} */ name) => `"${name}" is not a branch name.`,
    twice: (/** @type {string} */ name) => `"${name}" is listed twice.`,
  },

  /** The search box over the lists, and what it says when nothing matches. */
  search: {
    placeholderJira: 'Title, branch, #123 or PROJ-123',
    placeholder: 'Title, branch or #123',
    foundByJira: 'Found by its Jira card',
    /** With `hidden` PRs more that match with the filters reset; {clear} and {reset} are buttons. */
    noMatch: (/** @type {string} */ query, /** @type {number} */ hidden) =>
      `No PRs match “${query}”. {clear}` +
      (hidden > 0
        ? ` · ${hidden} ${hidden === 1 ? 'more PR' : 'more PRs'} match${hidden === 1 ? 'es' : ''} with your filters reset. {reset}`
        : ''),
  },

  /** The Saved filters picker: its empty list, tooltips and confirmations. */
  savedFilters: {
    noneYet: 'No saved filters yet.',
    noneMatch: 'No saved filters match.',
    applied: 'Applied: press to clear the filters',
    apply: 'Apply these filters',
    builderOff: 'Built with the filter builder: turn it on in Settings → Experimental to use it',
    nameTaken: (/** @type {string} */ name) => `There is already a saved filter named “${name}”.`,
    pickFirst: 'Pick some filters first',
    alreadyCurrent: 'It has the current filters already',
    updateToCurrent: 'Update it to the current filters',
    updateConfirm: (/** @type {string} */ name) =>
      `“${name}” will keep the filters on the page now in place of its own.`,
    deleteConfirm: (/** @type {string} */ name) =>
      `“${name}” will be deleted for good. The filters on the page stay as they are.`,
    pickToSave: 'Pick some filters to save first',
    save: 'Save the filters on this page',
  },

  /** The filter builder's modal: its conditions, blocks and Ask AI chat. */
  filterBuilder: {
    filling: 'AI is filling the builder…',
    searchValues: (/** @type {string} */ label) => `Search ${label.toLowerCase()}`,
    noValues: 'No values match.',
    pickValueTip: 'Pick a value; until then this condition is left out',
    pickValues: 'Pick values',
    wordsPlaceholder: 'Words, #123, a key; AND, OR',
    wordsTip: 'Words must all match; OR, in capitals, between alternatives',
    everyHolds: 'Every condition must hold',
    anyHolds: 'Any condition may hold',
    switchToOr: 'Every one must hold. Switch to OR: any one is enough',
    switchToAnd: 'Any one is enough. Switch to AND: every one must hold',
    noConditions: 'No conditions: every row shows.',
    emptyBlock: 'No conditions yet: this block is left out.',
    addBlock: (/** @type {string} */ op) => `A block inside, joined by ${op} to start`,
  },
}
