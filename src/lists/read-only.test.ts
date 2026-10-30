// The read-only folder list calls run in, and the one-shot call through the agent runner.
import { readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { AgentRunner } from '../acpx/acpx.js'
import { makeTempDir } from '../testing/fakes.js'
import { createOneShot, READ_ONLY_SETTINGS, readOnlyDir } from './read-only.js'

let dir: string

beforeEach(async () => {
  dir = await makeTempDir()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('readOnlyDir', () => {
  it('writes the canvas’s read-only settings as both project and local settings', async () => {
    const target = path.join(dir, 'nested', 'call')
    expect(await readOnlyDir(target)).toBe(target)
    for (const file of ['settings.json', 'settings.local.json']) {
      expect(JSON.parse(await readFile(path.join(target, '.claude', file), 'utf8'))).toEqual(
        READ_ONLY_SETTINGS
      )
    }
    // Again over an existing folder.
    await readOnlyDir(target)
    expect(READ_ONLY_SETTINGS.permissions.deny).toContain('Bash')
  })
})

describe('createOneShot', () => {
  it('writes the files, then runs the agent in the feature’s folder with the chat’s agent and timeout', async () => {
    const exec = vi.fn<AgentRunner['exec']>(async () => ({ ok: true, text: 'answer' }))
    const oneShot = createOneShot({
      runner: { exec },
      dir,
      agent: async () => ({ agent: 'codex', timeoutSec: 90 }),
    })
    expect(await oneShot('priority', 'rank them', { 'context.md': '# queue' })).toEqual({
      ok: true,
      text: 'answer',
    })
    const cwd = path.join(dir, 'priority')
    expect(exec).toHaveBeenCalledWith({ agent: 'codex', prompt: 'rank them', cwd, timeoutSec: 90 })
    expect(await readFile(path.join(cwd, 'context.md'), 'utf8')).toBe('# queue')
  })

  it('answers why a call failed', async () => {
    const results = [
      { ok: false as const, text: '', message: 'timed out' },
      { ok: false as const, text: '' },
    ]
    const oneShot = createOneShot({
      runner: { exec: async () => results.shift() ?? { ok: true, text: '' } },
      dir,
      agent: async () => ({ agent: 'claude', timeoutSec: 30 }),
    })
    expect(await oneShot('builder', 'p')).toEqual({ ok: false, message: 'timed out' })
    expect(await oneShot('builder', 'p')).toEqual({ ok: false, message: 'the agent failed' })
  })
})
