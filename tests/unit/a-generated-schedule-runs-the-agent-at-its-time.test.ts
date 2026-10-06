import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { generate } from '../../packages/theo/src/cli/commands/generate.js'
import { importUserModule } from '../../packages/theo/src/config/import-user-module.js'
import { createCronScheduler } from '../../packages/theo/src/server/cron/cron-runtime-node.js'
import { scanCronDirs } from '../../packages/theo/src/server/cron/cron-scan.js'
import type { CronDefinition } from '../../packages/theo/src/server/cron/cron-types.js'

/**
 * The schedule `theokit generate schedule` writes into a scaffolded app runs the app's `chat` agent
 * in-process, at its time, once per fire, under the `auto-reject` approval posture.
 *
 * The generated file is loaded by `importUserModule` (tsx), outside vite, so `vi.mock` cannot reach
 * its imports. The temp project's `node_modules/@theokit/agents` is instead a fixture that wraps the
 * real built `streamAgentTurnInProcess`: it records each run and swaps in a scripted model stream,
 * while the real gate check and the real `auto-reject` resolver still run.
 *
 * Reads `packages/theo/dist` and `packages/agents/dist`: build both first.
 */
const REPO = resolve(__dirname, '../..')
const SCAFFOLD_CONFIG = resolve(REPO, 'packages/create-theokit/templates/default/theo.config.ts')
const RECORDING_AGENTS = resolve(REPO, 'tests/fixtures/schedule-recording-agents')

interface Approval {
  readonly approved: boolean
}
interface StreamOptions {
  readonly hitl?: {
    readonly gated: ReadonlyMap<string, unknown>
    readonly awaitApproval: (
      approvalId: string,
      opts: { question: string },
      toolName: string,
    ) => Promise<boolean | Approval>
  }
}
type ScriptedStream = (
  compiled: unknown,
  apiKey: string,
  opts: StreamOptions,
) => AsyncGenerator<Record<string, unknown>>
interface ScheduleProbe {
  runs: { apiKey: string; input: { signal?: AbortSignal; approvals?: { kind: string } } }[]
  toolRuns: number
  chunksConsumed: number
  stream: ScriptedStream
}

declare global {
  var __scheduleProbe: ScheduleProbe | undefined
}

/** The model's script: ask to run the gated tool, run it only if approved, say one thing, end. */
const askThenAnswer: ScriptedStream = async function* (_compiled, _apiKey, opts) {
  const probe = globalThis.__scheduleProbe
  if (!probe) throw new Error('schedule probe not installed')
  if (!opts.hitl?.gated.has('send_notification')) {
    throw new Error('the run reached the model without the send_notification gate')
  }
  const decision = await opts.hitl.awaitApproval('a1', { question: 'Send?' }, 'send_notification')
  if (decision === true || (typeof decision === 'object' && decision.approved)) probe.toolRuns += 1
  yield { type: 'text-delta', id: 't1', delta: 'digest ready' }
  probe.chunksConsumed += 1
}

/** A scaffold-layout app with the framework and the recording agents package linked. */
function scheduleProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'theo-schedule-run-'))
  copyFileSync(SCAFFOLD_CONFIG, join(dir, 'theo.config.ts'))
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
  mkdirSync(join(dir, 'node_modules/@theokit'), { recursive: true })
  symlinkSync(resolve(REPO, 'packages/theo'), join(dir, 'node_modules/theokit'), 'dir')
  symlinkSync(RECORDING_AGENTS, join(dir, 'node_modules/@theokit/agents'), 'dir')
  mkdirSync(join(dir, 'src/server/agents'), { recursive: true })
  writeFileSync(
    join(dir, 'src/server/agents/chat.ts'),
    [
      'export default {',
      "  model: 'openrouter/openai/gpt-4o-mini',",
      '  tools: [],',
      '  agents: {},',
      "  hitl: new Map([['send_notification', { question: 'Send?' }]]),",
      '}',
      '',
    ].join('\n'),
  )
  return dir
}

/** Generate `daily-digest` in a fresh project and load the definition the build would discover. */
async function generatedSchedule(dir: string): Promise<CronDefinition> {
  const result = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })
  expect(result.status).toBe('created')
  const nodes = await scanCronDirs([
    join(dir, 'src/server/crons'),
    join(dir, 'src/server/agents/schedules'),
  ])
  expect(nodes).toHaveLength(1)
  const mod = await importUserModule(nodes[0]!.filePath)
  return mod.default as CronDefinition
}

/**
 * The generated schedule the firing tests share. `importUserModule` loads it through tsx's
 * `tsImport`, which evaluates a fresh module graph per call (the framework and agents builds
 * included); measured in this file, the third such load in one worker did not settle within 60 s.
 * The definition is stateless, so the firing tests load it once and each gets a fresh probe.
 */
let sharedDir: string | undefined
let sharedDefinition: Promise<CronDefinition> | undefined
function sharedSchedule(): Promise<CronDefinition> {
  sharedDir ??= scheduleProject()
  sharedDefinition ??= generatedSchedule(sharedDir)
  return sharedDefinition
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!)
}

describe('a generated schedule runs the agent at its time', () => {
  let dir: string
  let logLines: string[]
  const savedKey = process.env.OPENROUTER_API_KEY

  beforeEach(() => {
    dir = scheduleProject()
    logLines = []
    globalThis.__scheduleProbe = { runs: [], toolRuns: 0, chunksConsumed: 0, stream: askThenAnswer }
    process.env.OPENROUTER_API_KEY = 'test-key'
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logLines.push(args.map(String).join(' '))
    })
  })

  afterAll(() => {
    if (sharedDir !== undefined) rmSync(sharedDir, { recursive: true, force: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    globalThis.__scheduleProbe = undefined
    if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = savedKey
    rmSync(dir, { recursive: true, force: true })
  })

  it('test_a_generated_schedule_runs_the_agent_at_its_time', async () => {
    const def = await sharedSchedule()
    const probe = globalThis.__scheduleProbe!
    const traced = (): string[] =>
      logLines.filter((l) => l.includes('daily-digest') && l.includes('(trace '))

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T08:59:59Z'))
    const scheduler = createCronScheduler([def])
    scheduler.start()
    try {
      await vi.advanceTimersByTimeAsync(999)
      expect(probe.runs).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(1002)
      expect(probe.runs).toHaveLength(1)
      expect(probe.runs[0]!.apiKey).toBe('test-key')
      expect(traced()).toHaveLength(1)
      expect(traced()[0]).toContain('fire ok')
      expect(probe.runs[0]!.input.signal?.aborted).toBe(false)
    } finally {
      scheduler.stop()
    }
    expect(probe.runs[0]!.input.signal?.aborted).toBe(true)

    // The handler settles only after the agent run ends: hold the stream open after one chunk.
    let release!: () => void
    const held = new Promise<void>((r) => {
      release = r
    })
    probe.stream = async function* () {
      yield { type: 'text-delta', id: 't1', delta: 'working' }
      probe.chunksConsumed += 1
      await held
    }
    const consumedBefore = probe.chunksConsumed
    let settled = false
    const run = Promise.resolve(
      def.handler({
        traceId: 't-hold',
        scheduledAt: new Date('2026-10-06T09:00:00Z'),
        signal: new AbortController().signal,
      }),
    ).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(probe.chunksConsumed).toBe(consumedBefore + 1)
    expect(settled).toBe(false)
    expect(logLines.filter((l) => l.includes('t-hold'))).toHaveLength(0)

    release()
    await run
    expect(settled).toBe(true)
    const holdLines = logLines.filter((l) => l.includes('t-hold'))
    expect(holdLines).toHaveLength(1)
    expect(holdLines[0]).toContain('fire ok')
  })

  it('test_an_unattended_schedule_never_runs_a_gated_tool', async () => {
    const def = await sharedSchedule()
    const probe = globalThis.__scheduleProbe!

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T08:59:59Z'))
    const scheduler = createCronScheduler([def])
    scheduler.start()
    try {
      await vi.advanceTimersByTimeAsync(2001)
    } finally {
      scheduler.stop()
    }

    expect(probe.runs).toHaveLength(1)
    expect(probe.runs[0]!.input.approvals?.kind).toBe('auto-reject')
    expect(probe.chunksConsumed).toBe(1)
    expect(probe.toolRuns).toBe(0)
  })

  it('test_a_failed_run_does_not_stop_the_next_tick', async () => {
    const def = await sharedSchedule()
    const probe = globalThis.__scheduleProbe!
    const errorLines: string[] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errorLines.push(args.map(String).join(' '))
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const handlerErrors = (): string[] =>
      errorLines.filter((l) => l.includes('"daily-digest" handler error:'))
    const traced = (): string[] =>
      logLines.filter((l) => l.includes('daily-digest') && l.includes('(trace '))
    const DAY = 24 * 3600_000

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T08:59:59Z'))
    const scheduler = createCronScheduler([def])
    scheduler.start()
    try {
      // Day 1: the provider is unreachable and the stream throws.
      probe.stream = async function* () {
        yield* []
        throw new Error('provider unreachable')
      }
      await vi.advanceTimersByTimeAsync(2001)
      expect(probe.runs).toHaveLength(1)
      expect(handlerErrors()).toHaveLength(1)
      expect(handlerErrors()[0]).toContain('provider unreachable')
      expect(traced()).toHaveLength(1)
      expect(traced()[0]).toContain('fire failed: provider unreachable')

      // Day 2: the next tick still fires and succeeds.
      probe.stream = askThenAnswer
      await vi.advanceTimersByTimeAsync(DAY)
      expect(probe.runs).toHaveLength(2)
      expect(traced()).toHaveLength(2)
      expect(traced()[1]).toContain('fire ok')

      // Day 3: the SDK reports the failure as an error chunk instead of throwing.
      probe.stream = async function* () {
        yield { type: 'error', errorText: 'rate limited' }
      }
      await vi.advanceTimersByTimeAsync(DAY)
      expect(probe.runs).toHaveLength(3)
      expect(handlerErrors()).toHaveLength(2)
      expect(handlerErrors()[1]).toContain('rate limited')
      expect(traced()).toHaveLength(3)
      expect(traced()[2]).toContain('fire failed:')

      // Day 4: the provider key is missing, so the run never reaches the stream.
      probe.stream = askThenAnswer
      delete process.env.OPENROUTER_API_KEY
      await vi.advanceTimersByTimeAsync(DAY)
      expect(probe.runs).toHaveLength(3)
      expect(handlerErrors()).toHaveLength(3)
      expect(handlerErrors()[2]).toContain('OPENROUTER_API_KEY is not set')
      expect(traced()).toHaveLength(4)
      expect(traced()[3]).toContain('fire failed:')

      // Day 5: with the key back, the next tick runs again.
      process.env.OPENROUTER_API_KEY = 'test-key'
      await vi.advanceTimersByTimeAsync(DAY)
      expect(probe.runs).toHaveLength(4)
      expect(traced()).toHaveLength(5)
      expect(traced()[4]).toContain('fire ok')
    } finally {
      scheduler.stop()
    }
  })

  it('test_a_generated_schedule_imports_only_what_the_scaffold_declares', async () => {
    const result = await generate({ cwd: dir, type: 'schedule', name: 'daily-digest' })
    expect(result.status).toBe('created')

    const source = readFileSync(join(dir, 'src/server/agents/schedules/daily-digest.ts'), 'utf8')

    expect(importSpecifiers(source)).toEqual([
      'theokit/server/cron',
      'theokit/server/agent',
      '@theokit/agents',
      '../chat.js',
    ])
  })
})
