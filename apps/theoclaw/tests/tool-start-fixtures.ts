import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import WebSocket from 'ws'

import { startTheoClaw } from '../src/composition.js'
import type { RunningTheoClaw, StartOptions } from '../src/composition.js'
import type { TurnAgent } from '../src/channels/reply-handler.js'
import type { AgentToolOptions } from '../src/tools/tool-registry.js'
import type { ToolDeps } from '../src/tools/tool-settings.js'
import { capturingStream, fakeBuilders, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { FakeAgent } from './fakes.js'

export const CONTROL_TOKEN = 'control-token-for-the-tool-tests-0123456789'
export const enforced = () => ({ ok: true as const, bin: '/usr/bin/bwrap' })
export const notEnforced = () => ({ ok: false as const, reason: 'bwrap not found on PATH' })

/** Everything one start of the tool tests produced: the app or the refusal, and what it wrote. */
export interface ToolStart {
  readonly app?: RunningTheoClaw
  readonly error?: Error
  /** How many platform runners were built: 0 means the start refused before any. */
  readonly builds: () => number
  readonly output: () => string
  /** Write through the masked stream, as any later writer in the process would. */
  readonly writeThrough: (text: string) => void
  /** The tool options every `/control` agent was built with, in order. */
  readonly toolOptions: AgentToolOptions[]
}

export function tempCwd(cleanups: (() => void)[]): string {
  const path = mkdtempSync(join(tmpdir(), 'theoclaw-start-'))
  cleanups.push(() => rmSync(path, { recursive: true, force: true }))
  return path
}

/** Start the app on fake platforms in `cwd` (none: the start's own default), with a control token, and keep what it did. */
export async function startForTools(
  env: Record<string, string | undefined>,
  cwd: string | undefined,
  toolDeps: ToolDeps,
  extra: Partial<StartOptions> = {},
): Promise<ToolStart> {
  const { adapters, builders } = fakeBuilders()
  const capture = capturingStream()
  const toolOptions: AgentToolOptions[] = []
  const agentFactory = (options: AgentToolOptions): TurnAgent => {
    toolOptions.push(options)
    return new FakeAgent({ frames: [] })
  }
  const base = {
    builds: () => adapters.size,
    output: () => capture.text(),
    writeThrough: (text: string) => void capture.write(text),
    toolOptions,
  }
  try {
    const app = await startTheoClaw({
      env: { ...TELEGRAM_AND_LINE, THEOCLAW_CONTROL_TOKEN: CONTROL_TOKEN, ...env },
      agentFactory,
      builders,
      signals: new EventEmitter(),
      exit: () => undefined,
      streams: [capture],
      ...(cwd === undefined ? {} : { cwd }),
      toolDeps: { warn: () => undefined, ...toolDeps },
      ...extra,
    })
    return { ...base, app }
  } catch (error) {
    return { ...base, error: error as Error }
  }
}

/** Send one `/control` chat frame and wait until the app built that turn's agent. */
export async function runControlTurn(start: ToolStart): Promise<AgentToolOptions> {
  const app = start.app
  if (app === undefined) throw new Error(`the start refused: ${start.error?.message ?? 'unknown'}`)
  const { host, port } = app.address()
  const before = start.toolOptions.length
  const socket = new WebSocket(`ws://${host}:${port}/control`, {
    headers: { Authorization: `Bearer ${CONTROL_TOKEN}` },
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  socket.send(JSON.stringify({ type: 'chat', message: 'hello' }))
  const deadline = Date.now() + 5_000
  while (start.toolOptions.length === before) {
    if (Date.now() > deadline) throw new Error('no /control agent was built within 5 s')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  socket.close()
  return start.toolOptions[before] as AgentToolOptions
}

export async function stop(start: ToolStart): Promise<void> {
  if (start.app === undefined) return
  await start.app.loop.stopAll()
  await start.app.close()
}
