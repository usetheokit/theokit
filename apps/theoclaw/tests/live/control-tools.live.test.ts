import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import type { AgentToolOptions } from '../../src/tools/tool-registry.js'
import { controlAgentToolOptions } from '../../src/tools/tool-registry.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'
import type { ToolSettings } from '../../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from '../host-tools-workspace.js'

/**
 * B-611: `delegate` on a real model, through the options a `/control` agent is built with
 * (`controlAgentToolOptions` and `createTheoClawAgent`, the worker built by the same factory). It
 * runs only with THEOCLAW_LIVE=1; without it the case skips and CI stays offline. The file holds a
 * token made at test time, so an answer given without the worker cannot hold it, and the case reads
 * the tool-call events off the stream rather than trusting the answer.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const LIVE_TIMEOUT_MS = 180_000

function liveModel(): { readonly model: string; readonly apiKey: string } {
  const model = process.env.THEOCLAW_MODEL
  const apiKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
  if (!model) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  if (!apiKey) throw new Error('THEOCLAW_LIVE=1 needs THEOKIT_API_KEY or OPENROUTER_API_KEY')
  return { model, apiKey }
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function liveSettings(): ToolSettings {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  return resolveToolSettings({}, workspace.path)
}

interface ToolCall {
  readonly name: string
  readonly result: string
}

/** One turn on a fresh `/control` agent: the answer, the tools started, and the completed calls. */
async function turn(settings: ToolSettings, prompt: string): Promise<{ answer: string; started: string[]; completed: ToolCall[] }> {
  const { model, apiKey } = liveModel()
  const build = (toolOptions: AgentToolOptions) => createTheoClawAgent(theoClawAgentOptions({ model, apiKey, toolOptions }))
  const agent = await build(controlAgentToolOptions(settings, build))
  try {
    const run = await agent.send(prompt)
    const started: string[] = []
    const completed: ToolCall[] = []
    for await (const event of run.stream()) {
      if (event.type !== 'tool_call') continue
      const call = event as { name?: unknown; status?: unknown; result?: unknown }
      if (call.status === 'running') started.push(String(call.name))
      if (call.status === 'completed') {
        completed.push({ name: String(call.name), result: typeof call.result === 'string' ? call.result : JSON.stringify(call.result ?? '') })
      }
    }
    const outcome = await run.wait()
    if (outcome.status !== 'finished') throw new Error(`the run ended ${outcome.status}: ${JSON.stringify(outcome)}`)
    return { answer: String(outcome.result ?? ''), started, completed }
  } finally {
    await agent[Symbol.asyncDispose]()
  }
}

describe.skipIf(!LIVE)('delegate against a real model', () => {
  it('a real model delegates one task to a worker and gets its answer', { timeout: LIVE_TIMEOUT_MS }, async () => {
    const settings = liveSettings()
    const secret = `tok-${randomBytes(6).toString('hex')}`
    writeFileSync(join(settings.toolRoot, 'note.txt'), `${secret}\n`)

    const result = await turn(
      settings,
      'Make exactly one call to the delegate tool, with agent "worker" and the task ' +
        '"Use read_file to read note.txt and reply with its exact content". ' +
        'Do not read the file yourself. Then reply with the content the worker returned.',
    )

    const delegations = result.completed.filter((call) => call.name === 'delegate')
    expect(delegations, `tool calls observed: ${JSON.stringify(result.completed)}`).toHaveLength(1)
    expect(result.started).not.toContain('read_file')
    expect(result.started).not.toContain('delegate_all')
    expect((delegations[0] as ToolCall).result).toContain(secret)
    expect(result.answer).toContain(secret)
  })
})
