// @ts-check
// @vitest-environment node
// Loaded where there is no document, as the server's bundler and tests load it, the page script
// wires nothing on import.
it('wires nothing on import without a document', async () => {
  expect(typeof document).toBe('undefined')
  const { wireHomePage } = await import('./home-page.js')
  expect(typeof wireHomePage).toBe('function')
})
