// What the home page's tables keep, in the project's data dir under `lists/`: the last fetch of
// each list (facts only, never what anyone wrote), the project's sections, base branches and
// Highest priority prompts, the filters its pages saved, and Highest priority's last picks. Every
// file is the clone's, shared by its worktrees, as the cached PRs are.
import path from 'node:path'
import { z } from 'zod'
import { BRANCH_COLORS, cleanBranches } from '../../static/js/lists/branches.js'
import {
  DEFAULT_PRIORITY_NAME,
  DEFAULT_PRIORITY_PROMPT,
  defaultPriority,
  MAX_PRIORITY_COUNT,
  MAX_PRIORITY_NAME,
  MAX_PRIORITY_PROMPT,
  MAX_PRIORITY_PROMPTS,
} from '../../static/js/lists/priority.js'
import { DEFAULT_SECTIONS, MAX_SECTIONS, SECTION_COLORS } from '../../static/js/lists/sections.js'
import { readJsonOrDefault, writeJsonAtomic } from '../store/atomic-json.js'
import { type ListKind, type ListSnapshot, ListSnapshotSchema, type People, PeopleSchema } from './model.js'

/** A list Settings saves: at least one branch, each named as git would take it, none twice. */
export const MainBranchesSchema = z
  .array(z.object({ name: z.string().min(1), color: z.enum(BRANCH_COLORS) }))
  .transform((list, ctx) => {
    const cleaned = cleanBranches(list)
    if ('error' in cleaned) {
      ctx.addIssue({ code: 'custom', message: cleaned.error })
      return z.NEVER
    }
    return cleaned.branches
  })

/**
 * The tables' sections: one to twelve, each named; the last is the catch-all, so its labels are
 * dropped. Label matching ignores case.
 */
export const SectionsSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(60),
      labels: z.array(z.string().trim().min(1).max(100)).max(30),
      /** Its row's color; missing means the one its place gives. */
      color: z.enum(SECTION_COLORS).optional(),
    })
  )
  .min(1)
  .max(MAX_SECTIONS)
  .transform(list => list.map((s, i) => (i === list.length - 1 ? { ...s, labels: [] } : s)))

/**
 * What Highest priority asks the agent for: the named prompts, each name once (ignoring case), the
 * name of the one in use, and how many PRs it may pick. The default is always among them, first.
 */
export const PrioritySchema = z
  .object({
    prompts: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(MAX_PRIORITY_NAME),
          prompt: z.string().trim().min(1).max(MAX_PRIORITY_PROMPT),
        })
      )
      .max(MAX_PRIORITY_PROMPTS),
    active: z.string().trim().min(1),
    count: z.number().int().min(1).max(MAX_PRIORITY_COUNT),
  })
  .transform(p => {
    const fixed = p.prompts.find(x => x.name === DEFAULT_PRIORITY_NAME) ?? {
      name: DEFAULT_PRIORITY_NAME,
      prompt: DEFAULT_PRIORITY_PROMPT,
    }
    return { ...p, prompts: [fixed, ...p.prompts.filter(x => x !== fixed)] }
  })
  .refine(p => p.prompts.length <= MAX_PRIORITY_PROMPTS, { message: 'too many prompts' })
  .refine(p => new Set(p.prompts.map(x => x.name.toLowerCase())).size === p.prompts.length, {
    message: 'each prompt needs its own name',
  })
  .refine(p => p.prompts.some(x => x.name === p.active), { message: 'active names one of the prompts' })
export type Priority = z.infer<typeof PrioritySchema>

const ListSettingsSchema = z.object({
  sections: SectionsSchema.optional(),
  branches: MainBranchesSchema.optional(),
  priority: PrioritySchema.optional(),
})
type StoredSettings = z.infer<typeof ListSettingsSchema>

export interface ListSettings {
  sections: z.infer<typeof SectionsSchema>
  /** The saved base branches; null until some are saved, when `main` stands. */
  branches: z.infer<typeof MainBranchesSchema> | null
  /** The prompts, the one in use with its text, and the count. */
  priority: ReturnType<typeof defaultPriority>
}

/** The last Highest priority sync: when, by which prompt and count, what it picked, or why not. */
export const PriorityResultSchema = z.object({
  syncedAt: z.string(),
  prompt: z.string(),
  count: z.number().int().positive(),
  picks: z.array(z.object({ number: z.number().int().positive(), why: z.string() })),
  /** Why the last sync failed; the picks are then the ones before it. */
  error: z.string().nullable(),
})
export type PriorityResult = z.infer<typeof PriorityResultSchema>

/**
 * What can be saved: each table's filters, the author searches they share, the columns they hide,
 * the tables and sections they fold, and the filters they saved by name.
 */
export const FILTER_PAGES = ['pulls', 'queue', 'searches', 'columns', 'folds', 'presets'] as const
export type FilterPage = (typeof FILTER_PAGES)[number]
export type SavedFilters = Partial<Record<FilterPage, unknown>>

/** The most one page may save, as JSON: filters are a handful of switches and short lists. */
export const MAX_FILTER_BYTES = 16 * 1024

const SavedFiltersSchema = z.record(z.string(), z.unknown())

export interface ListsStore {
  /** The folder of the lists' files; Highest priority's read-only folder is inside it. */
  dir: string
  readSnapshot(kind: ListKind): Promise<ListSnapshot | null>
  writeSnapshot(kind: ListKind, snapshot: ListSnapshot): Promise<void>
  /** The project's people as last read; null before the first read. */
  readPeople(): Promise<People | null>
  writePeople(people: People): Promise<void>
  readSettings(): Promise<ListSettings>
  /** Saves what is given; `null` goes back to the default. */
  writeSettings(change: { [K in keyof StoredSettings]?: StoredSettings[K] | null }): Promise<ListSettings>
  readFilters(): Promise<SavedFilters>
  /** Saves one page's filters, or forgets them with `null`. */
  writeFilters(page: FilterPage, value: unknown): Promise<void>
  readPriorityResult(): Promise<PriorityResult | null>
  writePriorityResult(result: PriorityResult): Promise<void>
}

/** `root` is the project's repo dir in the data dir, as the other stores take it. */
export function createListsStore(root: string): ListsStore {
  const dir = path.join(root, 'lists')
  const file = (name: string) => path.join(dir, name)
  const readStored = () => readJsonOrDefault(file('settings.json'), ListSettingsSchema, () => ({}))
  const resolve = (stored: StoredSettings): ListSettings => {
    const priority = stored.priority
    const active = priority?.prompts.find(p => p.name === priority.active) ?? priority?.prompts[0]
    return {
      sections: stored.sections ?? [...DEFAULT_SECTIONS],
      branches: stored.branches ?? null,
      priority:
        priority === undefined || active === undefined
          ? defaultPriority()
          : { ...priority, active: active.name, prompt: active.prompt },
    }
  }
  // Writes go one at a time per store, so two quick changes never lose one.
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(write: () => Promise<T>): Promise<T> => {
    const next = chain.then(write)
    chain = next.catch(() => undefined)
    return next
  }
  return {
    dir,
    // A file an older version wrote, in another shape, is fetched again rather than refused.
    readSnapshot: kind => readJsonOrDefault(file(`${kind}.json`), ListSnapshotSchema, () => null),
    writeSnapshot: (kind, snapshot) => writeJsonAtomic(file(`${kind}.json`), snapshot),
    readPeople: () => readJsonOrDefault(file('people.json'), PeopleSchema, () => null),
    writePeople: people => writeJsonAtomic(file('people.json'), people),
    readSettings: async () => resolve(await readStored()),
    writeSettings: change =>
      serial(async () => {
        const stored: Record<string, unknown> = { ...(await readStored()) }
        for (const [key, value] of Object.entries(change)) {
          if (value === null) delete stored[key]
          else if (value !== undefined) stored[key] = value
        }
        const next = ListSettingsSchema.parse(stored)
        await writeJsonAtomic(file('settings.json'), next)
        return resolve(next)
      }),
    readFilters: () => readJsonOrDefault(file('filters.json'), SavedFiltersSchema, () => ({})),
    writeFilters: (page, value) =>
      serial(async () => {
        const saved: Record<string, unknown> = await readJsonOrDefault(
          file('filters.json'),
          SavedFiltersSchema,
          () => ({})
        )
        if (value === null) delete saved[page]
        else saved[page] = value
        await writeJsonAtomic(file('filters.json'), saved)
      }),
    readPriorityResult: () => readJsonOrDefault(file('priority.json'), PriorityResultSchema, () => null),
    writePriorityResult: result => writeJsonAtomic(file('priority.json'), result),
  }
}
