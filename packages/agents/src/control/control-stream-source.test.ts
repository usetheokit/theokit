import { describe, expect, it, vi } from 'vitest'

import type { ControlClient } from './control-client.js'
import type { ControlServerFrame } from './frames.js'
import { createControlStreamSource } from './control-stream-source.js'

function fake(frames: ControlServerFrame[]): ControlClient & { chat: ReturnType<typeof vi.fn> } {
  return {
    chat: vi.fn(async function* () {
      for (const f of frames) yield f
    }),
    interrupt: vi.fn(),
    steer: vi.fn(),
    close: vi.fn(async () => {}),
  } as never
}

async function collect(it: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const e of it) out.push(e)
  return out
}

describe('createControlStreamSource', () => {
  it('turns a turn into stream events and ends at done', async () => {
    const client = fake([
      { type: 'event', event: { type: 'text_delta', content: 'hi' } },
      {
        type: 'event',
        event: {
          type: 'tool_result',
          callId: 'ghost',
          toolName: 'x',
          output: '',
          durationMs: 1,
          isError: false,
        },
      },
      { type: 'event', event: { type: 'tool_call', callId: 'c1', toolName: 'read', input: {} } },
      {
        type: 'event',
        event: {
          type: 'tool_result',
          callId: 'c1',
          toolName: 'read',
          output: '',
          durationMs: 1,
          isError: true,
        },
      },
      { type: 'done' },
    ])
    const events = await collect(createControlStreamSource(client, 's1', 'hello')())
    expect(client.chat).toHaveBeenCalledWith('hello', 's1')
    expect(events).toEqual([
      { type: 'text-delta', text: 'hi' },
      { type: 'tool_call', call_id: 'c1', name: 'read', status: 'running' },
      { type: 'tool_call', call_id: 'c1', status: 'error' },
    ])
  })

  it('ends with a terminal error on interrupted and error frames', async () => {
    expect(
      await collect(
        createControlStreamSource(fake([{ type: 'interrupted', session: 's' }]), 's', 'm')(),
      ),
    ).toEqual([{ type: 'error', error: 'interrupted' }])
    expect(
      await collect(createControlStreamSource(fake([{ type: 'error', code: 'BUSY' }]), 's', 'm')()),
    ).toEqual([{ type: 'error', error: 'the turn ended: BUSY' }])
  })

  it('binds interrupt and steer to the session', () => {
    const client = fake([])
    const source = createControlStreamSource(client, 's1', 'm')
    source.interrupt()
    source.steer('go left')
    expect(client.interrupt).toHaveBeenCalledWith('s1')
    expect(client.steer).toHaveBeenCalledWith('s1', 'go left')
  })

  it('reads the frames through a transform and closes the message at a break', async () => {
    const client = fake([
      { type: 'event', event: { type: 'text_delta', content: 'a' } },
      { type: 'done' },
    ])
    const source = createControlStreamSource(client, 's', 'm', {
      frames: async function* (frames) {
        for await (const frame of frames) {
          yield frame
          yield { type: 'break' }
        }
      },
    })
    expect(await collect(source())).toEqual([
      { type: 'text-delta', text: 'a' },
      { type: 'assistant', message: '' },
    ])
  })
})
