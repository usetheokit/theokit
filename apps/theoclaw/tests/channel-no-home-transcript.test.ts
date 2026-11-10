import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Agent } from '@theokit/sdk'

import { startTheoClaw } from '../src/composition.js'
import { createSdkChannelAgentFactory } from '../src/control-plane/agent-factory.js'
import { capturingStream, fakeBuilders, OPEN_DMS } from './composition-fixtures.js'
import { messageEvent, waitFor } from './fakes.js'
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
    } finally {
      await stub.close()
    }
  })

  it('an inbound chat message leaves no copy of its text under HOME, the cwd or the app dir', { timeout: 30_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'theoclaw-home-'))
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-ws-'))
    scratch.push(home, workspace)
    const stub = await startModelStub()
    vi.stubEnv('HOME', home)
    const { adapters, builders } = fakeBuilders()
    const app = await startTheoClaw({
      env: { ...OPEN_DMS, OPENROUTER_API_KEY: 'sk-stub-key-0123456789', THEOCLAW_WORKSPACE: workspace },
      agentFactory: () => {
        throw new Error('the /control factory must not build a chat agent')
      },
      getOrCreate: (id, options) => Agent.getOrCreate(id, { ...options, model: { id: 'openai/stub', url: stub.url } }),
      builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
    })
    try {
      await app.loop.ready
      const telegram = adapters.get('telegram')!
      await telegram.deliver(messageEvent('telegram', TEXT, 'u9'))
      await waitFor(() => telegram.sent.length === 1, 15_000, 'the reply')
      await app.loop.stopAll()
      await app.sessions.disposeAll()
      // The workspace holds the chat transcript by design (README, THEOCLAW_WORKSPACE); nothing else may.
      for (const directory of [home, process.cwd(), join(process.cwd(), '..')]) {
        const hits = files(directory).filter((file) => !file.includes('node_modules') && !file.includes('/dist/') && file.endsWith('.jsonl'))
        expect(hits.filter((file) => readFileSync(file, 'utf8').includes(TEXT))).toEqual([])
      }
    } finally {
      await app.close()
      await stub.close()
    }
  })
})
