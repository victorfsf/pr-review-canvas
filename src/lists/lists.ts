// The home page's two lists, kept fresh: each answers from its last fetch at once, and a fetch
// older than `STALE_MS` is read again behind it, one at a time per list; only a list never fetched
// is waited for. Rows go out with what the tables draw from them: health, canvas status, pending
// counts, and each stacked PR's place in its stack.
import { DEFAULT_BRANCHES } from '../../static/js/lists/branches.js'
import type { Health } from '../../static/js/lists/health.js'
import type { CanvasFacts, CanvasStatus, OpenPoints } from './canvas-status.js'
import { anyChecks, healthOf } from './ci.js'
import type { RowGeneration } from './generations.js'
import type { ListFetcher, ListKind, ListPull, ListSnapshot } from './model.js'
import { type StackPosition, stackPositions, stacksOf } from './stacks.js'
import type { ListSettings, ListsStore } from './store.js'

/** How old a fetch may be before a page load reads the list again. */
export const STALE_MS = 2 * 60 * 1000

/** How old the project's people may be before a list's read reads them again. */
export const PEOPLE_STALE_MS = 60 * 60 * 1000

export type { CanvasStatus }

/** One table row: the PR as fetched, with what its cells show; internal facts left out. */
export interface ListRow extends Omit<
  ListPull,
  'headSha' | 'checks' | 'headCommittedAt' | 'mergeable' | 'canvasShas' | 'canvasOpen'
> {
  health: Health
  canvas: CanvasStatus
  /** Its canvas's attention points still open, for the author and for the reviewer; absent with no canvas. */
  points?: OpenPoints
  stack?: StackPosition
  /** Its canvas generation: running, or why its last one failed; absent for none. */
  generation?: RowGeneration
}

export interface ListState {
  fetchedAt: string | null
  error: string | null
  syncing: boolean
}

export interface ListView {
  rows: ListRow[]
  viewer: string
  state: ListState
  sections: ListSettings['sections']
  branches: NonNullable<ListSettings['branches']>
  /** Both tabs' counts as last fetched: your PRs, and the queue's PRs that are not drafts. */
  counts: { pulls: number; queue: number }
  /** The project's people, by login, that the Authors and Reviewers pickers offer. */
  people: string[]
}

/**
 * The rows of one list as its table shows them. On your own PRs, failing or stuck CI and a
 * conflict wait on you too, so they join the Pending count.
 */
export function rowsOf(
  kind: ListKind,
  pulls: readonly ListPull[],
  opts: {
    now: string
    /** Each PR's canvas status and open points, by number (canvas-status.ts); Pending when absent. */
    canvas: ReadonlyMap<number, CanvasFacts>
    branches: readonly string[]
    repoHasChecks: boolean
    generation?: (number: number) => RowGeneration | undefined
  }
): ListRow[] {
  const positions = stackPositions(stacksOf(pulls, opts.branches))
  return pulls.map(pull => {
    const {
      headSha: _sha,
      checks: _checks,
      headCommittedAt: _at,
      mergeable: _merge,
      canvasShas: _canvas,
      canvasOpen: _open,
      ...row
    } = pull
    const health = healthOf(pull, opts.now, opts.repoHasChecks)
    const stack = positions.get(pull.number)
    const generation = opts.generation?.(pull.number)
    const facts = opts.canvas.get(pull.number)
    const work =
      kind === 'pulls'
        ? (health.ci === 'failing' ? 1 : 0) + (health.stuck === null ? 0 : 1) + (health.conflict ? 1 : 0)
        : 0
    return {
      ...row,
      pending: row.pending + work,
      health,
      canvas: facts?.status ?? 'Pending',
      ...(facts === undefined || facts.points === null ? {} : { points: facts.points }),
      ...(stack === undefined ? {} : { stack }),
      ...(generation === undefined ? {} : { generation }),
    }
  })
}

export interface ListsManager {
  /** The list as last fetched, read again behind the answer when stale; waited for when never read. */
  view(kind: ListKind): Promise<ListView>
  /** Reads the list again now and waits for it; a read already running is joined. */
  sync(kind: ListKind): Promise<void>
  /**
   * Reads one PR again now and puts it in the list in place, or takes it out when it is no longer
   * open on that side; the rest of the list stays as last read.
   */
  syncOne(kind: ListKind, number: number): Promise<void>
  /** The open PRs the last fetch kept, on both sides: the sections editor's labels and preview. */
  all(): Promise<ListPull[]>
  /** The base branches as the tables use them: the saved ones, else `main`. */
  branches(): Promise<ListView['branches']>
}

/** The saved base branches, else `main` alone. */
export function effectiveBranches(saved: ListSettings['branches']): ListView['branches'] {
  return saved ?? [...DEFAULT_BRANCHES]
}

export function createListsManager(deps: {
  fetcher: ListFetcher
  store: ListsStore
  /** A PR's canvas status and open points, by the canvas's own lookup (canvas-status.ts). */
  canvasFacts: (pull: ListPull) => Promise<CanvasFacts>
  now: () => Date
  log: (line: string) => void
  /** Where each PR's canvas generation from the tables stands. */
  generation?: (number: number) => RowGeneration | undefined
  /** Hears each list a fetch changed, for the pages listening. */
  changed?: (kind: ListKind) => void
}): ListsManager {
  const running = new Map<ListKind, Promise<void>>()
  const errors = new Map<ListKind, string>()

  /**
   * Reads the project's people again when the last read is older than `PEOPLE_STALE_MS`. A
   * failure keeps the last read and is only logged: the pickers still offer the PRs' people.
   * Two reads close together may both ask the forge; each writes the whole list, so either stands.
   */
  const readPeople = async (): Promise<void> => {
    try {
      const last = await deps.store.readPeople()
      if (last !== null && deps.now().getTime() - Date.parse(last.fetchedAt) <= PEOPLE_STALE_MS) return
      const logins = await deps.fetcher.fetchPeople()
      await deps.store.writePeople({
        fetchedAt: deps.now().toISOString(),
        logins: [...new Set(logins)].sort(),
      })
    } catch (err) {
      deps.log(`could not read the project's people: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const fetchNow = (kind: ListKind): Promise<void> => {
    const already = running.get(kind)
    if (already !== undefined) return already
    const run = (async () => {
      try {
        const fetched = await deps.fetcher.fetch(kind)
        await deps.store.writeSnapshot(kind, { ...fetched, fetchedAt: deps.now().toISOString() })
        errors.delete(kind)
        // The project's people follow in the background: the list does not wait for them.
        void readPeople()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.set(kind, message)
        deps.log(`could not read the ${kind === 'pulls' ? 'Your PRs' : 'Review queue'} list: ${message}`)
      } finally {
        running.delete(kind)
        deps.changed?.(kind)
      }
    })()
    running.set(kind, run)
    return run
  }

  const view = async (kind: ListKind): Promise<ListView> => {
    let snapshot: ListSnapshot | null = await deps.store.readSnapshot(kind)
    if (snapshot === null) {
      await fetchNow(kind)
      snapshot = await deps.store.readSnapshot(kind)
    } else if (deps.now().getTime() - Date.parse(snapshot.fetchedAt) > STALE_MS) {
      void fetchNow(kind)
    }
    const pulls = snapshot?.pulls ?? []
    const [settings, statuses] = await Promise.all([
      deps.store.readSettings(),
      Promise.all(pulls.map(async p => [p.number, await deps.canvasFacts(p)] as const)),
    ])
    // Until base branches are saved, `main` is the one base.
    const branches = effectiveBranches(settings.branches)
    const other = await deps.store.readSnapshot(kind === 'pulls' ? 'queue' : 'pulls')
    return {
      rows: rowsOf(kind, pulls, {
        now: deps.now().toISOString(),
        canvas: new Map(statuses),
        branches: branches.map(b => b.name),
        // A repo with checks on any open PR runs CI, so one whose checks never started is stuck.
        repoHasChecks: anyChecks(pulls) || anyChecks(other?.pulls ?? []),
        ...(deps.generation === undefined ? {} : { generation: deps.generation }),
      }),
      viewer: snapshot?.viewer ?? '',
      state: {
        fetchedAt: snapshot?.fetchedAt ?? null,
        error: errors.get(kind) ?? null,
        syncing: running.has(kind),
      },
      sections: settings.sections,
      branches,
      people: (await deps.store.readPeople())?.logins ?? [],
      counts: {
        pulls: (kind === 'pulls' ? pulls : (other?.pulls ?? [])).length,
        queue: (kind === 'queue' ? pulls : (other?.pulls ?? [])).filter(p => !p.isDraft).length,
      },
    }
  }

  const syncOne = async (kind: ListKind, number: number): Promise<void> => {
    // A full read under way lands first, so one PR is put in the list it wrote, not under it.
    await running.get(kind)
    // A list never read is read whole: one PR alone would make it look read.
    if ((await deps.store.readSnapshot(kind)) === null) return fetchNow(kind)
    const { pull } = await deps.fetcher.fetchOne(kind, number)
    await running.get(kind)
    const snapshot = await deps.store.readSnapshot(kind)
    if (snapshot === null) return fetchNow(kind)
    const at = snapshot.pulls.findIndex(p => p.number === number)
    const pulls =
      pull === null
        ? snapshot.pulls.filter(p => p.number !== number)
        : at === -1
          ? [...snapshot.pulls, pull]
          : snapshot.pulls.map(p => (p.number === number ? pull : p))
    await deps.store.writeSnapshot(kind, { ...snapshot, pulls })
    deps.changed?.(kind)
  }

  return {
    view,
    sync: fetchNow,
    syncOne,
    all: async () => {
      const [pulls, queue] = await Promise.all([
        deps.store.readSnapshot('pulls'),
        deps.store.readSnapshot('queue'),
      ])
      return [...(pulls?.pulls ?? []), ...(queue?.pulls ?? [])]
    },
    branches: async () => effectiveBranches((await deps.store.readSettings()).branches),
  }
}
