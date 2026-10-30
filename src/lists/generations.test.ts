// The canvas generations the tables show and stop: each row reads its PR's job from the project's
// generation manager, and Stop cancels it there.
import type { GenerationJob } from '../contract/generation.js'
import type { GenerationManager } from '../generate/generation-manager.js'
import { createGenerations } from './generations.js'

const STARTED = '2026-10-22T12:00:00.000Z'
const ENDED = '2026-10-22T12:05:00.000Z'

const job = (
  key: number,
  phase: GenerationJob['phase'],
  over: Partial<GenerationJob> = {}
): GenerationJob => ({
  key,
  force: false,
  agent: 'claude',
  model: null,
  skill: { source: 'default', version: '0.0.0-test' },
  phase,
  round: 1,
  maxRounds: 4,
  startedAt: STARTED,
  activity: [],
  ...over,
})

/** A generation manager whose jobs the test sets. */
function fakeGeneration() {
  const jobs = new Map<number, GenerationJob>()
  const cancelled: number[] = []
  const manager: GenerationManager = {
    start: async () => {
      throw new Error('the tables start no job')
    },
    status: key => jobs.get(key as number) ?? null,
    async cancel(key) {
      cancelled.push(key as number)
      return jobs.has(key as number)
    },
    running: () => null,
    nextSkill: async () => ({ source: 'default', version: '0.0.0-test' }),
  }
  return { manager, jobs, cancelled }
}

describe('createGenerations', () => {
  it('says nothing of a PR with no job, or whose last job ended well or was cancelled', () => {
    const gen = fakeGeneration()
    const generations = createGenerations(() => gen.manager)
    expect(generations.rowState(1)).toBeUndefined()
    gen.jobs.set(2, job(2, 'done', { endedAt: ENDED }))
    gen.jobs.set(3, job(3, 'cancelled', { endedAt: ENDED }))
    expect(generations.rowState(2)).toBeUndefined()
    expect(generations.rowState(3)).toBeUndefined()
  })

  it('says a running job’s phase and start, in every running phase', () => {
    const gen = fakeGeneration()
    const generations = createGenerations(() => gen.manager)
    for (const phase of ['preparing', 'checkout', 'generating', 'publishing', 'repairing'] as const) {
      gen.jobs.set(4, job(4, phase))
      expect(generations.rowState(4)).toEqual({ state: 'running', phase, startedAt: STARTED })
    }
  })

  it('says why a failed job failed and when it ended, with defaults for what it lacks', () => {
    const gen = fakeGeneration()
    const generations = createGenerations(() => gen.manager)
    gen.jobs.set(
      5,
      job(5, 'failed', { endedAt: ENDED, error: { code: 'GENERATION_FAILED', message: 'the agent stopped' } })
    )
    expect(generations.rowState(5)).toEqual({ state: 'failed', message: 'the agent stopped', endedAt: ENDED })
    gen.jobs.set(6, job(6, 'failed'))
    expect(generations.rowState(6)).toEqual({ state: 'failed', message: 'generation failed', endedAt: null })
  })

  it('stops a PR’s job through the manager, saying whether one was there', async () => {
    const gen = fakeGeneration()
    const generations = createGenerations(() => gen.manager)
    gen.jobs.set(7, job(7, 'generating'))
    expect(await generations.stop(7)).toBe(true)
    expect(await generations.stop(8)).toBe(false)
    expect(gen.cancelled).toEqual([7, 8])
  })

  it('reads the manager on each call, so a manager made later is the one asked', async () => {
    let current = fakeGeneration()
    const generations = createGenerations(() => current.manager)
    current = fakeGeneration()
    current.jobs.set(9, job(9, 'checkout'))
    expect(generations.rowState(9)).toMatchObject({ state: 'running', phase: 'checkout' })
    expect(await generations.stop(9)).toBe(true)
    expect(current.cancelled).toEqual([9])
  })
})
