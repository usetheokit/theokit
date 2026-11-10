/**
 * #1497 — two consecutive `/control` session turns on a real SDK agent with the `/control` tool set
 * and a scripted model: the second turn's model request goes out at once, and its tool call runs.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import type { TurnAgent } from '../src/agent-port.js'
import { createControlSessions } from '../src/control-plane/control-sessions.js'
import { controlAgentToolOptions } from '../src/tools/tool-registry.js'
import type { AgentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { startModelStub } from './model-stub.js'
import type { ModelStub } from './model-stub.js'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('the second turn of a /control session', () => {
  it('sends its model request and runs its read_file call within seconds', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    mkdirSync(workspace.path, { recursive: true })
    writeFileSync(join(workspace.path, 'notes.txt'), 'the note')
    const tools = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on' }, workspace.path, {
      detect: () => ({ ok: true, bin: '/usr/bin/bwrap' }),
      warn: () => undefined,
    })
    const stub: ModelStub = await startModelStub([
      { text: 'ok' },
      { toolCalls: [{ name: 'read_file', args: { path: 'notes.txt' } }] },
      { text: 'story' },
    ])
    cleanups.push(() => stub.close())
    const model = { id: 'lmstudio/stub', url: stub.url }
    const build = (toolOptions: AgentToolOptions): Promise<TurnAgent> =>
      createTheoClawAgent(theoClawAgentOptions({ model, apiKey: 'stub-key', toolOptions }))
    const sessions = createControlSessions({
      build: () => build(controlAgentToolOptions(tools, build)),
      report: (line) => reported.push(line),
    })
    cleanups.push(() => sessions.close())
    const owner = {}
    const reported: string[] = []

    expect(
      await sessions.run('s1', 'Remember this code word. Reply ok.', () => undefined, owner),
    ).toEqual({ ok: true })
    const events: string[] = []
    const started = Date.now()
    const outcome = await sessions.run(
      's1',
      'read notes.txt, then write a story',
      (event) => events.push(event.type),
      owner,
    )

    expect(outcome).toEqual({ ok: true })
    expect(stub.requests).toHaveLength(3)
    expect(events).toContain('tool_result')
    expect(Date.now() - started).toBeLessThan(5000)
    expect(reported.filter((line) => line.includes('first event after'))).toHaveLength(2)
  }, 20_000)
})
