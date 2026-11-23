import { describe, expect, it, vi } from 'vitest'

import {
  type ControlStreamClient,
  type ControlStreamFrame,
  createControlStreamSource,
} from './control-stream.js'

function clientOf(frames: ControlStreamFrame[], fail?: Error) {
  return {
    chat: vi.fn(async function* (_message: string, _session: string) {
      yield* frames
      if (fail !== undefined) throw fail
    }),
    interrupt: vi.fn((_session: string) => undefined),
    steer: vi.fn((_session: string, _message: string) => undefined),
  } satisfies ControlStreamClient
}

async function collect(source: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const e of source) out.push(e)
  return out
}

describe('createControlStreamSource', () => {
  it('opens the chat only when consumed and converts text and tools', async () => {
    const client = clientOf([
      { type: 'event', event: { type: 'text_delta', content: 'hi' } as never },
      { type: 'event', event: { type: 'tool_call', callId: 'c', toolName: 'ls' } as never },
      { type: 'event', event: { type: 'tool_result', callId: 'c' } as never },
      { type: 'event', event: { type: 'tool_result', callId: 'unknown' } as never },
      { type: 'done' },
    ])
    let ended = 0
    const source = createControlStreamSource(client, 's', 'hello', { onEnd: () => (ended += 1) })
    expect(client.chat).not.toHaveBeenCalled()
    expect(await collect(source())).toEqual([
      { type: 'text-delta', text: 'hi' },
      { type: 'tool_call', call_id: 'c', name: 'ls', status: 'running' },
      { type: 'tool_call', call_id: 'c', status: 'completed' },
    ])
    expect(client.chat).toHaveBeenCalledWith('hello', 's')
    expect(ended).toBe(1)
  })

  it('ends at interrupted and turns error frames and failures into notices', async () => {
    expect(
      await collect(createControlStreamSource(clientOf([{ type: 'interrupted' }]), 's', 'm')()),
    ).toEqual([{ type: 'interrupted' }])
    expect(
      await collect(
        createControlStreamSource(clientOf([{ type: 'error', code: 'X' }]), 's', 'm')(),
      ),
    ).toEqual([{ type: 'notice', variant: 'error', text: 'the turn ended: X' }])
    expect(
      await collect(createControlStreamSource(clientOf([], new Error('gone')), 's', 'm')()),
    ).toEqual([{ type: 'notice', variant: 'error', text: 'gone' }])
  })

  it('binds interrupt and steer to the session and stays quiet on a closed connection', () => {
    const client = clientOf([])
    const source = createControlStreamSource(client, 's', 'm')
    source.interrupt()
    source.steer('more')
    expect(client.interrupt).toHaveBeenCalledWith('s')
    expect(client.steer).toHaveBeenCalledWith('s', 'more')
    client.interrupt.mockImplementation(() => {
      throw new Error('closed')
    })
    expect(() => source.interrupt()).not.toThrow()
  })

  it('places inbox notices by arrival and hands leftovers to onNotice', async () => {
    const queued = [{ n: { variant: 'warning' as const, text: 'w' }, seq: 5 }]
    const late = { variant: 'warning' as const, text: 'late' }
    const inbox = {
      take: (before = Number.POSITIVE_INFINITY) => {
        const taken = queued.filter((q) => q.seq < before).map((q) => q.n)
        for (const q of taken)
          queued.splice(
            queued.findIndex((x) => x.n === q),
            1,
          )
        return taken
      },
      wait: () => new Promise<void>(() => undefined),
      stamp: () => 100,
    }
    const left: unknown[] = []
    const client = clientOf([
      { type: 'event', event: { type: 'text_delta', content: 'a' } as never, arrivedAt: 1 },
      { type: 'event', event: { type: 'text_delta', content: 'b' } as never, arrivedAt: 10 },
      { type: 'done', arrivedAt: 11 },
    ])
    queued.push({ n: late, seq: 50 })
    const events = await collect(
      createControlStreamSource(client, 's', 'm', { inbox, onNotice: (n) => left.push(n) })(),
    )
    expect(events).toEqual([
      { type: 'text-delta', text: 'a' },
      { type: 'notice', variant: 'warning', text: 'w' },
      { type: 'text-delta', text: 'b' },
    ])
    expect(left).toEqual([late])
  })
})
