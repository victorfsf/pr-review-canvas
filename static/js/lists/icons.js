// @ts-check
// Tabler Icons (MIT), outline set: the paths of each icon this tool draws. The server inlines
// them in the shell and the page builds rows with them, so both draw the same marks. Only these
// constants ever become markup; nothing from GitHub does.

/** @type {Record<string, string[]>} */
const PATHS = {
  brush: [
    'M3 21v-4a4 4 0 1 1 4 4h-4',
    'M21 3a16 16 0 0 0 -12.8 10.2',
    'M21 3a16 16 0 0 1 -10.2 12.8',
    'M10.6 9a9 9 0 0 1 4.4 4.4',
  ],
  check: ['M5 12l5 5l10 -10'],
  // message-chatbot: whatever talks to Claude.
  messageChatbot: [
    'M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z',
    'M9.5 9h.01',
    'M14.5 9h.01',
    'M9.5 13a3.5 3.5 0 0 0 5 0',
  ],
  history: ['M12 8l0 4l2 2', 'M3.05 11a9 9 0 1 1 .5 4m-.5 5v-5h5'],
  fileText: [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
    'M9 9l1 0',
    'M9 13l6 0',
    'M9 17l6 0',
  ],
  send: ['M10 14l11 -11', 'M21 3l-6.5 18a.55 .55 0 0 1 -1 0l-3.5 -7l-7 -3.5a.55 .55 0 0 1 0 -1l18 -6.5'],
  bulb: [
    'M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7',
    'M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3',
    'M9.7 17l4.6 0',
  ],
  circleCheck: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M9 12l2 2l4 -4'],
  bell: [
    'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6',
    'M9 17v1a3 3 0 0 0 6 0v-1',
  ],
  bellOff: [
    'M9.346 5.353c.21 -.129 .428 -.246 .654 -.353a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3m-1 3h-13a4 4 0 0 0 2 -3v-3a6.996 6.996 0 0 1 1.273 -3.707',
    'M9 17v1a3 3 0 0 0 6 0v-1',
    'M3 3l18 18',
  ],
  settings: [
    'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065z',
    'M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
  ],
  copy: [
    'M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666',
    'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
  ],
  book: [
    'M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0',
    'M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0',
    'M3 6l0 13',
    'M12 6l0 13',
    'M21 6l0 13',
  ],
  pull: [
    'M4 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M4 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M16 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M6 8l0 8',
    'M11 6h5a2 2 0 0 1 2 2v8',
    'M14 9l-3 -3l3 -3',
  ],
  pullDraft: [
    'M4 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M4 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M16 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M6 8v8',
    'M18 11h.01',
    'M18 6h.01',
  ],
  github: [
    'M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5',
  ],
  fileDiff: [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
    'M12 10l0 4',
    'M10 12l4 0',
    'M10 17l4 0',
  ],
  ban: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M5.7 5.7l12.6 12.6'],
  sidebarCollapse: [
    'M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z',
    'M9 4v16',
    'M15 10l-2 2l2 2',
  ],
  sidebarExpand: [
    'M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2z',
    'M9 4v16',
    'M14 10l2 2l-2 2',
  ],
  help: [
    'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
    'M12 17l0 .01',
    'M12 13.5a1.5 1.5 0 0 1 1 -1.5a2.6 2.6 0 1 0 -3 -4',
  ],
  message: [
    'M8 9h8',
    'M8 13h6',
    'M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z',
  ],
  inbox: [
    'M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12',
    'M4 13h3l3 3h4l3 -3h3',
  ],
  x: ['M18 6l-12 12', 'M6 6l12 12'],
  search: ['M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M21 21l-6 -6'],
  plus: ['M12 5l0 14', 'M5 12l14 0'],
  pencil: ['M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4', 'M13.5 6.5l4 4'],
  deviceFloppy: [
    'M6 4h10l4 4v10a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2',
    'M12 14m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M14 4l0 4l-6 0l0 -4',
  ],
  stack: ['M12 4l-8 4l8 4l8 -4l-8 -4', 'M4 12l8 4l8 -4', 'M4 16l8 4l8 -4'],
  play: ['M7 4v16l13 -8l-13 -8'],
  reply: ['M18 18v-6a3 3 0 0 0 -3 -3h-10l4 -4m0 8l-4 -4'],
  // user-plus: who a PR asks to review it, and asking more.
  userPlus: ['M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0', 'M16 19h6', 'M19 16v6', 'M6 21v-2a4 4 0 0 1 4 -4h4'],
  // mood-plus: give a comment a reaction.
  moodPlus: [
    'M20.985 12.528a9 9 0 1 0 -8.45 8.456',
    'M16 19h6',
    'M19 16v6',
    'M9 10h.01',
    'M15 10h.01',
    'M9.5 15c.658 .64 1.56 1 2.5 1s1.842 -.36 2.5 -1',
  ],
  tool: ['M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5'],
  userCheck: ['M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0', 'M6 21v-2a4 4 0 0 1 4 -4h4', 'M15 19l2 2l4 -4'],
  // browser-check: PR Review Canvas, a window with a check, after its own logo.
  browserCheck: [
    'M4 5a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1l0 -14',
    'M4 8h16',
    'M8 4v4',
    'M9.5 14.5l1.5 1.5l3 -3',
  ],
  arrowUp: ['M12 5l0 14', 'M18 11l-6 -6', 'M6 11l6 -6'],
  arrowDown: ['M12 5l0 14', 'M18 13l-6 6', 'M6 13l6 6'],
  trash: [
    'M4 7l16 0',
    'M10 11l0 6',
    'M14 11l0 6',
    'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12',
    'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
  ],
  chart: [
    'M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6',
    'M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10',
    'M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14',
    'M4 20h14',
  ],
  chevronRight: ['M9 6l6 6l-6 6'],
  filter: [
    'M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227z',
  ],
  refresh: ['M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4', 'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4'],
  // arrow-forward-up: turns a Stats tile to its other side.
  flip: ['M15 14l4 -4l-4 -4', 'M19 10h-11a4 4 0 1 0 0 8h1'],
  flipBack: ['M9 14l-4 -4l4 -4', 'M5 10h11a4 4 0 1 1 0 8h-1'],
  alert: [
    'M12 9v4',
    'M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z',
    'M12 16h.01',
  ],
  circleX: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M10 10l4 4m0 -4l-4 4'],
  arrowUpRight: ['M17 7l-10 10', 'M8 7l9 0l0 9'],
  brandVercel: ['M3 19h18l-9 -15l-9 15'],
  // carrot: what asks CodeRabbit.
  carrot: [
    'M3 21s9.834 -3.489 12.684 -6.34a4.487 4.487 0 0 0 0 -6.344a4.483 4.483 0 0 0 -6.342 0c-2.86 2.861 -6.347 12.689 -6.347 12.689z',
    'M9 13l-1.5 -1.5',
    'M16 14l-2 -2',
    'M22 8s-1.14 -2 -3 -2c-1.406 0 -3 2 -3 2s1.14 2 3 2s3 -2 3 -2z',
    'M16 2s-2 1.14 -2 3s2 3 2 3s2 -1.577 2 -3c0 -1.86 -2 -3 -2 -3z',
  ],
  // brand-jira: every Jira link and button.
  brandJira: [
    'M20 4h-9v1.5a2.5 2.5 0 0 0 2.5 2.5h1.5a1 1 0 0 1 1 1v1.5a2.5 2.5 0 0 0 2.5 2.5h1.5v-9',
    'M15 8h-8v1.5a2.5 2.5 0 0 0 2.5 2.5h1.5a1 1 0 0 1 1 1v1.5a2.5 2.5 0 0 0 2.5 2.5h1.5v-8a1 1 0 0 0 -1 -1',
    'M11 12h-8v1.5a2.5 2.5 0 0 0 2.5 2.5h1.5a1 1 0 0 1 1 1v1.5a2.5 2.5 0 0 0 2.5 2.5h1.5v-8a1 1 0 0 0 -1 -1',
  ],
  listCheck: [
    'M3.5 5.5l1.5 1.5l2.5 -2.5',
    'M3.5 11.5l1.5 1.5l2.5 -2.5',
    'M3.5 17.5l1.5 1.5l2.5 -2.5',
    'M11 6l9 0',
    'M11 12l9 0',
    'M11 18l9 0',
  ],
  rotateDot: ['M19.95 11a8 8 0 1 0 -.5 4m.5 5v-5h-5', 'M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'],
  // git-pull-request-closed: a closed PR's badge on its page.
  pullClosed: [
    'M6 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M18 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M6 8v8',
    'M18 11v5',
    'M16 4l4 4m0 -4l-4 4',
  ],
  // git-merge: Update, which brings the base's new commits into the branch, and a merged PR's
  // badge on its page. Refresh is Sync's alone.
  gitMerge: [
    'M7 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M7 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M17 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M7 8l0 8',
    'M7 8a4 4 0 0 0 4 4h4',
  ],
  // square, square-check and square-minus: the tick-all box, unticked, all ticked, some ticked.
  square: ['M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z'],
  squareCheck: [
    'M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z',
    'M9 12l2 2l4 -4',
  ],
  squareMinus: ['M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z', 'M9 12l6 0'],
  // chevrons-down and chevrons-up: expand every row, collapse every row.
  chevronsDown: ['M7 7l5 5l5 -5', 'M7 13l5 5l5 -5'],
  chevronsUp: ['M7 11l5 -5l5 5', 'M7 17l5 -5l5 5'],
  // list and list-details: rows as their first line alone, or with a preview of their text.
  list: ['M9 6l11 0', 'M9 12l11 0', 'M9 18l11 0', 'M5 6l0 .01', 'M5 12l0 .01', 'M5 18l0 .01'],
  listDetails: [
    'M13 5h8',
    'M13 9h5',
    'M13 15h8',
    'M13 19h5',
    'M3 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z',
    'M3 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z',
  ],
  // git-merge-queue: a PR in GitHub's merge queue (Tabler 3.48+). Its two dots are filled there; at
  // this stroke a circle of radius 1 draws as one.
  gitMergeQueue: [
    'M4 18a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M16 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M6 11v5',
    'M4.5 4.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
    'M9.5 9.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  ],
  pullConflict: [
    'M16 18a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M11 6h5a2 2 0 0 1 2 2v8',
    'M4 18a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
    'M6 11v5',
    'M4 4l4 4',
    'M8 4l-4 4',
  ],
}

/** Tabler's filled set: these draw as solid shapes, not strokes. */
const FILLED = /** @type {Record<string, string[]>} */ ({
  brandVercelFilled: [
    'M11.143 3.486a1 1 0 0 1 1.714 0l9 15a1 1 0 0 1 -.857 1.514h-18a1 1 0 0 1 -.857 -1.514z',
  ],
  alertCircleFilled: [
    'M12 2c5.523 0 10 4.477 10 10a10 10 0 0 1 -19.995 .324l-.005 -.324l.004 -.28c.148 -5.393 4.566 -9.72 9.996 -9.72zm.01 13l-.127 .007a1 1 0 0 0 0 1.986l.117 .007l.127 -.007a1 1 0 0 0 0 -1.986l-.117 -.007zm-.01 -8a1 1 0 0 0 -.993 .883l-.007 .117v4l.007 .117a1 1 0 0 0 1.986 0l.007 -.117v-4l-.007 -.117a1 1 0 0 0 -.993 -.883z',
  ],
})

/** @typedef {keyof typeof PATHS} IconName */

/**
 * One icon as SVG markup, hidden from assistive tech: the control around it carries the name.
 * @param {string} name
 * @param {number} [size]
 */
export function iconSvg(name, size = 16) {
  const filled = FILLED[name]
  if (filled !== undefined)
    return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${filled.map(d => `<path d="${d}"/>`).join('')}</svg>`
  const paths = PATHS[name] ?? []
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths.map(d => `<path d="${d}"/>`).join('')}</svg>`
}
