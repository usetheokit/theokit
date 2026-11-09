import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import { agentToolOptions } from '../../src/tools/tool-registry.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'
import type { ToolSettings } from '../../src/tools/tool-settings.js'

/**
 * AC-004 (B-388): an MCP server and an ACP agent from the external tools file, on a real model,
 * built through the path the process uses (`resolveToolSettings`, `agentToolOptions` and
 * `createTheoClawAgent`). It runs only with THEOCLAW_LIVE=1; without it the file skips, so CI stays
 * offline. Each fixture returns a token made at test time, so an answer given without the tool
 * cannot hold it. The ACP agent is a fixture, not Claude Code or Codex: a real coding agent needs an
 * adapter and credentials this host does not have.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const FIXTURES = join(import.meta.dirname, '..', 'fixtures')

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

function tempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'theoclaw-external-'))
  cleanups.push(() => rmSync(path, { recursive: true, force: true }))
  return path
}

/** The tool settings of a start whose external tools file holds `content`. */
function settingsWith(content: unknown): ToolSettings {
  const cwd = tempDir()
  const file = join(cwd, 'external-tools.json')
  writeFileSync(file, JSON.stringify(content))
  return resolveToolSettings({ THEOCLAW_EXTERNAL_TOOLS: file }, cwd)
}

interface Turn {
  readonly answer: string
  readonly toolCalls: string[]
  /** Everything the process wrote to stdout and stderr during the turn. */
  readonly output: string
}

/** Capture the process's own stdout and stderr writes while `body` runs. */
async function capturingOutput<T>(body: () => Promise<T>): Promise<{ readonly value: T; readonly output: string }> {
  const chunks: string[] = []
  const streams = [process.stdout, process.stderr]
  const originals = streams.map((stream) => stream.write.bind(stream))
  for (const stream of streams) {
    stream.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
      return (originals[streams.indexOf(stream)] as (...args: unknown[]) => boolean)(chunk, ...rest)
    }) as typeof stream.write
  }
  try {
    return { value: await body(), output: chunks.join('') }
  } finally {
    streams.forEach((stream, index) => {
      stream.write = originals[index] as typeof stream.write
    })
  }
}

/** One turn on a fresh `/control`-shaped agent; fails naming the status when the run does not finish. */
async function turn(settings: ToolSettings, prompt: string): Promise<Turn> {
  const { model, apiKey } = liveModel()
  const { value, output } = await capturingOutput(async () => {
    const agent = await createTheoClawAgent(theoClawAgentOptions({ model, apiKey, toolOptions: agentToolOptions(settings) }))
    try {
      const run = await agent.send(prompt)
      const toolCalls: string[] = []
      for await (const event of run.stream()) {
        if (event.type === 'tool_call' && 'name' in event && 'status' in event && event.status === 'running') toolCalls.push(String(event.name))
      }
      const outcome = await run.wait()
      if (outcome.status !== 'finished') throw new Error(`the run ended ${outcome.status}: ${JSON.stringify(outcome)}`)
      return { answer: String((outcome as { result?: unknown }).result ?? ''), toolCalls }
    } finally {
      await agent[Symbol.asyncDispose]()
    }
  })
  return { ...value, output }
}

describe.skipIf(!LIVE)('MCP servers and ACP agents against a real model', () => {
  it('a real model calls a tool from a stdio MCP server', { timeout: 120_000 }, async () => {
    const value = token()
    const log = join(tempDir(), 'mcp-calls.log')
    const settings = settingsWith({
      mcpServers: {
        vault: { command: process.execPath, args: [join(FIXTURES, 'token-mcp-server.mjs')], env: { FIXTURE_TOKEN: value, FIXTURE_LOG: log } },
      },
    })
    expect(settings.secrets).toContain(value)
    const result = await turn(
      settings,
      'Use the vault_lookup tool with the name "release" to look up the stored value, then reply with that exact value and nothing else.',
    )
    expect(existsSync(log), JSON.stringify(result)).toBe(true)
    expect(readFileSync(log, 'utf8').trim().split('\n').filter((line) => line.startsWith('tools/call'))).toHaveLength(1)
    expect(result.toolCalls.some((name) => name.includes('vault_lookup')), JSON.stringify(result.toolCalls)).toBe(true)
    expect(result.answer).toContain(value)
    expect(result.output).not.toContain(value)
  })

  it('a turn still finishes when an MCP server command fails to start', { timeout: 120_000 }, async () => {
    const settings = settingsWith({ mcpServers: { broken: { command: '/nonexistent/theoclaw-mcp-server' } } })
    const result = await turn(settings, 'Reply with the word ready and nothing else.')
    expect(result.toolCalls.some((name) => name.startsWith('mcp_broken_'))).toBe(false)
    expect(result.answer.toLowerCase()).toContain('ready')
  })

  it('a real model delegates a turn to an ACP agent', { timeout: 120_000 }, async () => {
    const value = token()
    const record = join(tempDir(), 'permissions.log')
    const settings = settingsWith({
      acpAgents: [
        {
          name: 'coder',
          description: 'A coding agent. Send it a task as `message`; it replies with its result.',
          command: process.execPath,
          args: [join(FIXTURES, 'permission-asking-acp-agent.mjs'), `--token=${value}`, `--record=${record}`],
          timeoutMs: 30_000,
        },
      ],
    })
    const result = await turn(
      settings,
      'Use the coder tool with the message "report your build id", then reply with the exact text the coder tool returned and nothing else.',
    )
    expect(result.toolCalls, JSON.stringify(result)).toContain('coder')
    expect(result.answer).toContain(value)
    expect(readFileSync(record, 'utf8').trim().split('\n').every((line) => line === 'reject-once')).toBe(true)
  })
})
