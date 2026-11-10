/**
 * #1497 — two consecutive `/control` session turns on a started instance (the composition root, with
 * its plugins, approvals, tool set and the real SDK agent from `createAgentFactory`) against a
 * scripted model: the second turn's model request goes out at once and its `read_file` call runs.
 * The model is reached through `OPENROUTER_API_BASE_URL`, as in the live H-1 test.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import WebSocket from 'ws'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createAgentFactory } from '../src/control-plane/agent-factory.js'
import { CONTROL_TOKEN, enforced, startForTools, stop, tempCwd } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'
import { startModelStub } from './model-stub.js'
import type { ModelStub } from './model-stub.js'
import { waitFor } from './fakes.js'

const cleanups: (() => void | Promise<void>)[] = []
let savedBase: string | undefined
beforeEach(() => {
  savedBase = process.env.OPENROUTER_API_BASE_URL
})
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  if (savedBase === undefined) delete process.env.OPENROUTER_API_BASE_URL
  else process.env.OPENROUTER_API_BASE_URL = savedBase
})

describe('the second turn of a /control session on a started instance', () => {
  it('sends its model request and runs its read_file call within seconds', async () => {
    const files: (() => void)[] = []
    const cwd = tempCwd(files)
    cleanups.push(() => files.forEach((f) => f()))
    mkdirSync(join(cwd, 'files'))
    writeFileSync(join(cwd, 'files', 'notes.txt'), 'the note')
    const stub: ModelStub = await startModelStub([
      { text: 'ok' },
      { toolCalls: [{ name: 'read_file', args: { path: 'files/notes.txt' } }] },
      { text: 'story' },
    ])
    cleanups.push(() => stub.close())
    process.env.OPENROUTER_API_BASE_URL = stub.url.replace(/\/v1$/, '/api')
    const env = {
      THEOCLAW_MODEL: 'openrouter/google/gemini-2.5-flash',
      OPENROUTER_API_KEY: 'sk-or-stub-key-1234567890',
    }
    const start: ToolStart = await startForTools(
      { ...env, THEOCLAW_WORKSPACE: cwd },
      cwd,
      { detect: enforced },
      {
        agentFactory: createAgentFactory(env),
      },
    )
    cleanups.push(() => stop(start))
    const { host, port } = start.app!.address()
    const socket = new WebSocket(`ws://${host}:${port}/control`, {
      headers: { Authorization: `Bearer ${CONTROL_TOKEN}` },
    })
    cleanups.push(() => socket.close())
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    const frames: { type: string; event?: { type: string } }[] = []
    socket.on('message', (raw) => frames.push(JSON.parse(String(raw))))
    const turn = async (message: string): Promise<string[]> => {
      const from = frames.length
      socket.send(JSON.stringify({ type: 'chat', message, session: 's1' }))
      await waitFor(
        () => frames.slice(from).some((f) => f.type === 'done' || f.type === 'error'),
        5_000,
        `the turn's end; frames: ${JSON.stringify(frames.slice(from))}`,
      )
      return frames.slice(from).map((f) => f.event?.type ?? f.type)
    }

    expect(await turn('Remember this code word. Reply with the single word ok.')).toContain('done')
    const began = Date.now()
    const second = await turn('Use read_file to read files/notes.txt, then write a story.')

    expect(second).toContain('tool_result')
    expect(second.at(-1)).toBe('done')
    expect(stub.requests).toHaveLength(3)
    expect(Date.now() - began).toBeLessThan(5_000)
  }, 20_000)
})
