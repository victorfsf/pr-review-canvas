// @ts-check
// The texts the tables share: the sync note and the base branches editor; read as `TEXTS.shell`. See texts.js.
export const SHELL = {
  /** The repo pages' "last synced" notice (dom.js). */
  sync: {
    /** @param {string} ago */
    stale: ago => `Last synced ${ago}.`,
  },
  /** The base branches editor (branches-editor.js). */
  settings: {
    branchPlaceholder: 'branch name',
    lastBranchTip: 'A repo keeps at least one base branch',
  },
}
