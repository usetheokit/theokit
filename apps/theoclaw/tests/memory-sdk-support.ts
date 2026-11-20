import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import { vi } from 'vitest'

import { chatSessions } from '../src/sessions/chat-sessions.js'
import { type ModelStub, startModelStub } from './model-stub.js'

export const FACT = 'The owner keeps a heron called Quillon-7731'
export const dm = (platform: string, id: string) => ({ platform, sender: { id }, channel: { type: 'dm', id } }) as unknown as MessageEvent

/** One DM turn through the real SDK: the model stub answers, the SDK's reviewer then calls `save_memory` when `save` is set. */
export async function say(state: string, platform: string, sender: string, save: boolean, extra: Record<string, string> = {}): Promise<ModelStub> {
  const stub = await startModelStub(save ? [{ text: 'noted' }, { toolCalls: [{ name: 'save_memory', args: { fact: FACT } }] }, { text: 'done' }] : [{ text: 'ok' }])
  vi.stubEnv('OPENAI_API_BASE_URL', stub.url)
  vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'theoclaw-home-')))
  const { sessions, withAgent } = chatSessions({
    env: {
      THEOCLAW_MODEL: 'openai/stub',
      OPENROUTER_API_KEY: 'sk-stub-key-0123456789',
      THEOCLAW_TRANSCRIPTS: 'on',
      THEOCLAW_WORKSPACE: mkdtempSync(join(tmpdir(), 'theoclaw-ws-')),
      THEOCLAW_STATE_DIR: state,
      ...extra,
    },
    write: () => undefined,
  })
  await withAgent(dm(platform, sender), async (lease) => {
    const run = await lease.agent.send('hello')
    await run.wait()
    lease.release()
  })
  await sessions.disposeAll()
  return stub
}

export const seen = (stub: ModelStub): string => JSON.stringify(stub.requests)

