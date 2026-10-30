// @vitest-environment node
// A table row's canvas status by the canvas's own lookup: a canvas shared for the head is ready;
// otherwise the canvases kept here decide, through the review page's carry-over rule when the PR
// was opened at its head, else by the store's lookup alone.
import type { Pr } from '../contract/review-artifact.js'
import { createFakeGit, type FakeGitOptions, makeTestContext, type TestContext } from '../testing/fakes.js'
import {
  BASE_SHA,
  HEAD_SHA,
  SYNTHETIC_BLOBS,
  SYNTHETIC_DIFF,
  SYNTHETIC_DIFF_MOVED_BY_BASE,
  syntheticArtifact,
} from '../testing/synthetic.js'
import { emptyState, type PrState } from '../contract/state.js'
import type { PendingComment } from '../contract/pending.js'
import { canvasFactsOf, canvasOf, canvasStatusOf, openPointsOf } from './canvas-status.js'

/** An earlier commit of the PR; the head is three commits after it. */
const OLD = 'e'.repeat(40)
const PR: Pr = { ...syntheticArtifact().pr, number: 42, headSha: HEAD_SHA }

/** OLD changed SYNTHETIC_DIFF; the head's diff is `headDiff`. Both commits are in the clone. */
function history(headDiff: string): FakeGitOptions {
  return {
    refs: { head: HEAD_SHA, old: OLD, base: BASE_SHA },
    ancestors: { [`${OLD}..${HEAD_SHA}`]: true },
    counts: { [`${OLD}..${HEAD_SHA}`]: 3 },
    diffs: { [`${BASE_SHA}..${OLD}`]: SYNTHETIC_DIFF, [`${BASE_SHA}..${HEAD_SHA}`]: headDiff },
    blobs: SYNTHETIC_BLOBS,
  }
}

function manifestOf(headSha: string) {
  return {
    formatVersion: 1 as const,
    tool: { name: 'pr-review', version: '0.1.0' },
    repo: PR.repo,
    prNumber: 42,
    headSha,
    mergeBaseSha: BASE_SHA,
    baseRef: 'main',
    headRef: 'feat/b',
    generatedAt: '2026-09-10T11:00:00.000Z',
    generator: { agent: 'claude', harness: 'claude-code' as const, attempts: 1 },
  }
}

let t: TestContext
afterEach(() => t?.cleanup())

async function context(headDiff = SYNTHETIC_DIFF): Promise<TestContext> {
  t = await makeTestContext({ git: createFakeGit(history(headDiff)) })
  return t
}

/** Keeps a canvas of `headSha` for PR #42 here, as a generation or an import would. */
const keepCanvas = (headSha: string) =>
  t.ctx.canvases.write(headSha, syntheticArtifact(), manifestOf(headSha), 42)

const pull = (
  over: {
    headSha?: string
    canvasShas?: string[]
    canvasOpen?: { author: number; reviewer: number } | null
  } = {}
) => ({
  number: 42,
  headSha: HEAD_SHA,
  canvasShas: [] as string[],
  canvasOpen: null,
  ...over,
})

describe('canvasStatusOf', () => {
  it('is Ready for a canvas shared for the head, abbreviated or not, without asking the store', async () => {
    await context()
    const findForPr = vi.spyOn(t.ctx.canvases, 'findForPr')
    expect(await canvasStatusOf(t.ctx, pull({ canvasShas: [OLD, HEAD_SHA] }))).toBe('Ready')
    expect(await canvasStatusOf(t.ctx, pull({ canvasShas: [HEAD_SHA.slice(0, 7)] }))).toBe('Ready')
    expect(findForPr).not.toHaveBeenCalled()
  })

  it('is Pending with no canvas anywhere, and Stale with only a shared canvas of another commit', async () => {
    await context()
    expect(await canvasStatusOf(t.ctx, pull())).toBe('Pending')
    expect(await canvasStatusOf(t.ctx, pull({ canvasShas: [OLD.slice(0, 7)] }))).toBe('Stale')
  })

  it('reads the shared canvases alone for a PR whose head is unknown', async () => {
    await context()
    await keepCanvas(OLD)
    const findForPr = vi.spyOn(t.ctx.canvases, 'findForPr')
    expect(await canvasStatusOf(t.ctx, pull({ headSha: '' }))).toBe('Pending')
    expect(await canvasStatusOf(t.ctx, pull({ headSha: '', canvasShas: [OLD] }))).toBe('Stale')
    expect(findForPr).not.toHaveBeenCalled()
  })

  it('without the PR opened here, is Ready for the head’s own canvas and Stale for an older one', async () => {
    await context()
    await keepCanvas(OLD)
    // The older canvas has the identical diff, but no merge base is known here to say so.
    expect(await canvasStatusOf(t.ctx, pull())).toBe('Stale')
    await keepCanvas(HEAD_SHA)
    expect(await canvasStatusOf(t.ctx, pull())).toBe('Ready')
  })

  it('with the PR opened at its head, is Ready for a canvas carried over by an identical diff', async () => {
    await context(SYNTHETIC_DIFF)
    await t.ctx.prs.writePr(42, PR)
    await keepCanvas(OLD)
    expect(await canvasStatusOf(t.ctx, pull())).toBe('Ready')
  })

  it('with the PR opened at its head, is Stale for an older canvas whose diff differs', async () => {
    await context(SYNTHETIC_DIFF_MOVED_BY_BASE)
    await t.ctx.prs.writePr(42, PR)
    await keepCanvas(OLD)
    expect(await canvasStatusOf(t.ctx, pull())).toBe('Stale')
  })

  it('with the PR opened at another head, falls back to the store’s lookup', async () => {
    await context(SYNTHETIC_DIFF)
    // Opened at OLD, whose canvas would carry over to the head were the head the one opened.
    await t.ctx.prs.writePr(42, { ...PR, headSha: OLD })
    await keepCanvas(OLD)
    expect(await canvasStatusOf(t.ctx, pull())).toBe('Stale')
    await keepCanvas(HEAD_SHA)
    expect(await canvasStatusOf(t.ctx, pull())).toBe('Ready')
  })

  it('is Stale when the lookup throws', async () => {
    await context()
    vi.spyOn(t.ctx.canvases, 'findForPr').mockRejectedValue(new Error('index unreadable'))
    expect(await canvasStatusOf(t.ctx, pull())).toBe('Stale')
  })
})

describe('canvasOf', () => {
  it('names the head as the canvas a shared head canvas stands on', async () => {
    await context()
    expect(await canvasOf(t.ctx, pull({ canvasShas: [HEAD_SHA.slice(0, 7)] }))).toEqual({
      status: 'Ready',
      canvasSha: HEAD_SHA,
    })
  })

  it('names no canvas where none is here, or where only shared ones are', async () => {
    await context()
    expect(await canvasOf(t.ctx, pull())).toEqual({ status: 'Pending', canvasSha: null })
    expect(await canvasOf(t.ctx, pull({ canvasShas: [OLD] }))).toEqual({ status: 'Stale', canvasSha: null })
    expect(await canvasOf(t.ctx, pull({ headSha: '', canvasShas: [OLD] }))).toEqual({
      status: 'Stale',
      canvasSha: null,
    })
  })

  it('names the canvas the store or the carry-over lookup found', async () => {
    await context(SYNTHETIC_DIFF)
    await keepCanvas(OLD)
    expect(await canvasOf(t.ctx, pull())).toEqual({ status: 'Stale', canvasSha: OLD })
    // Opened at its head, the older canvas carries over and stands for it.
    await t.ctx.prs.writePr(42, PR)
    expect(await canvasOf(t.ctx, pull())).toEqual({ status: 'Ready', canvasSha: OLD })
  })

  it('reads the shared canvases when the carry-over lookup finds none the store did', async () => {
    await context()
    await t.ctx.prs.writePr(42, PR)
    await keepCanvas(OLD)
    vi.spyOn(t.ctx.canvases, 'findForPr')
      .mockResolvedValueOnce({ status: 'stale', headSha: OLD } as never)
      .mockResolvedValue({ status: 'missing' } as never)
    expect(await canvasOf(t.ctx, pull({ canvasShas: [OLD] }))).toEqual({ status: 'Stale', canvasSha: null })
  })

  it('names no canvas when the lookup throws', async () => {
    await context()
    vi.spyOn(t.ctx.canvases, 'findForPr').mockRejectedValue(new Error('index unreadable'))
    expect(await canvasOf(t.ctx, pull())).toEqual({ status: 'Stale', canvasSha: null })
  })
})

describe('openPointsOf', () => {
  const artifact = {
    points: [
      { fingerprint: 'p1', audience: 'reviewer' },
      { fingerprint: 'p2', audience: 'reviewer' },
      { fingerprint: 'p3', audience: 'author' },
      { fingerprint: 'p4', audience: 'author' },
      { fingerprint: 'p5', audience: 'reviewer' },
    ],
  } as Parameters<typeof openPointsOf>[0]
  const comment = (pointFingerprint?: string): PendingComment => ({
    id: `c-${pointFingerprint ?? 'none'}`,
    path: 'src/a.ts',
    line: 1,
    side: 'new',
    body: 'Synthetic note',
    headSha: HEAD_SHA,
    createdAt: 'x',
    updatedAt: 'x',
    ...(pointFingerprint === undefined ? {} : { pointFingerprint }),
  })

  it('counts every point with nothing done to it, split by whom it asks', () => {
    expect(openPointsOf(artifact, emptyState('x'))).toEqual({ author: 2, reviewer: 3 })
    expect(openPointsOf({ points: [] }, emptyState('x'))).toEqual({ author: 0, reviewer: 0 })
  })

  it('leaves out the settled, posted, submitted, pending and dismissed points', () => {
    const state: PrState = {
      ...emptyState('x'),
      posted: [
        { commentId: 1, pointFingerprint: 'p1', at: 'x' },
        // A comment from no point counts for none.
        { commentId: 2, at: 'x' },
      ],
      submitted: [comment('p2')],
      pending: [comment()],
      dismissed: { p3: { at: 'x' } },
    }
    expect(openPointsOf(artifact, state)).toEqual({ author: 1, reviewer: 1 })
    expect(openPointsOf({ ...artifact, settled: { p4: { reason: 'by design', at: 'x' } } }, state)).toEqual({
      author: 0,
      reviewer: 1,
    })
    expect(openPointsOf(artifact, { ...emptyState('x'), pending: [comment('p5')] })).toEqual({
      author: 2,
      reviewer: 2,
    })
  })
})

describe('canvasFactsOf', () => {
  const tally = { author: 1, reviewer: 4 }

  it('counts no points with no canvas anywhere, whatever the tally says', async () => {
    await context()
    const readArtifact = vi.spyOn(t.ctx.canvases, 'readArtifact')
    expect(await canvasFactsOf(t.ctx, pull())).toEqual({ status: 'Pending', points: null })
    expect(await canvasFactsOf(t.ctx, pull({ canvasOpen: tally }))).toEqual({
      status: 'Pending',
      points: null,
    })
    expect(readArtifact).not.toHaveBeenCalled()
  })

  it('takes the shared canvas comment’s tally while no canvas is here', async () => {
    await context()
    expect(await canvasFactsOf(t.ctx, pull({ canvasShas: [OLD], canvasOpen: tally }))).toEqual({
      status: 'Stale',
      points: tally,
    })
    // A shared head canvas not kept here.
    expect(await canvasFactsOf(t.ctx, pull({ canvasShas: [HEAD_SHA], canvasOpen: tally }))).toEqual({
      status: 'Ready',
      points: tally,
    })
    // A comment whose tally did not read counts nothing.
    expect(await canvasFactsOf(t.ctx, pull({ canvasShas: [HEAD_SHA] }))).toEqual({
      status: 'Ready',
      points: null,
    })
  })

  it('counts the open points of the canvas here, as the reader left them, over the shared tally', async () => {
    await context()
    await keepCanvas(HEAD_SHA)
    const artifact = syntheticArtifact()
    const expected = openPointsOf(artifact, emptyState('x'))
    expect(expected.author + expected.reviewer).toBeGreaterThan(0)
    expect(await canvasFactsOf(t.ctx, pull({ canvasOpen: tally }))).toEqual({
      status: 'Ready',
      points: expected,
    })
    const point = artifact.points.find(p => p.audience === 'reviewer')
    await t.ctx.state.setDismissed(42, point?.fingerprint ?? '', true)
    expect(await canvasFactsOf(t.ctx, pull())).toEqual({
      status: 'Ready',
      points: { ...expected, reviewer: expected.reviewer - 1 },
    })
  })

  it('falls back to the shared tally when the canvas or the state cannot be read', async () => {
    await context()
    await keepCanvas(HEAD_SHA)
    vi.spyOn(t.ctx.state, 'read').mockRejectedValueOnce(new Error('state unreadable'))
    expect(await canvasFactsOf(t.ctx, pull({ canvasOpen: tally }))).toEqual({
      status: 'Ready',
      points: tally,
    })
    vi.spyOn(t.ctx.canvases, 'readArtifact').mockRejectedValueOnce(new Error('canvas unreadable'))
    expect(await canvasFactsOf(t.ctx, pull())).toEqual({ status: 'Ready', points: null })
    vi.spyOn(t.ctx.canvases, 'readArtifact').mockResolvedValueOnce(null)
    expect(await canvasFactsOf(t.ctx, pull({ canvasOpen: tally }))).toEqual({
      status: 'Ready',
      points: tally,
    })
  })
})
