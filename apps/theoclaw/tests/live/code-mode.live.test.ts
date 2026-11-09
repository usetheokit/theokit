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
 * B-386 (OC-65, H-5): code mode and fan-out on a real model, through the options a `/control` agent
 * is built with (`controlAgentToolOptions` and `createTheoClawAgent`, the workers built by the same
 * factory). It runs only with THEOCLAW_LIVE=1; without it the cases skip and CI stays offline. Each
 * case writes values made at test time, so an answer given without the tools cannot hold them, and
 * reads the tool-call events off the stream rather than trusting the answer.
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

const token = (): string => `tok-${randomBytes(6).toString('hex')}`

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function liveSettings(): ToolSettings {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  return resolveToolSettings({}, workspace.path)
}

/** One completed tool call as the stream reports it. */
interface ToolCall {
  readonly name: string
  readonly args: unknown
  readonly result: string
}

interface Turn {
  readonly answer: string
  /** Every tool call the stream reported, by name, in the order they started. */
  readonly started: string[]
  readonly completed: ToolCall[]
}

/** A `/control` agent, its workers built by the same factory. */
async function controlAgent(settings: ToolSettings) {
  const { model, apiKey } = liveModel()
  const build = (toolOptions: AgentToolOptions) => createTheoClawAgent(theoClawAgentOptions({ model, apiKey, toolOptions }))
  return build(controlAgentToolOptions(settings, build))
}

/** One turn on a fresh `/control` agent; fails naming the status when the run does not finish. */
async function turn(settings: ToolSettings, prompt: string): Promise<Turn> {
  const agent = await controlAgent(settings)
  try {
    const run = await agent.send(prompt)
    const started: string[] = []
    const completed: ToolCall[] = []
    for await (const event of run.stream()) {
      if (event.type !== 'tool_call') continue
      const call = event as { name?: unknown; status?: unknown; args?: unknown; result?: unknown }
      if (call.status === 'running') started.push(String(call.name))
      if (call.status === 'completed') {
        const result = typeof call.result === 'string' ? call.result : JSON.stringify(call.result ?? '')
        completed.push({ name: String(call.name), args: call.args, result })
      }
    }
    const outcome = await run.wait()
    if (outcome.status !== 'finished') throw new Error(`the run ended ${outcome.status}: ${JSON.stringify(outcome)}`)
    return { answer: String(outcome.result ?? ''), started, completed }
  } finally {
    await agent[Symbol.asyncDispose]()
  }
}

function codeOf(call: ToolCall): string {
  const args = (typeof call.args === 'string' ? JSON.parse(call.args) : call.args) as { code?: unknown } | undefined
  return String(args?.code ?? '')
}

function tasksOf(call: ToolCall): unknown[] {
  const args = (typeof call.args === 'string' ? JSON.parse(call.args) : call.args) as { tasks?: unknown } | undefined
  return Array.isArray(args?.tasks) ? args.tasks : []
}

describe.skipIf(!LIVE)('code mode and fan-out against a real model', () => {
  it("a real model's script calls two tools in one run_code for OC-65", { timeout: LIVE_TIMEOUT_MS }, async () => {
    const settings = liveSettings()
    const sentinel = token()
    writeFileSync(join(settings.toolRoot, 'a.txt'), `${sentinel} 17\n`)
    writeFileSync(join(settings.toolRoot, 'b.txt'), `${sentinel} 25\n`)

    const result = await turn(
      settings,
      'Files a.txt and b.txt each hold one line: a label, a space, then a number. ' +
        'Make exactly one call to the run_code tool. Its code must call api.read_file for a.txt and for b.txt, ' +
        'extract the number at the end of each file\'s content, and return only their sum. ' +
        'Do not call read_file directly. Reply with the sum and nothing else.',
    )

    const summing = result.completed.filter(
      (call) => call.name === 'run_code' && call.result.includes('42') && !call.result.includes(sentinel),
    )
    expect(summing.length, `tool calls observed: ${JSON.stringify(result.completed)}`).toBeGreaterThanOrEqual(1)
    expect(codeOf(summing[0] as ToolCall)).toContain('read_file')
    expect(result.started).not.toContain('read_file')
    for (const call of result.completed) {
      expect(call.result).not.toContain(sentinel)
      if (call.name !== 'run_code') {
        expect(call.result).not.toMatch(/\b17\b/)
        expect(call.result).not.toMatch(/\b25\b/)
      }
    }
    expect(result.answer).toContain('42')
  })

  it('a real model fans out to two sub-agents and waits for both for H-5', { timeout: LIVE_TIMEOUT_MS }, async () => {
    const settings = liveSettings()
    const first = token()
    const second = token()
    writeFileSync(join(settings.toolRoot, 'one.txt'), `${first}\n`)
    writeFileSync(join(settings.toolRoot, 'two.txt'), `${second}\n`)

    const result = await turn(
      settings,
      'Make exactly one call to the delegate_all tool with two tasks for the agent "worker": ' +
        'the first task is "Use read_file to read one.txt and reply with its exact content", ' +
        'the second is "Use read_file to read two.txt and reply with its exact content". ' +
        'Do not read the files yourself. Then reply with both contents, one per line.',
    )

    const fanOuts = result.completed.filter((call) => call.name === 'delegate_all')
    expect(fanOuts, `tool calls observed: ${JSON.stringify(result.completed)}`).toHaveLength(1)
    expect(tasksOf(fanOuts[0] as ToolCall)).toHaveLength(2)
    // The parent read nothing itself, directly or through a script: the contents came back
    // through the two workers, in the one delegate_all result.
    expect(result.started).not.toContain('read_file')
    expect(result.started).not.toContain('run_code')
    const fanOutResult = (fanOuts[0] as ToolCall).result
    expect(fanOutResult).toContain(first)
    expect(fanOutResult).toContain(second)
    expect(fanOutResult).not.toContain('delegation_failed')
    expect(result.answer).toContain(first)
    expect(result.answer).toContain(second)
  })
})
