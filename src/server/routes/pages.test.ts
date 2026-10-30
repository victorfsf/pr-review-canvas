// @vitest-environment node
// The project's three tabs: its Home at the root, Your PRs at `pulls` and the Review queue at
// `queue`. The two tables arrive with the filters the pages saved; Home loads no table script.
import { makeTestContext, type TestContext } from '../../testing/fakes.js'
import { createApp } from '../app.js'

const LOCAL = { host: 'localhost:3010' }
const LISTS_SCRIPT = '/static/js/lists/home-page.js'

let t: TestContext

afterEach(async () => {
  await t.cleanup()
})

const savedFiltersOf = (html: string) =>
  JSON.parse(/<script type="application\/json" id="saved-filters">(.*?)<\/script>/s.exec(html)?.[1] ?? 'null')

/** The tab the page marks as current, by its label. */
const currentTab = (html: string) =>
  /<a class="project-tab on" href="[^"]*" aria-current="page">([^<]*)/.exec(html)?.[1]?.trim()

describe('project tabs', () => {
  it('renders Home at the root with the tabs and the open-by-number form, and no table', async () => {
    t = await makeTestContext()
    const res = await createApp(t.ctx).request('/', { headers: LOCAL })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('<nav class="project-tabs"')
    expect(currentTab(html)).toBe('Home')
    expect(html).toContain('id="nav-pull-count"')
    expect(html).toContain('id="nav-queue-count"')
    expect(html).toContain('<main id="main" class="home">')
    expect(html).toMatch(/<form class="body home-form" method="get" action="[^"]*review">/)
    expect(html).toContain('Before the pull request')
    expect(html).toContain('<h2>Recent</h2>')
    expect(html).not.toContain(LISTS_SCRIPT)
    expect(html).not.toContain('class="lists"')
    expect(html).not.toContain('id="saved-filters"')
    expect(html).toContain('<title>PR review canvas</title>')
  })

  it('lists recent PRs on Home, saying which have no canvas yet', async () => {
    t = await makeTestContext()
    vi.spyOn(t.ctx.prs, 'listRecent').mockResolvedValue([
      { number: 42, title: 'Add widgets', updatedAt: '2026-10-22T12:00:00.000Z' },
      { number: 7, title: 'Fix gears', updatedAt: '2026-10-21T12:00:00.000Z' },
    ])
    vi.spyOn(t.ctx.canvases, 'readIndex').mockResolvedValue({
      canvases: {
        ['a'.repeat(40)]: { generatedAt: '2026-10-22T12:00:00.000Z', source: 'local', prNumber: 42 },
      },
    })
    const html = await (await createApp(t.ctx).request('/', { headers: LOCAL })).text()
    expect(html).toContain('<span class="mono num">#42</span> Add widgets</a></li>')
    expect(html).toContain(
      '<span class="mono num">#7</span> Fix gears</a> <span class="muted">no canvas yet</span>'
    )
  })

  it('renders Your PRs and the Review queue, each with its data-page, tab and the saved filters', async () => {
    t = await makeTestContext()
    const filters = { pulls: { state: ['open'] }, searches: ['</script><b>'] }
    await t.ctx.lists.store.writeFilters('pulls', filters.pulls)
    await t.ctx.lists.store.writeFilters('searches', filters.searches)
    const app = createApp(t.ctx)

    const pulls = await app.request('/pulls', { headers: LOCAL })
    expect(pulls.status).toBe(200)
    const pullsHtml = await pulls.text()
    expect(currentTab(pullsHtml)).toBe('Your PRs')
    expect(pullsHtml).toContain('data-page="pulls"')
    expect(pullsHtml).toContain('id="pull-table"')
    expect(pullsHtml).toContain('id="branches-open"')
    expect(pullsHtml).toContain('id="branches-dialog"')
    expect(pullsHtml).toContain(LISTS_SCRIPT)
    expect(pullsHtml).not.toContain('home-form')
    expect(pullsHtml).not.toContain('</script><b>')
    expect(savedFiltersOf(pullsHtml)).toEqual(filters)
    expect(pullsHtml).toContain('<title>Your PRs · acme/widgets · review canvas</title>')

    const queue = await app.request('/queue', { headers: LOCAL })
    expect(queue.status).toBe(200)
    const queueHtml = await queue.text()
    expect(currentTab(queueHtml)).toBe('Review queue')
    expect(queueHtml).toContain('data-page="queue"')
    expect(queueHtml).toContain('id="queue-stacked"')
    expect(queueHtml).toContain(LISTS_SCRIPT)
    expect(savedFiltersOf(queueHtml)).toEqual(filters)
    expect(queueHtml).toContain('<title>Review queue · acme/widgets · review canvas</title>')
  })

  it('says an agent can run on the tables, with no Generate missing over them', async () => {
    t = await makeTestContext()
    const html = await (await createApp(t.ctx).request('/pulls', { headers: LOCAL })).text()
    expect(html).not.toContain('id="generate-missing"')
    expect(html).toContain('data-agent="true"')
  })

  it('arrives with no saved filters as an empty object', async () => {
    t = await makeTestContext()
    const html = await (await createApp(t.ctx).request('/queue', { headers: LOCAL })).text()
    expect(savedFiltersOf(html)).toEqual({})
  })
})
