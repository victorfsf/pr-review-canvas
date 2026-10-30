// What the tables keep on disk: each list's last fetch, the settings with their defaults, the
// saved filters and Highest priority's last picks; a file of another shape reads as missing.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULT_PRIORITY_NAME,
  DEFAULT_PRIORITY_PROMPT,
  defaultPriority,
} from '../../static/js/lists/priority.js'
import { DEFAULT_SECTIONS } from '../../static/js/lists/sections.js'
import { makeTempDir } from '../testing/fakes.js'
import { createListsStore, type ListsStore, PrioritySchema } from './store.js'
import { makeListPull } from './testing.js'

let root: string
let store: ListsStore

beforeEach(async () => {
  root = await makeTempDir()
  store = createListsStore(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const put = async (name: string, text: string) => {
  await mkdir(store.dir, { recursive: true })
  await writeFile(path.join(store.dir, name), text)
}

describe('createListsStore', () => {
  it('keeps its files under lists/', () => {
    expect(store.dir).toBe(path.join(root, 'lists'))
  })

  it('reads a list never fetched, or one of another shape, as missing', async () => {
    expect(await store.readSnapshot('pulls')).toBeNull()
    const snapshot = { viewer: 'me', fetchedAt: 'now', pulls: [makeListPull()] }
    await store.writeSnapshot('pulls', snapshot)
    expect(await store.readSnapshot('pulls')).toEqual(snapshot)
    // A snapshot an older version wrote, with the default branch it read then, still reads.
    await store.writeSnapshot('pulls', { ...snapshot, defaultBranch: 'main' } as typeof snapshot)
    expect(await store.readSnapshot('pulls')).toEqual(snapshot)
    await put('queue.json', '{"viewer": 1}')
    expect(await store.readSnapshot('queue')).toBeNull()
    await put('queue.json', 'not json')
    expect(await store.readSnapshot('queue')).toBeNull()
  })

  it('answers the defaults until settings are saved, and for a settings file of another shape', async () => {
    const defaults = { sections: [...DEFAULT_SECTIONS], branches: null, priority: defaultPriority() }
    expect(await store.readSettings()).toEqual(defaults)
    await put('settings.json', '{"sections": "nope"}')
    expect(await store.readSettings()).toEqual(defaults)
  })

  it('saves sections, dropping the catch-all’s labels, and goes back to the default on null', async () => {
    const saved = await store.writeSettings({
      sections: [
        { name: ' Backend ', labels: ['api'] },
        { name: 'Other', labels: ['ignored'], color: 'gray' },
      ],
    })
    expect(saved.sections).toEqual([
      { name: 'Backend', labels: ['api'] },
      { name: 'Other', labels: [], color: 'gray' },
    ])
    // A key left undefined keeps what is saved.
    const kept = await store.writeSettings({ branches: undefined })
    expect(kept.sections).toEqual(saved.sections)
    expect((await store.writeSettings({ sections: null })).sections).toEqual([...DEFAULT_SECTIONS])
    expect(JSON.parse(await readFile(path.join(store.dir, 'settings.json'), 'utf8'))).toEqual({})
  })

  it('saves base branches trimmed, refuses a bad list, and keeps writing after a refusal', async () => {
    const saved = await store.writeSettings({ branches: [{ name: ' develop ', color: 'blue' }] })
    expect(saved.branches).toEqual([{ name: 'develop', color: 'blue' }])
    await expect(
      store.writeSettings({
        branches: [
          { name: 'main', color: 'green' },
          { name: 'main', color: 'red' },
        ],
      })
    ).rejects.toThrow()
    await expect(store.writeSettings({ branches: [] })).rejects.toThrow()
    expect((await store.writeSettings({ branches: null })).branches).toBeNull()
  })

  it('saves Highest priority with the prompt in use resolved', async () => {
    const saved = await store.writeSettings({
      priority: {
        prompts: [
          { name: DEFAULT_PRIORITY_NAME, prompt: DEFAULT_PRIORITY_PROMPT },
          { name: 'Security', prompt: 'Security first' },
        ],
        active: 'Security',
        count: 5,
      },
    })
    expect(saved.priority).toMatchObject({ active: 'Security', prompt: 'Security first', count: 5 })
    expect((await store.readSettings()).priority.prompts.map(p => p.name)).toEqual([
      DEFAULT_PRIORITY_NAME,
      'Security',
    ])
    expect((await store.writeSettings({ priority: null })).priority).toEqual(defaultPriority())
  })

  it('reads saved filters, saves one page at a time, and forgets a page on null', async () => {
    expect(await store.readFilters()).toEqual({})
    await Promise.all([store.writeFilters('pulls', { state: ['open'] }), store.writeFilters('queue', ['x'])])
    expect(await store.readFilters()).toEqual({ pulls: { state: ['open'] }, queue: ['x'] })
    await store.writeFilters('pulls', null)
    expect(await store.readFilters()).toEqual({ queue: ['x'] })
    await put('filters.json', '[1, 2]')
    expect(await store.readFilters()).toEqual({})
    await store.writeFilters('columns', { hidden: [] })
    expect(await store.readFilters()).toEqual({ columns: { hidden: [] } })
  })

  it('keeps Highest priority’s last result, and reads one of another shape as none', async () => {
    expect(await store.readPriorityResult()).toBeNull()
    const result = { syncedAt: 'now', prompt: 'p', count: 3, picks: [{ number: 4, why: 'old' }], error: null }
    await store.writePriorityResult(result)
    expect(await store.readPriorityResult()).toEqual(result)
    await put('priority.json', '{"picks": 1}')
    expect(await store.readPriorityResult()).toBeNull()
  })

  it('keeps the project’s people, and reads none or one of another shape as none', async () => {
    expect(await store.readPeople()).toBeNull()
    const people = { fetchedAt: 'now', logins: ['ana', 'bob'] }
    await store.writePeople(people)
    expect(await store.readPeople()).toEqual(people)
    expect(await readFile(path.join(store.dir, 'people.json'), 'utf8')).toContain('"ana"')
    await put('people.json', '{"logins": "ana"}')
    expect(await store.readPeople()).toBeNull()
    await put('people.json', 'not json')
    expect(await store.readPeople()).toBeNull()
  })
})

describe('PrioritySchema', () => {
  const parse = (value: unknown) => PrioritySchema.safeParse(value)

  it('puts the default prompt first, adding it when it is missing', () => {
    const parsed = parse({ prompts: [{ name: 'Mine', prompt: 'x' }], active: 'Mine', count: 2 })
    expect(parsed.success && parsed.data.prompts.map(p => p.name)).toEqual([DEFAULT_PRIORITY_NAME, 'Mine'])
    const kept = parse({
      prompts: [
        { name: 'Mine', prompt: 'x' },
        { name: DEFAULT_PRIORITY_NAME, prompt: 'edited' },
      ],
      active: DEFAULT_PRIORITY_NAME,
      count: 2,
    })
    expect(kept.success && kept.data.prompts).toEqual([
      { name: DEFAULT_PRIORITY_NAME, prompt: 'edited' },
      { name: 'Mine', prompt: 'x' },
    ])
  })

  it('refuses names used twice, an active prompt that is not there, and too many prompts', () => {
    const twice = parse({
      prompts: [
        { name: 'Mine', prompt: 'x' },
        { name: 'MINE', prompt: 'y' },
      ],
      active: 'Mine',
      count: 2,
    })
    expect(twice.success).toBe(false)
    expect(parse({ prompts: [], active: 'Gone', count: 2 }).success).toBe(false)
    const many = Array.from({ length: 100 }, (_, i) => ({ name: `p${i}`, prompt: 'x' }))
    expect(parse({ prompts: many, active: 'p1', count: 2 }).success).toBe(false)
    expect(parse({ prompts: [], active: DEFAULT_PRIORITY_NAME, count: 2 }).success).toBe(true)
  })
})

describe('createListsStore resolving priority', () => {
  it('reads a saved priority whose active prompt is gone as the default', async () => {
    // Written by hand: the schema would refuse it, so the store reads the defaults.
    await put(
      'settings.json',
      JSON.stringify({ priority: { prompts: [{ name: 'Default', prompt: 'p' }], active: 'Gone', count: 2 } })
    )
    expect((await store.readSettings()).priority).toEqual(defaultPriority())
  })
})
