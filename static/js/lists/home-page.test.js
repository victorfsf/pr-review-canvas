// @ts-check
// @vitest-environment happy-dom
import { wireBranchesEditor } from './branches-editor.js'
import { wireHelp } from './help.js'
import { wireHomePage } from './home-page.js'
import { wirePullsPage } from './pulls-page.js'
import { wireQueuePage } from './queue-page.js'
import { wireSyncNow } from './repo-actions.js'
import { wireSectionsEditor } from './sections-editor.js'

vi.mock('./pulls-page.js', () => ({ wirePullsPage: vi.fn() }))
vi.mock('./queue-page.js', () => ({ wireQueuePage: vi.fn() }))
vi.mock('./help.js', () => ({ wireHelp: vi.fn() }))
vi.mock('./repo-actions.js', () => ({ wireSyncNow: vi.fn() }))
vi.mock('./sections-editor.js', () => ({ wireSectionsEditor: vi.fn() }))
vi.mock('./branches-editor.js', () => ({ wireBranchesEditor: vi.fn() }))

const shared = [wireHelp, wireSyncNow, wireSectionsEditor, wireBranchesEditor]

beforeEach(() => vi.clearAllMocks())

describe('the home page', () => {
  it('wires nothing without a main that names its table', async () => {
    document.body.innerHTML = '<main></main>'
    await wireHomePage(document)
    for (const wire of [...shared, wirePullsPage, wireQueuePage]) expect(wire).not.toHaveBeenCalled()
  })

  it('wires the shared parts and the table its main names', async () => {
    document.body.innerHTML = '<main data-page="pulls"></main>'
    await wireHomePage(document)
    for (const wire of shared) expect(wire).toHaveBeenCalledWith(document)
    expect(wirePullsPage).toHaveBeenCalledWith(document)
    expect(wireQueuePage).not.toHaveBeenCalled()

    vi.clearAllMocks()
    document.body.innerHTML = '<main data-page="queue"></main>'
    await wireHomePage(document)
    expect(wireQueuePage).toHaveBeenCalledWith(document)
    expect(wirePullsPage).not.toHaveBeenCalled()
  })

  it('wires only the shared parts on a page it has no table for', async () => {
    document.body.innerHTML = '<main data-page="stats"></main>'
    await wireHomePage(document)
    for (const wire of shared) expect(wire).toHaveBeenCalledWith(document)
    expect(wirePullsPage).not.toHaveBeenCalled()
    expect(wireQueuePage).not.toHaveBeenCalled()
  })
})
