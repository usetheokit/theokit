import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSdkChannelAgentFactory } from '../src/control-plane/agent-factory.js'
import { startModelStub } from './session-model-stub.js'

const TEXT = 'unique-inbound-heron-7731'

/** Every file under `directory`, walked. */
function files(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

const scratch: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('a one-shot channel agent keeps its transcript out of HOME', () => {
  it('writes the transcript under the workspace, none under HOME/.theokit/projects', { timeout: 30_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'theoclaw-home-'))
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-ws-'))
    scratch.push(home, workspace)
    const stub = await startModelStub()
    vi.stubEnv('HOME', home)
    vi.stubEnv('OPENAI_API_BASE_URL', stub.url)
    try {
      const agent = await createSdkChannelAgentFactory({
        THEOCLAW_MODEL: 'openai/stub',
        OPENROUTER_API_KEY: 'sk-stub-key-0123456789',
        THEOCLAW_WORKSPACE: workspace,
      })()
      const run = await agent.send(TEXT)
      await run.wait()
      await (agent as unknown as { dispose?: () => Promise<void> }).dispose?.()
      const inHome = files(home)
      expect(inHome.filter((file) => file.endsWith('.jsonl'))).toEqual([])
      expect(inHome.filter((file) => readFileSync(file, 'utf8').includes(TEXT))).toEqual([])
      expect(files(join(workspace, '.theoclaw')).some((file) => file.endsWith('.jsonl'))).toBe(true)
    } finally {
      await stub.close()
    }
  })
})
