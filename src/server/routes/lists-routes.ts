// The home page's tables: Your PRs and the Review queue, their sections and base branches, the
// filters they save, Highest priority, and the builder's Ask AI. Every write comes from the page
// itself; the same-origin check keeps other sites out.
import { Hono } from 'hono'
import { z } from 'zod'
import { resolveSharing } from '../../contract/settings.js'
import { BuilderAskSchema, askBuilder } from '../../lists/builder-ai.js'
import { canvasOf } from '../../lists/canvas-status.js'
import { buildSkillCommand } from '../../review/skill-command.js'
import { LOGIN, reviewerPeople, reviewRequestsOf } from '../../lists/review-requests.js'
import { LIST_KINDS, type ListKind } from '../../lists/model.js'
import { priorityView } from '../../lists/priority.js'
import {
  FILTER_PAGES,
  MainBranchesSchema,
  MAX_FILTER_BYTES,
  PrioritySchema,
  SectionsSchema,
} from '../../lists/store.js'
import type { AppContext } from '../context.js'
import type { AppEnv } from '../env.js'
import { AppError } from '../errors.js'
import { readBody } from './review-routes.js'

function kindOf(raw: string): ListKind {
  const kind = LIST_KINDS.find(k => k === raw)
  if (kind === undefined) throw new AppError('NOT_FOUND', `no list named ${raw}`, 404, 'use pulls or queue')
  return kind
}

export function listsRoutes(ctx: AppContext): Hono<AppEnv> {
  const api = new Hono<AppEnv>()
  const { store, manager, priority } = ctx.lists
  const slug = `${ctx.config.repo.owner}/${ctx.config.repo.name}`

  const priorityNow = async () =>
    priorityView(
      (await store.readSettings()).priority,
      await store.readPriorityResult(),
      priority.startedAt()
    )

  /** One list as its table draws it; the queue's comes with Highest priority. */
  api.get('/lists/:kind', async c => {
    const kind = kindOf(c.req.param('kind'))
    const view = await manager.view(kind)
    return c.json(kind === 'queue' ? { ...view, priority: await priorityNow() } : view)
  })

  /** Reads one list from the forge again now, and answers once it is in. */
  api.post('/lists/:kind/sync', async c => {
    const kind = kindOf(c.req.param('kind'))
    await manager.sync(kind)
    return c.json(await manager.view(kind))
  })

  /** Reads one PR from the forge again now, and answers with its list once it is in. */
  api.post('/lists/:kind/:n/sync', async c => {
    const kind = kindOf(c.req.param('kind'))
    const n = Number(c.req.param('n'))
    if (!Number.isInteger(n) || n <= 0) throw new AppError('BAD_REQUEST', 'not a pull request number', 400)
    await manager.syncOne(kind, n)
    return c.json(await manager.view(kind))
  })

  /** The PR of a list, as last read; 404 when the list does not hold it. */
  const pullIn = async (kind: ListKind, raw: string) => {
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) throw new AppError('BAD_REQUEST', 'not a pull request number', 400)
    const pull = (await store.readSnapshot(kind))?.pulls.find(p => p.number === n)
    if (pull === undefined) throw new AppError('NOT_FOUND', `#${n} is not in the list`, 404, 'sync the list')
    return pull
  }

  /** Who the PR asks to review it, and whose it is: anyone's PR in the list. */
  api.get('/lists/:kind/:n/reviewers', async c => {
    const pull = await pullIn(kindOf(c.req.param('kind')), c.req.param('n'))
    return c.json(reviewRequestsOf(pull))
  })

  /** Who can be asked to review the PR for `q`: the project's people, those on the PR first. */
  api.get('/lists/:kind/:n/reviewers/people', async c => {
    const pull = await pullIn(kindOf(c.req.param('kind')), c.req.param('n'))
    const q = z
      .string()
      .max(60)
      .safeParse(c.req.query('q') ?? '')
    if (!q.success) throw new AppError('BAD_REQUEST', 'q must be the start of a login', 400)
    return c.json(reviewerPeople(pull, (await store.readPeople())?.logins ?? [], q.data))
  })

  /**
   * Asks people to review the PR on the forge (`add`), and stops asking others (`remove`), then
   * reads the PR again; answers who it asks now, as the forge said.
   */
  api.post('/lists/:kind/:n/reviewers', async c => {
    const kind = kindOf(c.req.param('kind'))
    const pull = await pullIn(kind, c.req.param('n'))
    const change = await readBody(
      c.req.raw,
      z.object({
        add: z.array(z.string().regex(LOGIN)).max(15).default([]),
        remove: z.array(z.string().regex(LOGIN)).max(15).default([]),
      }),
      '{ "add": ["alice"], "remove": ["bob"] }'
    )
    if (change.add.some(login => login.toLowerCase() === pull.author.toLowerCase())) {
      throw new AppError('BAD_REQUEST', 'a PR’s author cannot be asked to review it', 400)
    }
    let requested = pull.requestedReviewers
    try {
      if (change.remove.length > 0)
        requested = await ctx.lists.reviewers.request(pull.number, change.remove, false)
      if (change.add.length > 0) requested = await ctx.lists.reviewers.request(pull.number, change.add, true)
    } finally {
      // The row follows what the forge has now, a half-done change too (a remove that went
      // through before an add was refused); a failed read leaves it until the next one.
      if (change.add.length + change.remove.length > 0) {
        await manager
          .syncOne(kind, pull.number)
          .catch(err => ctx.log(`could not read #${pull.number} again: ${String(err)}`))
      }
    }
    return c.json({ author: pull.author, requested })
  })

  /** The sections editor's data: the sections, and the open PRs' labels for suggestions and the preview. */
  api.get('/lists-sections', async c => {
    const pulls = (await manager.all()).map(p => ({ number: p.number, title: p.title, labels: p.labels }))
    return c.json({ sections: (await store.readSettings()).sections, pulls })
  })

  api.put('/lists-sections', async c => {
    const { sections } = await readBody(
      c.req.raw,
      z.object({ sections: SectionsSchema }),
      '{ "sections": [{ "name": "Backend", "labels": ["api"] }, { "name": "Other", "labels": [] }] }'
    )
    return c.json({ sections: (await store.writeSettings({ sections })).sections })
  })

  /** The base branches the tables use: the saved ones, else `main`. */
  api.get('/lists-branches', async c => c.json({ branches: await manager.branches() }))

  api.put('/lists-branches', async c => {
    const { branches } = await readBody(
      c.req.raw,
      z.object({ branches: MainBranchesSchema.nullable() }),
      '{ "branches": [{ "name": "main", "color": "green" }] }'
    )
    return c.json({ branches: (await store.writeSettings({ branches })).branches })
  })

  /** Saves Highest priority's prompts, the one in use, and count; `null` goes back to the defaults. */
  api.put('/lists-priority', async c => {
    const body = await readBody(
      c.req.raw,
      z.object({ priority: PrioritySchema.nullable() }),
      '{ "priority": { "prompts": [{ "name": "Default", "prompt": "…" }], "active": "Default", "count": 3 } }'
    )
    await store.writeSettings({ priority: body.priority })
    return c.json(await priorityNow())
  })

  /** Asks the agent for Highest priority's picks now, by the queue as it is, and answers with them. */
  api.post('/lists-priority/sync', async c => {
    const [view, settings] = await Promise.all([manager.view('queue'), store.readSettings()])
    await priority.sync(view.rows, settings.priority)
    return c.json(await priorityNow())
  })

  /** The filter builder's Ask AI: the agent's blocks for what the developer described. */
  api.post('/lists-builder/ask', async c => {
    const ask = await readBody(
      c.req.raw,
      BuilderAskSchema,
      '{ "page", "messages", "fields", "current" }: messages of yours and the AI’s, yours last'
    )
    return c.json(await askBuilder(ctx.lists.oneShot, slug, ask))
  })

  /**
   * What the review page's generate dialog needs of a PR in the tables: its canvas status (missing,
   * stale, or ready and maybe carried over), the agent, whether publishing shares the canvas, and
   * the skill command for running it by hand. Read from the lists and the canvas store, not from
   * the forge, so the dialog opens at once.
   */
  api.get('/lists-generate/:n/dialog', async c => {
    const n = Number(c.req.param('n'))
    if (!Number.isInteger(n) || n <= 0) throw new AppError('BAD_REQUEST', 'not a pull request number', 400)
    const pull = (await manager.all()).find(p => p.number === n)
    if (pull === undefined) throw new AppError('NOT_FOUND', `#${n} is not in the lists`, 404, 'sync the list')
    const chatEnabled = ctx.projectConfig.config.chat.enabled
    const [{ status, canvasSha }, settings, acpx, personal] = await Promise.all([
      canvasOf(ctx, pull),
      chatEnabled ? ctx.chat.effectiveSettings() : Promise.resolve(null),
      chatEnabled ? ctx.preflight.get() : Promise.resolve({ installed: false }),
      ctx.settings.read(),
    ])
    const carried = status === 'Ready' && canvasSha !== null && canvasSha !== pull.headSha
    return c.json({
      local: false,
      status: status === 'Ready' ? 'ready' : status === 'Stale' ? 'stale' : 'missing',
      ...(carried ? { carriedOver: { canvasHeadSha: canvasSha, currentHeadSha: pull.headSha } } : {}),
      skillCommand: buildSkillCommand(n, { force: canvasSha === pull.headSha }),
      chat: {
        enabled: chatEnabled && acpx.installed,
        acpx: acpx.installed,
        ...(settings === null ? {} : { agent: settings.chatAgent, model: settings.chatModel }),
      },
      canvasComment: resolveSharing(ctx.projectConfig.config.sharing, personal).canvasComment,
    })
  })

  /** Stops a PR's canvas generation, started from its row's dialog or the review page. */
  api.delete('/lists-generate/:n', async c => {
    const n = Number(c.req.param('n'))
    if (!Number.isInteger(n) || n <= 0) throw new AppError('BAD_REQUEST', 'not a pull request number', 400)
    return c.json({ stopped: await ctx.lists.generations.stop(n) })
  })

  /** Saves one page's filters, or the author searches; `null` forgets them. */
  api.put('/lists-filters/:page', async c => {
    const page = FILTER_PAGES.find(p => p === c.req.param('page'))
    if (page === undefined) throw new AppError('NOT_FOUND', `no filters named ${c.req.param('page')}`, 404)
    const { value } = await readBody(
      c.req.raw,
      z.object({ value: z.union([z.null(), z.array(z.unknown()), z.record(z.string(), z.unknown())]) }),
      '{ "value": { … } }: an object, a list or null'
    )
    if (JSON.stringify(value).length > MAX_FILTER_BYTES) {
      throw new AppError('BAD_REQUEST', `saved filters are at most ${MAX_FILTER_BYTES} bytes`, 400)
    }
    await store.writeFilters(page, value)
    return c.json({ ok: true })
  })

  return api
}
