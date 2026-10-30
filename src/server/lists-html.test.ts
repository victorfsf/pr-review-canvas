// The home page tables' markup: each tab's body, and the AI features only where an agent can run;
// and the project tabs every project page carries.
import { type ListsPageData, listsMain, projectTabs } from './lists-html.js'

const render = async (over: Partial<ListsPageData> = {}) =>
  String(
    await listsMain({
      tab: 'pulls',
      owner: 'acme',
      repo: 'widgets',
      base: '/r/acme/widgets/',
      forge: 'GitHub',
      nounShort: 'PR',
      canGenerate: false,
      savedFilters: {},
      ...over,
    })
  )

describe('listsMain', () => {
  it('renders Your PRs with its toolbar, the base branches dialog, and no tab bar', async () => {
    const page = await render({ savedFilters: { pulls: { x: '<&>' } } })
    expect(page).toMatch(/^<main id="main" class="lists" data-page="pulls"/)
    expect(page).toContain('data-agent="false"')
    expect(page).toContain('class="table-tools"')
    expect(page).toContain('id="branches-open"')
    expect(page).toContain('id="sections-open"')
    expect(page).toContain('id="sync-now"')
    expect(page).not.toContain('id="generate-missing"')
    expect(page).toContain('id="pull-table"')
    expect(page).toContain('id="branches-dialog"')
    expect(page).toContain('{"pulls":{"x":"\\u003c\\u0026\\u003e"}}')
    expect(page).not.toContain('project-tabs')
    expect(page).not.toContain('id="builder-chat-toggle"')
    expect(page).toMatch(/<\/main>$/)
  })

  it('renders the Review queue with Highest priority hidden where no agent can run', async () => {
    const page = await render({ tab: 'queue', forge: 'GitLab', nounShort: 'MR' })
    expect(page).toContain('data-page="queue"')
    expect(page).toContain('data-forge="GitLab"')
    expect(page).toContain('id="queue-table"')
    expect(page).not.toContain('id="pull-table"')
    expect(page).toMatch(/id="queue-priority"[^>]*hidden/)
    expect(page).not.toContain('id="generate-missing"')
  })

  it('offers Ask AI and Highest priority where an agent can run, and never Generate missing', async () => {
    const queue = await render({ tab: 'queue', canGenerate: true })
    expect(queue).toContain('data-agent="true"')
    expect(queue).not.toContain('id="generate-missing"')
    // The Pending column and its legend are gone.
    expect(queue).not.toContain('pending-help')
    expect(queue).toContain('id="builder-chat-toggle"')
    expect(queue).not.toMatch(/id="queue-priority"[^>]*hidden/)
    const pulls = await render({ canGenerate: true })
    expect(pulls).toContain('id="builder-chat-toggle"')
    expect(pulls).not.toContain('id="generate-missing"')
    expect(pulls).not.toContain('pending-help')
  })
})

describe('projectTabs', () => {
  const tabs = async (tab: 'home' | 'pulls' | 'queue', nounShort = 'PR') =>
    String(await projectTabs({ base: '/r/acme/widgets/', nounShort, tab }))

  it('links Home, Your PRs and the Review queue, the current one marked', async () => {
    const home = await tabs('home')
    expect(home).toContain('<nav class="project-tabs" aria-label="Project pages">')
    expect(home).toContain('<a class="project-tab on" href="/r/acme/widgets/" aria-current="page">Home</a>')
    expect(home).toContain(
      '<a class="project-tab" href="/r/acme/widgets/pulls">Your PRs <span class="count-badge" id="nav-pull-count"></span></a>'
    )
    expect(home).toContain(
      '<a class="project-tab" href="/r/acme/widgets/queue">Review queue <span class="count-badge" id="nav-queue-count"></span></a>'
    )
    expect(home.match(/aria-current/g)).toHaveLength(1)
  })

  it('marks the tables’ tabs, and names MRs on GitLab', async () => {
    expect(await tabs('pulls', 'MR')).toMatch(
      /<a class="project-tab on" href="\/r\/acme\/widgets\/pulls" aria-current="page">Your MRs /
    )
    const queue = await tabs('queue')
    expect(queue).toMatch(
      /<a class="project-tab on" href="\/r\/acme\/widgets\/queue" aria-current="page">Review queue /
    )
    expect(queue).toContain('<a class="project-tab" href="/r/acme/widgets/">Home</a>')
  })
})
