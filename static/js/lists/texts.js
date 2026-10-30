// @ts-check
// Every text that explains something, in four files by area, gathered here to read and change:
// tooltips, help popovers, what dialogs and settings say, empty states, notices, toasts and
// placeholders. Short labels (button words, headings, menu items), saved data and the server's
// error messages stay with their code. The server's pages and the page scripts both read `TEXTS`
// from this file, never a part file. A text with a value in it is a function of that value.
//
// A new or changed explanation goes in its area's file and is read from `TEXTS`; none is written
// inline. The part files hold only strings and functions of them, and import nothing.
//
// A popover, dialog, toast or note is one text, whole, however many paragraphs it has, so it reads
// and changes in one place; it is never put together from pieces. Its markup: a blank line between
// paragraphs, **words** in bold, and {name} where the page puts a link, a button or a field. A toast
// is one object with its title and the line under it.
import { LISTS } from './texts-lists.js'
import { PR } from './texts-pr.js'
import { SERVER } from './texts-server.js'
import { SHELL } from './texts-shell.js'

export const TEXTS = {
  /** The server-drawn pages (src/server/html.ts). */
  server: SERVER,
  /** A PR's page, its chat, replies, Fix, Restack and Update. */
  pr: PR,
  /** The Inbox, Your PRs and the Review queue: their filters, rows and editors. */
  lists: LISTS,
  /** What every page shares: notifications, tooltips, stats, settings, confirmations. */
  shell: SHELL,
}
