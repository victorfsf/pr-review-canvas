// @ts-check
// Modals that ask before a change: what changes, Cancel, and the button that makes it. Removing
// something shows that button in red; any other change (`danger: false`) in the page's own color.
// `askName` asks for a name the same way, in a field. One dialog per document, made the first time
// it is asked for; Escape and Cancel keep things as they are. Names only ever become text.
import { button, el, iconNode } from './dom.js'

/**
 * The page's one dialog, emptied and headed by `title`, with a Close button.
 * @param {Document} doc
 * @param {string} heading
 */
function dialogFor(doc, heading) {
  let dialog = /** @type {HTMLDialogElement | null} */ (doc.getElementById('confirm-dialog'))
  if (dialog === null) {
    dialog = /** @type {HTMLDialogElement} */ (el(doc, 'dialog', 'sections-dialog confirm-dialog'))
    dialog.id = 'confirm-dialog'
    dialog.setAttribute('aria-labelledby', 'confirm-title')
    dialog.setAttribute('aria-describedby', 'confirm-text')
    doc.body.append(dialog)
  }
  const head = el(doc, 'div', 'dialog-head')
  const title = el(doc, 'h2', undefined, heading)
  title.id = 'confirm-title'
  const close = button(doc, 'icon-button small-icon-button', '')
  close.append(iconNode(doc, 'x', 14))
  close.setAttribute('aria-label', 'Close')
  close.title = 'Close'
  head.append(title, close)
  return { box: dialog, head, close }
}

/**
 * Shows `box` until `done` is called: Close, Cancel and Escape call it with null.
 * @template T
 * @param {HTMLDialogElement} box
 * @param {HTMLElement} close
 * @param {HTMLElement} cancel
 * @param {(done: (value: T | null) => void) => void} wire
 * @param {HTMLElement} focus
 * @returns {Promise<T | null>}
 */
function show(box, close, cancel, wire, focus) {
  return new Promise(resolve => {
    const done = (/** @type {T | null} */ value) => {
      box.removeEventListener('cancel', onCancel)
      if (typeof box.close === 'function') box.close()
      // A browser without dialogs, or one opened without showModal, keeps the attribute.
      box.removeAttribute('open')
      resolve(value)
    }
    const onCancel = () => done(null)
    box.addEventListener('cancel', onCancel)
    close.addEventListener('click', () => done(null))
    cancel.addEventListener('click', () => done(null))
    wire(done)
    if (typeof box.showModal === 'function') box.showModal()
    else box.setAttribute('open', '')
    focus.focus()
  })
}

/**
 * Asks, and resolves true once the person confirms; false on Cancel, Close or Escape.
 * @param {Document} doc
 * @param {{ title: string, text: string, confirm: string, danger?: boolean }} words
 * @returns {Promise<boolean>}
 */
export async function confirmRemove(doc, words) {
  const { box, head, close } = dialogFor(doc, words.title)
  const text = el(doc, 'p', 'small', words.text)
  text.id = 'confirm-text'
  const foot = el(doc, 'div', 'dialog-foot')
  const cancel = button(doc, 'button', 'Cancel')
  cancel.id = 'confirm-cancel'
  const ok = button(
    doc,
    `button ${words.danger === false ? 'primary-button' : 'danger-button'}`,
    words.confirm
  )
  ok.id = 'confirm-ok'
  foot.append(el(doc, 'span', 'spacer'), cancel, ok)
  box.replaceChildren(head, text, foot)
  // Cancel has the focus, so Enter by accident changes nothing.
  const yes = await show(box, close, cancel, done => ok.addEventListener('click', () => done(true)), cancel)
  return yes === true
}

/**
 * Asks for a name in a field that starts at `value`, and resolves with it trimmed; null on Cancel,
 * Close or Escape. `check` says why a name will not do, or null when it will; the dialog stays
 * open, saying why, until it will.
 * @param {Document} doc
 * @param {{ title: string, label: string, value: string, confirm: string, check: (name: string) => string | null }} words
 * @returns {Promise<string | null>}
 */
export function askName(doc, words) {
  const { box, head, close } = dialogFor(doc, words.title)
  const form = /** @type {HTMLFormElement} */ (el(doc, 'form', 'confirm-form'))
  const label = /** @type {HTMLLabelElement} */ (el(doc, 'label', 'small', words.label))
  label.htmlFor = 'confirm-name'
  label.id = 'confirm-text'
  const input = /** @type {HTMLInputElement} */ (el(doc, 'input', 'text-input'))
  input.id = 'confirm-name'
  input.type = 'text'
  input.maxLength = 80
  input.value = words.value
  const error = el(doc, 'p', 'notice bad small')
  error.setAttribute('role', 'status')
  error.hidden = true
  const foot = el(doc, 'div', 'dialog-foot')
  const cancel = button(doc, 'button', 'Cancel')
  cancel.id = 'confirm-cancel'
  const ok = button(doc, 'button primary-button', words.confirm)
  ok.id = 'confirm-ok'
  ok.type = 'submit'
  foot.append(el(doc, 'span', 'spacer'), cancel, ok)
  form.append(label, input, error, foot)
  box.replaceChildren(head, form)
  const answer = show(
    box,
    close,
    cancel,
    done =>
      form.addEventListener('submit', event => {
        event.preventDefault()
        const name = input.value.trim()
        const why = words.check(name)
        error.hidden = why === null
        error.textContent = why ?? ''
        if (why === null) done(name)
      }),
    input
  )
  input.select()
  return answer
}
