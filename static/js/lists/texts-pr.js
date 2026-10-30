// @ts-check
// The texts of a PR's row: its title menu, who reviewed it, who it asks to review it and its health,
// read as `TEXTS.pr`. See texts.js.
export const PR = {
  /** The title's menu and a row's stack place (title-menu.js): their tooltips. */
  titleMenu: {
    chooseWhere: 'Choose where to open',
    stackFilter: (/** @type {string} */ stack) => `Filter by stack ${stack}`,
  },
  /** The "Reviewed by" column's legend (reviewers.js), and a PR with no reviews. */
  reviewers: {
    approvals: 'Approvals',
    changesRequested: 'Change requests',
    dismissed: 'Dismissed approvals or change requests',
    comments: 'Comments and threads',
    none: 'No reviews yet',
  },
  /** Who a PR asks to review it (review-requests.js): its button, its popup and its toasts. */
  reviewRequests: {
    button: 'Reviewers',
    buttonFor: (/** @type {number} */ pr) => `Reviewers of #${pr}`,
    title: (/** @type {number} */ pr) => `Reviewers of #${pr}`,
    groups: 'Saved groups',
    noGroups: 'No saved groups yet: pick people, then save them as one.',
    /** A saved group's tooltip: what a click does, by whether all of it is ticked. */
    groupAdd: 'Tick everyone in this group',
    groupRemove: 'Untick everyone in this group',
    pick: 'Pick people',
    clear: 'Untick everyone',
    search: 'Search by login or name',
    noMatch: 'No one matches.',
    loading: 'Loading…',
    picked: (/** @type {number} */ n) => (n === 0 ? 'No one picked' : `${n} picked`),
    saveAs: 'Save as',
    save: 'Save',
    /** What closing the popup will send, before it does: who it asks, and who it stops asking. */
    willSend: (/** @type {readonly string[]} */ add, /** @type {readonly string[]} */ remove) =>
      [
        ...(add.length === 0 ? [] : [`Asks ${add.join(', ')}`]),
        ...(remove.length === 0 ? [] : [`stops asking ${remove.join(', ')}`]),
      ].join(' and ') + ' when this closes.',
    discard: 'Discard changes',
    /** The button's tooltip while what closing sent goes to the forge. */
    sending: 'Sending the review requests…',
    /** The toast once the forge has them, or why it refused them. */
    sent: (
      /** @type {number} */ pr,
      /** @type {readonly string[]} */ add,
      /** @type {readonly string[]} */ remove
    ) => ({
      title: `Reviewers of #${pr} updated`,
      context: [
        ...(add.length === 0 ? [] : [`Asked ${add.join(', ')}`]),
        ...(remove.length === 0 ? [] : [`stopped asking ${remove.join(', ')}`]),
      ].join(' · '),
    }),
    failed: (/** @type {number} */ pr, /** @type {string} */ error) => ({
      title: `Reviewers of #${pr} not changed`,
      context: error,
    }),
    /** The side panel's mark beside someone asked to review. */
    requested: 'Requested',
  },
  /** The Status column (health.js): its legend, then each mark's tooltip. */
  health: {
    legend: {
      requested: 'Asks you by name for your review',
      failing: 'CI failing',
      running: 'CI running',
      stuck: 'CI stuck',
      passing: 'Checks passing',
      conflict: 'Merge conflict with its base branch',
      vercel: 'Vercel preview ready, building or failed',
    },
    marks: {
      requested: 'Awaiting your review',
      failing: (/** @type {number} */ n) => `CI failing: ${n === 1 ? '1 check' : `${n} checks`} failed`,
      running: 'CI running',
      stuck: (/** @type {string} */ why) => `CI stuck: ${why}`,
      passing: 'Checks passing',
      conflict: 'Merge conflict with its base branch',
      vercel: (/** @type {string} */ said) => `Vercel preview ${said}`,
    },
  },
}
