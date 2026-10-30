// @ts-check
// Help "?" buttons: their legend shows on hover and keyboard focus through CSS alone. All this adds
// is Escape, which closes the legend until the pointer or focus leaves, as for the "+N" popup. It
// listens on the document, so legends a page script adds later (the Review queue's) work too.

/** @param {Document} doc */
export function wireHelp(doc) {
  const anchorOf = (/** @type {EventTarget | null} */ target) =>
    target instanceof Element ? target.closest('.help-anchor') : null
  doc.addEventListener('keydown', event => {
    if (event.key === 'Escape') anchorOf(event.target)?.classList.add('popup-closed')
  })
  doc.addEventListener('mouseout', event => {
    const anchor = anchorOf(event.target)
    const to = /** @type {MouseEvent} */ (event).relatedTarget
    if (anchor !== null && !(to instanceof Node && anchor.contains(to)))
      anchor.classList.remove('popup-closed')
  })
  doc.addEventListener('focusout', event => {
    const anchor = anchorOf(event.target)
    const to = /** @type {FocusEvent} */ (event).relatedTarget
    if (anchor !== null && !(to instanceof Node && anchor.contains(to)))
      anchor.classList.remove('popup-closed')
  })
}
