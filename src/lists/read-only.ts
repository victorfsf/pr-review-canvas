// The folder every one-shot list call (Highest priority, the builder's Ask AI) runs in: one the
// canvas owns under the lists' folder, never the clone. Claude Code loads the project's and local
// settings from the call's folder, so a repo's own `.claude/` (an allow rule that approves writes
// unasked, a hook, an MCP server) would otherwise stand above acpx's read-only flags. Here the
// settings are the canvas's, written before each call, and deny every tool that writes, runs
// commands or reaches the web, and the reads of credential files.
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { AgentRunner } from '../acpx/acpx.js'
import { writeTextAtomic } from '../store/atomic-json.js'

/** Files no call reads, whatever a PR's text asks: credentials and keys. */
export const SECRET_READS = [
  'Read(~/.ssh/**)',
  'Read(~/.gnupg/**)',
  'Read(~/.aws/**)',
  'Read(~/.azure/**)',
  'Read(~/.config/gcloud/**)',
  'Read(~/.kube/**)',
  'Read(~/.docker/config.json)',
  'Read(~/.config/gh/**)',
  'Read(~/.config/glab-cli/**)',
  'Read(~/.git-credentials)',
  'Read(~/.netrc)',
  'Read(~/.npmrc)',
  'Read(~/.pypirc)',
  'Read(~/.claude.json)',
  'Read(~/.claude/.credentials.json)',
  'Read(**/.env)',
  'Read(**/.env.*)',
]

/** What Claude Code may not do in a list call, whatever the prompt or the repo asks. */
export const READ_ONLY_SETTINGS = {
  permissions: {
    deny: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', ...SECRET_READS],
    defaultMode: 'default',
  },
  disableAllHooks: true,
  enableAllProjectMcpServers: false,
}

/** Makes `dir` a read-only call's folder, creating it when needed; answers with it. */
export async function readOnlyDir(dir: string): Promise<string> {
  await mkdir(path.join(dir, '.claude'), { recursive: true })
  const settings = `${JSON.stringify(READ_ONLY_SETTINGS, null, 2)}\n`
  for (const file of ['settings.json', 'settings.local.json']) {
    await writeTextAtomic(path.join(dir, '.claude', file), settings)
  }
  return dir
}

/** One read-only, one-shot agent call for a feature, answered with its text or why it failed. */
export type OneShot = (
  feature: 'priority' | 'builder',
  prompt: string,
  files?: Record<string, string>
) => Promise<{ ok: true; text: string } | { ok: false; message: string }>

/**
 * List calls through acpx's one-shot `exec`, each in its feature's read-only folder under `dir`,
 * with the files it reads written there first. The agent and its timeout are the AI Chat's.
 */
export function createOneShot(deps: {
  runner: Pick<AgentRunner, 'exec'>
  dir: string
  agent: () => Promise<{ agent: string; timeoutSec: number }>
}): OneShot {
  return async (feature, prompt, files = {}) => {
    const cwd = await readOnlyDir(path.join(deps.dir, feature))
    for (const [name, text] of Object.entries(files)) await writeTextAtomic(path.join(cwd, name), text)
    const { agent, timeoutSec } = await deps.agent()
    const result = await deps.runner.exec({ agent, prompt, cwd, timeoutSec })
    return result.ok
      ? { ok: true, text: result.text }
      : { ok: false, message: result.message ?? 'the agent failed' }
  }
}
