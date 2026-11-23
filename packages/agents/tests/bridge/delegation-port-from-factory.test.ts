import { describe, expect, it, vi } from 'vitest'
import { createDelegateAllTool } from '../../src/tools/delegate-all-tool.js'
import type { Guardrail } from '../../src/guardrails/types.js'
import { GuardrailViolationError } from '../../src/guardrails/types.js'
import { delegationPortFromAgentFactory } from '../../src/bridge/delegation-port-from-factory.js'
import { DelegationTimeoutError } from '../../src/bridge/delegation-lifecycle.js'
import {
  DelegationBudgetExceededError,
  DelegationError,
} from '../../src/bridge/delegation-types.js'
import { withGuardrails } from '../../src/bridge/handle-wrappers.js'
import type { SdkMessage } from '../../src/bridge/event-translator.js'
import type { SdkAgentHandle, SdkTurnHandle } from '../../src/bridge/sdk-adapter.js'

interface Fake {
  agent: SdkAgentHandle<SdkMessage>
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
  } as unknown as SdkTurnHandle<SdkMessage>
  const agent = {
    agentId: 'a',
    send: vi.fn(async () => run),
    dispose,
  } as unknown as SdkAgentHandle<SdkMessage>
  return { agent, dispose, cancel }
}

describe('delegationPortFromAgentFactory', () => {
  it('forwards a message with images and disposes through Symbol.asyncDispose', async () => {
    const disposed = vi.fn(async () => undefined)
    const send = vi.fn(async () => ({
      wait: async () => ({ result: 'done', status: 'finished' }),
    }))
    const agent = { send, [Symbol.asyncDispose]: disposed }
    const message = { text: 'look', images: [{ data: 'AAAA', mimeType: 'image/png' }] }
    await expect(
      delegationPortFromAgentFactory(async () => agent).run(message),
    ).resolves.toMatchObject({
      response: 'done',
    })
    expect(send).toHaveBeenCalledWith(message, {})
    expect(disposed).toHaveBeenCalledTimes(1)
  })

  it('a failing Symbol.asyncDispose rejects the task', async () => {
    const agent = {
      send: async () => ({ wait: async () => ({ result: 'done', status: 'finished' }) }),
      [Symbol.asyncDispose]: async () => {
        throw new Error('stuck')
      },
    }
    await expect(delegationPortFromAgentFactory(async () => agent).run('t')).rejects.toBeInstanceOf(
      DelegationError,
    )
  })

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
    const raw = await tool.handler(
      {
        tasks: [
          { agent: 'worker', task: 'one' },
          { agent: 'worker', task: 'two' },
        ],
      },
      {},
    )
    const out = JSON.parse(raw as string) as { results: { ok: boolean; response: string }[] }
    expect(out.results.map((r) => [r.ok, r.response])).toEqual([
      [true, 'done'],
      [true, 'done'],
    ])
    expect(built).toHaveLength(2)
    expect(built.every((b) => b.dispose.mock.calls.length === 1)).toBe(true)
  })

  const passing: Guardrail = {
    name: 'pass',
    checkInput: () => ({ action: 'allow' }),
    checkOutput: () => ({ action: 'allow' }),
  } as unknown as Guardrail

  it('an abort reaches the run of a guarded agent', async () => {
    const controller = new AbortController()
    const w = fake({
      wait: () =>
        new Promise((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('stopped'))),
        ),
    })
    const guarded = withGuardrails(w.agent, [passing])
    const pending = delegationPortFromAgentFactory(async () => guarded).run('t', {
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(w.agent.send).toHaveBeenCalled())
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(DelegationError)
    expect(w.cancel).toHaveBeenCalledTimes(1)
    expect(w.dispose).toHaveBeenCalledTimes(1)
  })

  it('a streamed error of a guarded agent rejects with DelegationError', async () => {
    const w = fake({ status: 'error' })
    const guarded = withGuardrails(w.agent, [passing])
    const error = await delegationPortFromAgentFactory(async () => guarded)
      .run('t')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DelegationError)
    expect((error as Error).message).toContain('run error')
    expect(w.dispose).toHaveBeenCalledTimes(1)
  })

  it('an error event streamed by a guarded agent that finished still rejects', async () => {
    const w = fake({ events: [{ type: 'error', code: 'boom', message: 'bad' }] })
    const guarded = withGuardrails(w.agent, [passing])
    const error = await delegationPortFromAgentFactory(async () => guarded)
      .run('t')
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(DelegationError)
    expect((error as Error).message).toContain('run error')
    expect((error as Error).message).not.toContain('boom')
    expect(w.dispose).toHaveBeenCalledTimes(1)
  })

  it('a guarded stream never carries the text of an inner error event', async () => {
    const w = fake({ events: [{ type: 'error', code: 'boom', message: 'secret-token-123' }] })
    const turn = await withGuardrails(w.agent, [passing]).send('t')
    const seen: unknown[] = []
    for await (const event of turn.stream!()) seen.push(event)
    expect(JSON.stringify(seen)).not.toContain('secret-token-123')
    expect(seen).toContainEqual(expect.objectContaining({ type: 'status', status: 'ERROR' }))
  })

  it('the task and sendOptions reach agent.send, and the delegation signal wins', async () => {
    const w = fake()
    const own = new AbortController()
    const optionSignal = new AbortController()
    const port = delegationPortFromAgentFactory(async () => w.agent, {
      sendOptions: { model: 'm', signal: optionSignal.signal },
    })
    await port.run('do it', { signal: own.signal })
    expect(w.agent.send).toHaveBeenCalledWith('do it', { model: 'm', signal: own.signal })
    await port.run('again')
    expect(w.agent.send).toHaveBeenLastCalledWith('again', {
      model: 'm',
      signal: optionSignal.signal,
    })
  })

  it('existing delegation errors pass through unchanged', async () => {
    const errors = [
      new DelegationError('inner', new Error('x')),
      new DelegationTimeoutError('inner', 5),
      new DelegationBudgetExceededError('inner', 1, 2),
    ]
    for (const thrown of errors) {
      const w = fake({
        wait: async () => {
          throw thrown
        },
      })
      await expect(delegationPortFromAgentFactory(async () => w.agent).run('t')).rejects.toBe(
        thrown,
      )
    }
  })
})
