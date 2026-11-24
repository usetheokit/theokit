import { beforeEach, describe, expect, it, vi } from 'vitest'

const readFile = vi.hoisted(() => vi.fn())
vi.mock('node:fs/promises', () => ({ readFile }))

import type { SdkAgentHandle, SdkTurnHandle } from '../bridge/sdk-adapter.js'
import { agentRunPort, fileTransientJob } from './run-ports.js'

function boundary(turn: () => Promise<SdkTurnHandle>) {
  const send = vi.fn(turn)
  const dispose = vi.fn(async () => {})
  const agent = { send, dispose } as unknown as SdkAgentHandle
  const withAgent = async <R>(work: (a: SdkAgentHandle) => Promise<R>): Promise<R> => {
    try {
      return await work(agent)
    } finally {
      await agent.dispose()
    }
  }
  return { send, dispose, withAgent }
}

const signal = new AbortController().signal
const waits = (o: Awaited<ReturnType<SdkTurnHandle['wait']>>): SdkTurnHandle => ({
  wait: async () => o,
})

describe('agentRunPort', () => {
  it('runs an agent that has only send: no id, no dispose, a streaming turn', async () => {
    const seen: string[] = []
    const agent = {
      send: async () => ({
        stream: async function* () {
          seen.push('stream')
          yield { type: 'status' }
        },
        wait: async () => {
          seen.push('wait')
          return { status: 'finished', result: 'ok' }
        },
      }),
    }
    const r = await agentRunPort((work) => work(agent))('p', signal)
    expect(r).toEqual({ ok: true, text: 'ok' })
    expect(seen).toEqual(['stream', 'wait'])
  })

  it('a finished run returns its text', async () => {
    const b = boundary(async () => waits({ status: 'finished', result: 'hi' }))
    expect(await agentRunPort(b.withAgent)('p', signal)).toEqual({ ok: true, text: 'hi' })
  })

  it('a run that ends error maps to ok false naming the error code', async () => {
    const b = boundary(async () =>
      waits({
        status: 'error',
        error: { message: 'boom', code: 'rate_limited' } as { message: string },
      }),
    )
    const r = await agentRunPort(b.withAgent)('p', signal)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toContain('rate_limited')
  })

  it('a run that ends cancelled maps to ok false naming the status', async () => {
    const b = boundary(async () => waits({ status: 'cancelled' }))
    const r = await agentRunPort(b.withAgent)('p', signal)
    expect(!r.ok && r.error).toContain('cancelled')
  })

  it('a finished run with no result maps to ok false', async () => {
    const b = boundary(async () => waits({ status: 'finished' }))
    expect((await agentRunPort(b.withAgent)('p', signal)).ok).toBe(false)
  })

  it('the scheduler signal reaches send, after the send options', async () => {
    const b = boundary(async () => waits({ status: 'finished', result: 'x' }))
    await agentRunPort(b.withAgent, { sendOptions: { model: 'm', signal: undefined } })('p', signal)
    expect(b.send).toHaveBeenCalledWith('p', { model: 'm', signal })
  })

  it('drains the stream before waiting', async () => {
    const order: string[] = []
    const b = boundary(async () => ({
      stream: async function* () {
        order.push('stream')
        yield { type: 'text_delta', content: 'x' } as const
      },
      wait: async () => {
        order.push('wait')
        return { status: 'finished', result: 'x' }
      },
    }))
    await agentRunPort(b.withAgent)('p', signal)
    expect(order).toEqual(['stream', 'wait'])
  })

  it('the agent is disposed when the run throws', async () => {
    const b = boundary(async () => {
      throw new Error('send failed')
    })
    await expect(agentRunPort(b.withAgent)('p', signal)).rejects.toThrow('send failed')
    expect(b.dispose).toHaveBeenCalledOnce()
  })
})

describe('fileTransientJob', () => {
  const target = { channel: 'c' } as never
  const make = () => fileTransientJob({ id: 'hb', cron: '@hourly', target, file: '/x' })
  beforeEach(() => readFile.mockReset())

  it('builds a non-durable job and re-reads the trimmed file on each fire', async () => {
    const { job, transient } = make()
    expect(job.id).toBe('hb')
    expect(job.cron).toBe('@hourly')
    expect(job.target).toBe(target)
    expect(transient.durable).toBe(false)
    readFile.mockResolvedValueOnce('  one \n').mockResolvedValueOnce('two')
    expect(await transient.prompt()).toBe('one')
    expect(await transient.prompt()).toBe('two')
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(readFile).toHaveBeenNthCalledWith(1, '/x', 'utf8')
    expect(readFile).toHaveBeenNthCalledWith(2, '/x', 'utf8')
  })

  it('an absent or blank file means no run', async () => {
    const { transient } = make()
    readFile.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ENOENT' }))
    expect(await transient.prompt()).toBeUndefined()
    readFile.mockResolvedValueOnce(' \n\t')
    expect(await transient.prompt()).toBeUndefined()
  })

  it('an unreadable file (EACCES) rejects', async () => {
    const { transient } = make()
    readFile.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    await expect(transient.prompt()).rejects.toThrow('denied')
  })
})
