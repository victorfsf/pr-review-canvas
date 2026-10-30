// @ts-check
// The texts of the server-drawn pages (src/server/html.ts), read there as `TEXTS.server`. See texts.js.
export const SERVER = {
  /** The header on every page: the server's address, the color scheme menu and the bell's panel. */
  header: {
    serverOn: (/** @type {string} */ host) => `Server on ${host}`,
    followSystemNote: 'Switches between the light and dark version of the chosen palette',
    bellEmpty: 'Nothing yet.',
  },

  /** The home page: the connected repos and how to connect one. */
  home: {
    intro: 'Only repos you connect show here.',
    connectNote: "Run this inside the repo's clone. The clone path is recorded for AI chats.",
    cloneMissing: 'clone not found; run pr-greenlight open in its new folder',
    cloneMoved: "this folder's origin no longer points at this repo; run pr-greenlight open in its clone",
    lastSyncFailed: (/** @type {string} */ error) => `Last sync failed: ${error}`,
  },

  /** The repo pages' left nav. */
  nav: {
    chatsUnread: 'Chats with unread answers',
  },

  /** The filter bars of the Inbox, Your PRs and the Review queue: search, Saved, Columns and the "?". */
  filters: {
    searchPlaceholder: 'Title, branch or #123',
    searchTip: 'Search pull requests (/) by title, branch, PR number, Task number. Accepts AND/OR.',
    savedSearchPlaceholder: 'Search saved filters',
    /** A picker's search box, such as Authors or Labels: what it searches and the repo. */
    searchIn: (/** @type {string} */ what, /** @type {string} */ slug) => `Search ${what} in ${slug}`,
    columnsNote: 'Pull request and Actions always show.',
    /** The filters' "?" on the Inbox. */
    helpEvents:
      'An event shows only when it passes every filter.\n\n' +
      'Within one filter, any ticked choice is enough, such as Humans or Bots.\n\n' +
      'Every choice starts ticked. Untick them all and nothing shows.',
    /** The filters' "?" on Your PRs and the Review queue. */
    helpPrs:
      'A PR shows only when it passes every filter.\n\n' +
      'Within one filter, any ticked choice is enough, such as CI failing or CI stuck.\n\n' +
      'Every choice starts ticked. Untick them all and nothing shows.',
  },

  /** The filter builder (Settings → Experimental): its button and its dialog. */
  builder: {
    buttonTip: 'Build the filters in blocks joined by AND or OR',
    /** The dialog's note, on Your PRs and the Review queue. */
    notePrs:
      'Shows a PR when the blocks hold, in place of the filter bar. A condition with nothing ticked is left out. Saved filters keep the blocks.',
    /** The dialog's note, on the Inbox. */
    noteEvents:
      'Shows an event when the blocks hold, in place of the filter bar. A condition with nothing ticked is left out. Saved filters keep the blocks.',
    askPlaceholder: 'Describe what to show, such as: bugs from alice or bob, but no drafts',
    askNote: 'AI fills the blocks below; nothing changes on the page until you press Done.',
  },

  /** The "?" legends over the PR tables' columns: the text under each one's list of icons. */
  legends: {
    reviewedBy:
      'The first pill is whoever last requested changes, approved, or commented, checked in that order.\n\n' +
      '**Canvas** (comments posted from Canvas) and **Bots** (every bot together) come first only when no person has reviewed.\n\n' +
      '**+N** is everyone else; hover it to see their counts.',
    status:
      'Icons sit side by side when more than one holds; hover one for its details, such as which checks failed or why CI looks stuck.\n\n' +
      'No icon means the PR has no checks, or no sync has read it yet.',
  },

  /** The Inbox. */
  inbox: {
    notifyingOnly: 'Only what your notification settings let through: what the bell counts',
  },

  /** The Review queue: its Highest priority and From notifications tables. */
  queue: {
    prioritySync: 'Ask AI for the highest priority PRs',
    notifiedNote:
      'The PRs a link to this page named (#pr-123), whatever the filters show. They leave when you reload or go to another page.',
  },

  /** The Review queue's sections editor (also in Settings). */
  sections: {
    note: "A PR goes in the first section with any of its labels; the last one takes the rest. Each section's color heads its rows on Your PRs and the Review queue.",
  },

  /** The Highest priority editor (the Review queue and Settings). */
  priority: {
    note: "When you press the table's sync button, the chat agent reads the review queue and picks the PRs the prompt in use calls highest priority, the most important first. It reads only, changes nothing, and picks no more than the number below.",
    pickNote: 'Pick the one to use; it opens below to edit',
  },

  /** The Stats page. */
  stats: {
    ttfrToggle: "Showing your PRs. Click for your reviews of other people's PRs",
  },

  /** A PR's page: its header, tabs, columns and notices. */
  pullPage: {
    /** The narrow part beside each integration's button in a PR's header. */
    copyLink: (/** @type {string} */ name) => `Copy the ${name} link`,
    /** The search box over a PR's tabs. */
    searchPlaceholder: 'Search every tab',
    searchTip: 'Search the comments, reviews, replies and checks on every tab (/). Accepts AND/OR.',
    muteTip: 'Mute notifications until its review state changes',
    draftBadge: 'A draft: not ready for review yet',
    /** A merged or closed PR's page: its badge's tooltip. */
    mergedBadge: 'Merged on GitHub',
    closedBadge: 'Closed on GitHub without merging',
    resetSplit: 'Give the two columns their first widths again',
    /** Until a sync reads the comments; `what` is "sync", or "queue fetch" on a Review queue PR. */
    textMissing: (/** @type {string} */ what) => `Comment text loads with the next ${what}.`,
    columnHandle: 'Drag to resize; double-click for the first widths',
    overview: 'Pull request description',
    tabPending: 'What still needs you on this PR',
    tabAnswered: 'What you answered, with your answer, until someone asks you again',
    tabResolved: 'What you dismissed or resolved',
    tabAll: 'Everything that happened on this PR, newest first',
    queueTabPending: 'Comments, reviews and change requests that name you since you last wrote',
    queueTabWaiting: 'Comments and change requests waiting on the author or other reviewers',
  },

  /** Settings: what each setting does, the dialogs it opens, and its notes. */
  settings: {
    /** The page head's fold-all button: what a click does, by whether every section is shut. */
    expandAll: 'Expand all',
    collapseAll: 'Collapse all',
    conflictMode: 'Merge pushes plainly; rebase pushes with --force-with-lease',
    ratioWarning: 'Off for people who review far more PRs than they open, such as tech leads',
    branchesNote:
      "The bases your work targets. A PR based on any other branch is part of a stack. Base pills take their branch's color.",
    mentionWords:
      'Your @login always counts. These words count too, separated by commas: a Review queue comment, review or thread reply holding one waits on you in Pending, which shows what it matched. For every repo.',
    mentionPlaceholder: 'Your name, a nickname',
    answerNotes:
      "An answer to a comment, review or change request, posted as a PR comment from a PR's page, ends with metadata GitHub does not show, naming what it answers. Replies in review threads never have it. For every repo.",
    /** Shown while it is off. */
    answerNotesWarning:
      "**Warning:** off, some features might not work as expected. PR Greenlight, yours and your teammates', can then pair such an answer with what it answers only when it @mentions or quotes the author: answered items may stay in Pending, and replies stop gathering under the comment they answer.",
    aiIntro:
      'The model and effort Claude runs with. Each feature follows the default unless you pick its own.',
    aiDefault: 'Every AI feature, unless it has its own below',
    pullColumns:
      "Which side of a PR's page its tabs (Activity) and its Overview take. When the window is too narrow for both, the left one comes first.",
    chatWindow: 'The corner its button sits in on every repo page; Ask AI opens it there',
    codeRabbit: "Off hides its column, filter and the PR page's row; its comments still show",
    vercel:
      'Off hides the Vercel icon in Status, the Preview button and the Vercel filter choices, for a repo without Vercel',
    canvas:
      'Off hides its column, filter choices, Has canvas, the Canvas buttons and menu items; canvas comments still show',
    jira: "Links the Jira cards a PR's description links, from its title menu, its page and the search; the tool never calls Jira",
    canvasUrl: "Where its server runs, for every repo · pr-review-canvas's own is http://localhost:3010",
    experimentalIntro:
      'Features still being tried, off until you turn them on (the filter builder starts on). They may change or go away.',
    filterBuilder:
      'A Builder button on Your PRs, the Review queue and the Inbox: put any of their filters in blocks, each joined by AND or OR as you pick, in place of the filter bar.',
    desktop:
      "Desktop notifications from PR Greenlight's server, which show with no page open, and the tray icon, whose red dot shows while any repo has unread events. On, both show in Notifications to turn on.",
    exportNote:
      "Settings, each repo's choices, saved filters and searches, and what you dismissed, read and muted. Nothing from GitHub: no PR titles, comments or chats.",
    importNote:
      'From an export file. It applies to the repos connected here, and saves your current choices first.',
    importBackup: 'Your current choices are saved to ~/.pr-greenlight/backups/ first.',
    deleteChatsNote:
      "Every AI chat of this repo, with the PR text it read: its threads, Highest priority's notes, and AI's own session records. For good; it asks first.",
  },

  /** Notification choices, in Settings → Notifications and the Inbox's Notifications dialog. */
  notifications: {
    dialogTip: 'What notifies you, and where',
    /** {settings} is the link to Settings. */
    dialogFoot: 'Each change saves at once. Also in {settings}.',
    checkingMachine: 'Checking this machine…',
    desktopUses: (/** @type {string} */ detail) => `Uses ${detail}`,
    desktopOff: (/** @type {string} */ detail) => `Off: ${detail}`,
    checkingBrowser: 'Checking this browser…',
    /** {seconds} is the field. */
    soundGap: 'At most once every {seconds} s',
    toastsNote: 'Where they stack on the page. Desktop notifications show where your system puts them.',
    soundOverrides:
      'A notification without its own sound or volume uses the ones above, and one that is Off plays nothing. A volume set back to the one above follows it again. When several arrive together, the newest one that is not Off plays.',
    whatNotifies:
      "Each kind notifies in every place above that is on, and always shows in the Inbox; the Review queue's comments, reviews, checks and conflicts show there only while on.",
    onlyFrom: (/** @type {string} */ slug) =>
      `Review queue events in ${slug} only · checks and conflicts always notify, and so does everything on your PRs`,
  },

  /** Chat and the chat window: suggested questions, notes, empty states and placeholders. */
  chat: {
    /** The chat box's placeholder; `ask` is what it asks about, "Ask" in the chat window. */
    placeholder: (/** @type {string} */ ask) => `${ask}… (Ctrl+Enter sends)`,
    suggestPlaceholder: 'Add a suggestion',
    searchPlaceholder: 'Search chats',
    noChats: 'No chats yet.',
    dismissed: 'This chat is dismissed: restore it to ask more.',
    /** What the repo chat reads, with how many of your PRs and queue PRs it reads. */
    readsRepo: (/** @type {number} */ pulls, /** @type {number} */ queue) =>
      `Reads ${pulls} ${pulls === 1 ? 'open PR of yours' : 'open PRs of yours'}, ${queue} ${queue === 1 ? 'PR' : 'PRs'} in the review queue and the repo's code. Read-only: it changes nothing.`,
    readsPull:
      "Reads this PR's comments, reviews and threads, and its code at the head commit. Read-only: it changes nothing.",
    emptyRepo: 'Start a chat about any open PR in this repo: yours or the ones waiting for your review.',
    emptyPull: (/** @type {number} */ n) => `Start a chat about #${n}: what is pending, a check, a conflict.`,
    emptyItem: 'Start a chat about this comment.',
    /** The questions each kind of chat suggests asking. */
    hints: {
      repo: [
        'Which PRs in the review queue should I review first?',
        'Which open PRs touch the same files?',
        'Which of my PRs would conflict with each other once merged?',
      ],
      item: ['Is this comment right?', 'What would fixing it change?', 'Draft a reply to this comment.'],
      /** On a PR's chat while the repo uses CodeRabbit. */
      codeRabbit: 'Which of CodeRabbit’s comments still apply to the latest code?',
      queue: [
        'Did the latest commits address what I asked for?',
        'Which replies to my threads still leave my question open?',
        'Do any reviewers ask for things that contradict each other?',
      ],
      pull: [
        'Which open threads do my latest commits already address?',
        'Why are the checks failing, and what would fix them?',
        'How should I resolve the conflict with the base branch?',
        'Do any reviewers ask for things that contradict each other?',
      ],
    },
  },
}
