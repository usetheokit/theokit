import { describe, expect, it, vi } from 'vitest'
import { createDelegateAllTool } from '../tools/delegate-all-tool.js'
import { GuardrailViolationError } from '../guardrails/types.js'
import { delegationPortFromAgentFactory } from './delegation-port-from-factory.js'
import { DelegationError } from './delegation-types.js'
import type { SdkAgentHandle, SdkTurnHandle } from './sdk-adapter.js'

interface Fake {
  agent: SdkAgentHandle
  dispose: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
}

function fake(
  opts: {
    events?: unknown[]
    status?: string
    wait?: () => Promise<{ result?: string; status?: string }>
    cancel?: () => Promise<void>
    dispose?: () => Promise<void>
  } = {},
): Fake {
  const dispose = vi.fn(opts.dispose ?? (async () => undefined))
  const cancel = vi.fn(opts.cancel ?? (async () => undefined))
  const run = {
    wait: opts.wait ?? (async () => ({ result: 'done', status: opts.status ?? 'finished' })),
    stream: async function* () {
      for (const e of opts.events ?? []) yield e
    },
    cancel,
  } as unknown as SdkTurnHandle
  const agent = { agentId: 'a', send: vi.fn(async () => run), dispose } as unknown as SdkAgentHandle
  return { agent, dispose, cancel }
}

describe('delegationPortFromAgentFactory', () => {
  it('the worker is disposed after success, failure and cancellation', async () => {
    const ok = fake()
    await expect(
      delegationPortFromAgentFactory(async () => ok.agent).run('t'),
    ).resolves.toMatchObject({
      response: 'done',
    })
    expect(ok.dispose).toHaveBeenCalledTimes(1)

    const failed = fake({ status: 'error' })
    await expect(
      delegationPortFromAgentFactory(async () => failed.agent).run('t'),
    ).rejects.toBeInstanceOf(DelegationError)
    expect(failed.dispose).toHaveBeenCalledTimes(1)

    const controller = new AbortController()
    const cancelled = fake({
      wait: () =>
        new Promise((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('stopped'))),
        ),
    })
    const pending = delegationPortFromAgentFactory(async () => cancelled.agent).run('t', {
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(cancelled.agent.send).toHaveBeenCalled())
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(DelegationError)
    expect(cancelled.cancel).toHaveBeenCalledTimes(1)
    expect(cancelled.dispose).toHaveBeenCalledTimes(1)
  })

  it('an abort cancels the worker run and a failing cancel rejects with both errors', async () => {
    const controller = new AbortController()
    const w = fake({
      cancel: async () => {
        throw new Error('cancel broke')
      },
      wait: () =>
        new Promise((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('run broke'))),
        ),
    })
    const pending = delegationPortFromAgentFactory(async () => w.agent).run('t', {
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(w.agent.send).toHaveBeenCalled())
    controller.abort()
    const error = (await pending.catch((e: unknown) => e)) as DelegationError
    expect(error).toBeInstanceOf(DelegationError)
    const cause = error.cause as AggregateError
    expect(cause.errors.map((e: Error) => e.message)).toEqual(['run broke', 'cancel broke'])
    expect(w.dispose).toHaveBeenCalledTimes(1)
  })

  it('a run that streamed an error rejects with DelegationError', async () => {
    const w = fake({ events: [{ type: 'error', code: 'boom', message: 'bad' }] })
    const error = await delegationPortFromAgentFactory(async () => w.agent)
      .run('t')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DelegationError)
    expect((error as Error).message).toContain('boom: bad')
    expect(w.dispose).toHaveBeenCalledTimes(1)
  })

  it('a GuardrailError inside an AggregateError passes through unwrapped', async () => {
    const guard = new GuardrailViolationError('g', 'output', 'secret')
    const aggregate = new AggregateError(
      [new Error('x'), new AggregateError([guard], 'inner')],
      'both',
    )
    const w = fake({
      wait: async () => {
        throw aggregate
      },
    })
    await expect(delegationPortFromAgentFactory(async () => w.agent).run('t')).rejects.toBe(
      aggregate,
    )
    const direct = fake({
      wait: async () => {
        throw guard
      },
    })
    await expect(delegationPortFromAgentFactory(async () => direct.agent).run('t')).rejects.toBe(
      guard,
    )
  })

  it('the port works with createDelegateAllTool', async () => {
    const built: Fake[] = []
    const port = delegationPortFromAgentFactory(async () => {
      const w = fake()
      built.push(w)
      return w.agent
    })
    const tool = createDelegateAllTool({ roster: [{ name: 'worker', target: port }] })
    const out = JSON.parse(
      await tool.handler(
        {
          tasks: [
            { agent: 'worker', task: 'one' },
            { agent: 'worker', task: 'two' },
          ],
        },
        {},
      ),
    ) as { results: { ok: boolean; response: string }[] }
    expect(out.results.map((r) => [r.ok, r.response])).toEqual([
      [true, 'done'],
      [true, 'done'],
    ])
    expect(built).toHaveLength(2)
    expect(built.every((b) => b.dispose.mock.calls.length === 1)).toBe(true)
  })
})
