// Everything the home page's tables run on, built once per project: the store, the two lists, the
// one-shot agent calls, and Highest priority.
import type { AgentRunner } from '../acpx/acpx.js'
import type { RuntimeConfig } from '../config.js'
import type { HostClient } from '../host/client.js'
import type { Settings } from '../contract/settings.js'
import { repoDir } from '../store/data-dir.js'
import { githubLists } from './github.js'
import { gitlabLists } from './gitlab.js'
import type { GenerationManager } from '../generate/generation-manager.js'
import { createGenerations, type Generations } from './generations.js'
import { createListsManager, type ListsManager } from './lists.js'
import type { CanvasFacts } from './canvas-status.js'
import type { ListFetcher, ListPull } from './model.js'
import { createPriorityManager, type PriorityManager } from './priority.js'
import { githubRequester, gitlabRequester, type ReviewerRequester } from './review-requests.js'
import { createOneShot, type OneShot } from './read-only.js'
import { createListsStore, type ListsStore } from './store.js'

export interface ListsSet {
  store: ListsStore
  manager: ListsManager
  oneShot: OneShot
  priority: PriorityManager
  /** The canvas generations the tables show and stop. */
  generations: Generations
  /** Asks people to review a PR, or stops asking them, on the project's forge. */
  reviewers: ReviewerRequester
}

export function createListsSet(deps: {
  config: RuntimeConfig
  gh: HostClient
  runner: Pick<AgentRunner, 'exec'>
  /** The AI Chat's settings as they apply now, whose agent and timeout the list calls use. */
  chatSettings: () => Promise<Pick<Settings, 'chatAgent' | 'chatTimeoutSec'>>
  /** A PR's canvas status and open points, by the canvas's own lookup. */
  canvasFacts: (pull: ListPull) => Promise<CanvasFacts>
  now: () => Date
  log: (line: string) => void
  /** The canvas generations of the review page, which the queue starts. */
  generation: () => GenerationManager
  /** The forge reads; the host's own when omitted. */
  fetcher?: ListFetcher
  /** The forge's review requests; the host's own when omitted. */
  reviewers?: ReviewerRequester
}): ListsSet {
  const { config } = deps
  const store = createListsStore(repoDir(config.dataDir, config.repo))
  const fetcher =
    deps.fetcher ??
    (config.host.kind === 'github' ? githubLists(deps.gh, config.repo) : gitlabLists(deps.gh, config.repo))
  const oneShot = createOneShot({
    runner: deps.runner,
    dir: `${store.dir}/ai`,
    agent: async () => {
      const s = await deps.chatSettings()
      return { agent: s.chatAgent, timeoutSec: s.chatTimeoutSec }
    },
  })
  const generations = createGenerations(deps.generation)
  const reviewers =
    deps.reviewers ??
    (config.host.kind === 'github'
      ? githubRequester(deps.gh, config.repo)
      : gitlabRequester(deps.gh, config.repo))
  return {
    store,
    generations,
    reviewers,
    manager: createListsManager({
      fetcher,
      store,
      canvasFacts: deps.canvasFacts,
      now: deps.now,
      log: deps.log,
      generation: n => generations.rowState(n),
    }),
    oneShot,
    priority: createPriorityManager({
      oneShot,
      slug: `${config.repo.owner}/${config.repo.name}`,
      repoRoot: config.repoRoot,
      now: deps.now,
      read: () => store.readPriorityResult(),
      write: result => store.writePriorityResult(result),
    }),
  }
}
