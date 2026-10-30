// The canvas generations the tables show and stop. A row's Generate opens the review page's
// generate dialog, which starts the job; one runs at a time across a clone. The table reads where
// each PR's job is, and Stop asks it to end.
import type { GenerationJob } from '../contract/generation.js'
import { isRunning } from '../../static/js/generation-phases.js'
import type { GenerationManager } from '../generate/generation-manager.js'

/** Where a PR's canvas generation stands, as its row shows it; absent for none worth showing. */
export type RowGeneration =
  | { state: 'running'; phase: GenerationJob['phase']; startedAt: string }
  | { state: 'failed'; message: string; endedAt: string | null }

export interface Generations {
  /** What a PR's row says: its job running, or why its last one failed. */
  rowState(number: number): RowGeneration | undefined
  /** Stops a PR's running job; false when none runs. */
  stop(number: number): Promise<boolean>
}

export function createGenerations(generation: () => GenerationManager): Generations {
  return {
    rowState(number) {
      const job = generation().status(number)
      if (job === null) return undefined
      if (isRunning(job)) return { state: 'running', phase: job.phase, startedAt: job.startedAt }
      if (job.phase === 'failed') {
        return {
          state: 'failed',
          message: job.error?.message ?? 'generation failed',
          endedAt: job.endedAt ?? null,
        }
      }
      return undefined
    },
    stop: number => generation().cancel(number),
  }
}
