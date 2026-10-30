// A table row's canvas status, by the canvas's own rules rather than by commit ids alone. A canvas
// shared for the head commit is ready. Otherwise the canvases generated or imported here decide: a
// PR opened here at its current head goes through the review page's lookup, which reads a canvas
// of an earlier commit with an identical diff as ready (carried over) and the head's own canvas
// against another merge base as stale. A PR not opened at its head has no merge base known here,
// so its own canvas is ready and any other is stale. Shared canvases of other commits alone are
// stale: whether one carries over is known once the PR is opened and the canvas imported.
//
// Its open attention points come from the canvas the status names, when it is here: the points
// still on the reader's list, as the review page counts them (points.js `openPoints`): not
// resolved by the author, not posted or waiting in the pending review, and not dismissed. A canvas
// only shared, never opened here, counts what its comment says is not resolved by the author:
// nothing of it is the reader's yet. Each count is split by whom the point asks: author, reviewer.
import type { ReviewArtifact } from '../contract/review-artifact.js'
import type { PrState } from '../contract/state.js'
import type { AppContext } from '../server/context.js'
import { lookupCanvas } from '../review/carry-over.js'
import type { ListPull } from './model.js'

/** Ready when a canvas stands for the head commit, Stale when only others do, else Pending. */
export type CanvasStatus = 'Ready' | 'Stale' | 'Pending'

/** A canvas's attention points still open: those for the author, and those for the reviewer. */
export interface OpenPoints {
  author: number
  reviewer: number
}

/** What a row says of its canvas: its status, and its open attention points, null with none. */
export interface CanvasFacts {
  status: CanvasStatus
  points: OpenPoints | null
}

/** Two commit ids name the same commit when one starts the other: canvas comments may abbreviate. */
const sameCommit = (a: string, b: string) => a.startsWith(b) || b.startsWith(a)

type Ctx = Pick<AppContext, 'canvases' | 'prs' | 'state'> & Parameters<typeof lookupCanvas>[0]

/** The canvas status, and the commit of the canvas it stands on when one is here. */
export async function canvasOf(
  ctx: Ctx,
  pull: Pick<ListPull, 'number' | 'headSha' | 'canvasShas'>
): Promise<{ status: CanvasStatus; canvasSha: string | null }> {
  const sharedHead = pull.canvasShas.find(sha => pull.headSha !== '' && sameCommit(sha, pull.headSha))
  if (sharedHead !== undefined) return { status: 'Ready', canvasSha: pull.headSha }
  const shared: CanvasStatus = pull.canvasShas.length > 0 ? 'Stale' : 'Pending'
  if (pull.headSha === '') return { status: shared, canvasSha: null }
  try {
    const found = await ctx.canvases.findForPr(pull.number, pull.headSha)
    if (found.status === 'missing') return { status: shared, canvasSha: null }
    const pr = await ctx.prs.readPr(pull.number)
    const lookup =
      pr !== null && pr.headSha === pull.headSha ? await lookupCanvas(ctx, pull.number, pr) : found
    if (lookup.status === 'missing') return { status: shared, canvasSha: null }
    return { status: lookup.status === 'ready' ? 'Ready' : 'Stale', canvasSha: lookup.headSha }
  } catch {
    // The PR has canvases here, but one the lookup cannot read, or a commit this clone lacks,
    // stands for no head.
    return { status: 'Stale', canvasSha: null }
  }
}

export async function canvasStatusOf(
  ctx: Ctx,
  pull: Pick<ListPull, 'number' | 'headSha' | 'canvasShas'>
): Promise<CanvasStatus> {
  return (await canvasOf(ctx, pull)).status
}

/**
 * The points still on the reader's list, as the review page's `openPoints` counts them, split by
 * whom each asks: the author, or the reviewer.
 */
export function openPointsOf(
  artifact: Pick<ReviewArtifact, 'points' | 'settled'>,
  state: PrState
): OpenPoints {
  const settled = artifact.settled ?? {}
  const acted = new Set(
    [...state.posted, ...state.submitted, ...state.pending].flatMap(e =>
      e.pointFingerprint === undefined ? [] : [e.pointFingerprint]
    )
  )
  const open = artifact.points.filter(
    p =>
      settled[p.fingerprint] === undefined &&
      !acted.has(p.fingerprint) &&
      state.dismissed[p.fingerprint] === undefined
  )
  const author = open.filter(p => p.audience === 'author').length
  return { author, reviewer: open.length - author }
}

/**
 * A row's canvas status and open attention points: counted on the canvas when it is here, else
 * as its shared comment says; none without a canvas.
 */
export async function canvasFactsOf(
  ctx: Ctx,
  pull: Pick<ListPull, 'number' | 'headSha' | 'canvasShas' | 'canvasOpen'>
): Promise<CanvasFacts> {
  const { status, canvasSha } = await canvasOf(ctx, pull)
  const shared: CanvasFacts = { status, points: status === 'Pending' ? null : pull.canvasOpen }
  if (canvasSha === null) return shared
  try {
    const artifact = await ctx.canvases.readArtifact(canvasSha)
    if (artifact === null) return shared
    return { status, points: openPointsOf(artifact, await ctx.state.read(pull.number)) }
  } catch {
    return shared
  }
}
