import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { GuardrailViolationError } from '@theokit/agents'
import type { CustomTool } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import type { TurnAgent } from '../src/agent-port.js'
import { codeModeTool } from '../src/tools/code-mode-tools.js'
import { controlAgentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function settingsForTest(): ToolSettings {
  const handle = makeHostToolsWorkspace()
  cleanups.push(() => handle.remove())
  mkdirSync(join(handle.path, '.theoclaw'), { recursive: true })
  writeFileSync(join(handle.path, '.theoclaw', 'x'), 'state')
  return resolveToolSettings({}, handle.path, { detect: () => ({ ok: true as const, bin: '/usr/bin/bwrap' }), warn: () => undefined })
}

function delegateAll(build: () => Promise<TurnAgent>): CustomTool {
  const tool = controlAgentToolOptions(settingsForTest(), build).tools.find((candidate) => candidate.name === 'delegate_all')
  if (tool === undefined) throw new Error('no delegate_all tool on a /control agent')
  return tool
}

type Result = { ok: boolean; error?: string; message?: string }

const oneTask = { tasks: [{ agent: 'worker', task: 'one' }] }

/**
 * A worker whose run's stream is still pending when the parent aborts, then fails; its `cancel`
 * fails with `cancelFailure` (EC-2 of the probe).
 */
function workerWhoseCancelFails(cancelFailure: Error): TurnAgent {
  let failStream: (error: Error) => void = () => undefined
  const streamFailed = new Promise<never>((_resolve, reject) => (failStream = reject))
  return {
    send: async () => ({
      stream: async function* () {
        yield await streamFailed
      },
      wait: async () => ({ status: 'cancelled' }),
      cancel: async () => {
        failStream(new Error('the stream ended because the run was cancelled'))
        throw cancelFailure
      },
    }),
    [Symbol.asyncDispose]: async () => undefined,
  } as unknown as TurnAgent
}

/** Start `delegate_all` with one task, abort the parent turn once the worker runs, and settle. */
async function abortedDelegation(agent: TurnAgent): Promise<{ answer?: { results: Result[] }; rejected?: unknown }> {
  const controller = new AbortController()
  const tool = delegateAll(async () => agent)
  const pending = Promise.resolve(tool.handler(oneTask, { signal: controller.signal } as never))
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  return pending.then(
    (text: unknown) => ({ answer: JSON.parse(String(text)) as { results: Result[] } }),
    (rejected: unknown) => ({ rejected }),
  )
}

/** B-697 — the loop-code-review findings on apps/theoclaw (#79, #80, #83's web_fetch; #88 did not reproduce). */
describe('delegate_all keeps the error paths loop-code-review found broken', () => {
  // #79 (code-mode-tools.ts:93): a cancel that rejected on the failure path of untilSettled was unhandled.
  it('leaves no unhandled rejection when a cancelled worker run and its cancel both fail', async () => {
    const cancelFailure = new Error('b697-cancel-failed')
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      await abortedDelegation(workerWhoseCancelFails(cancelFailure))
      for (let turn = 0; turn < 10; turn += 1) await new Promise((resolve) => setImmediate(resolve))

      expect(unhandled).not.toContain(cancelFailure)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('negative: rejects with both errors when the run and its cancellation fail', async () => {
    const { answer } = await abortedDelegation(workerWhoseCancelFails(new Error('b697-cancel-failed')))

    expect(answer?.results[0]).toMatchObject({ ok: false, error: 'delegation_failed' })
    const message = answer?.results[0]?.message ?? ''
    // The run's error first, then the cancellation's.
    expect(message).toMatch(/the stream ended because the run was cancelled.*b697-cancel-failed/)
  })

  // #80 (code-mode-tools.ts:124): a guardrail refusal was wrapped as DelegationError and its message crossed.
  it('withholds the message of a guardrail violation raised by a worker', async () => {
    const agent = {
      send: async () => {
        throw new GuardrailViolationError('pii-detector', 'output', 'ssn found b697')
      },
      [Symbol.asyncDispose]: async () => undefined,
    } as unknown as TurnAgent
    const tool = delegateAll(async () => agent)

    const answer = JSON.parse(String(await tool.handler(oneTask))) as { results: Result[] }

    expect(answer.results[0]?.message ?? '').not.toContain('ssn found b697')
    expect(answer.results[0]?.error).toBe('guardrail_violation')
  })

  it('edge: keeps a worker build failure as delegation_failed', async () => {
    const tool = delegateAll(async () => {
      throw new Error('no model key b697')
    })

    const answer = JSON.parse(String(await tool.handler(oneTask))) as { results: Result[] }

    expect(answer.results[0]).toMatchObject({ ok: false, error: 'delegation_failed' })
    expect(answer.results[0]?.message).toContain('no model key b697')
  })

  it('negative: ends the turn with both errors when a guarded worker also fails to dispose', async () => {
    const guard = new GuardrailViolationError('pii-detector', 'output', 'ssn found b697')
    const disposal = new Error('dispose failed b697')
    const agent = {
      send: async () => {
        throw guard
      },
      [Symbol.asyncDispose]: async () => {
        throw disposal
      },
    } as unknown as TurnAgent
    const tool = delegateAll(async () => agent)

    const rejected = await Promise.resolve(tool.handler(oneTask)).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(rejected).toBeInstanceOf(AggregateError)
    expect((rejected as AggregateError).errors).toEqual([guard, disposal])
  })
})

describe('delegate_all on the double and triple failure paths', () => {
  it('negative: reports a cancellation that failed after the run finished', async () => {
    let endStream: () => void = () => undefined
    const streamEnded = new Promise<void>((resolve) => (endStream = resolve))
    const agent = {
      send: async () => ({
        stream: async function* () {
          await streamEnded
          yield { type: 'assistant' }
        },
        wait: async () => ({ status: 'finished', result: 'done' }),
        cancel: async () => {
          endStream()
          throw new Error('b697-late-cancel-failed')
        },
      }),
      [Symbol.asyncDispose]: async () => undefined,
    } as unknown as TurnAgent

    const { answer } = await abortedDelegation(agent)

    expect(answer?.results[0]).toMatchObject({ ok: false, error: 'delegation_failed' })
    expect(answer?.results[0]?.message).toContain('b697-late-cancel-failed')
  })

  it('negative: ends the turn when a guarded run also fails to cancel and to dispose', async () => {
    const guard = new GuardrailViolationError('pii-detector', 'output', 'ssn found b697')
    let failStream: (error: Error) => void = () => undefined
    const streamFailed = new Promise<never>((_resolve, reject) => (failStream = reject))
    const agent = {
      send: async () => ({
        stream: async function* () {
          yield await streamFailed
        },
        wait: async () => ({ status: 'cancelled' }),
        cancel: async () => {
          failStream(guard)
          throw new Error('b697-cancel-failed')
        },
      }),
      [Symbol.asyncDispose]: async () => {
        throw new Error('dispose failed b697')
      },
    } as unknown as TurnAgent

    const { answer, rejected } = await abortedDelegation(agent)

    expect(answer).toBeUndefined()
    expect(rejected).toBeInstanceOf(AggregateError)
    const inner = (rejected as AggregateError).errors[0] as AggregateError
    expect(inner.errors[0]).toBe(guard)
  })
})

describe('run_code bounds what a script may ask web_fetch for', () => {
  /** A `web_fetch` stand-in that records the `timeout_ms` each call receives. */
  function recordingWebFetch(): { tool: CustomTool; timeouts: unknown[] } {
    const timeouts: unknown[] = []
    const tool: CustomTool = {
      name: 'web_fetch',
      description: 'fetch a URL',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      handler: (input: Record<string, unknown>) => {
        timeouts.push(input.timeout_ms)
        return 'fetched'
      },
    }
    return { tool, timeouts }
  }

  // #83 (shipped web_fetch ignores the run's abort): a script could hold it open for its own timeout.
  it('caps the web_fetch timeout a script asks for', async () => {
    const { tool, timeouts } = recordingWebFetch()
    const run = codeModeTool([tool], settingsForTest())
    const call = (extra: string): string => `await api.web_fetch({ url: "https://example.com/"${extra} })`

    await run.handler({
      code: [call(', timeout_ms: 600000'), call(''), call(', timeout_ms: 5000'), call(', timeout_ms: -5'), 'return 1'].join('\n'),
    })

    expect(timeouts).toEqual([10_000, 10_000, 5000, 10_000])
  })
})
