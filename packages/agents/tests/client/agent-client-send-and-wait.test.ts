import { describe, expect, it, vi } from 'vitest'

import { AgentClient } from '../../src/client/agent-client.js'

const chunks = (text: string, totalTokens: number): unknown[] => [
  { type: 'start' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: text },
  { type: 'text-end', id: 't1' },
  { type: 'finish', messageMetadata: { usage: { totalTokens }, durationMs: 1 } },
]

const streamOf = (items: unknown[]): ReadableStream =>
  new ReadableStream({
    start(c) {
      for (const item of items) c.enqueue(item)
      c.close()
    },
  })

const transportOf = (make: () => ReadableStream): never =>
  ({ sendMessages: () => Promise.resolve(make()) }) as never

describe('AgentClient.sendAndWait', () => {
  it('sendAndWait resolves done with the turn text and usage', async () => {
    const client = new AgentClient<string>(transportOf(() => streamOf(chunks('hello', 42))))
    const settled = await client.sendAndWait('hi')
    expect(settled).toEqual({ status: 'done', text: 'hello', usage: { totalTokens: 42 } })
  })

  it('sendAndWait resolves error with the error when the stream fails', async () => {
    const boom = new Error('boom')
    const client = new AgentClient<string>(
      transportOf(
        () =>
          new ReadableStream({
            start(c) {
              c.error(boom)
            },
          }),
      ),
    )
    const settled = await client.sendAndWait('hi')
    expect(settled.status).toBe('error')
    expect(settled.error).toBe(boom)
  })

  it('a second send resolves the first sendAndWait as aborted', async () => {
    let calls = 0
    const client = new AgentClient<string>(
      transportOf(() => {
        calls += 1
        return calls === 1 ? new ReadableStream({ start() {} }) : streamOf(chunks('second', 1))
      }),
    )
    const first = client.sendAndWait('one')
    const second = client.sendAndWait('two')
    expect(await first).toEqual({ status: 'aborted' })
    expect((await second).status).toBe('done')
  })

  it('sendAndWait settles without timers', async () => {
    vi.useFakeTimers()
    try {
      const client = new AgentClient<string>(transportOf(() => streamOf(chunks('x', 3))))
      const settled = await client.sendAndWait('hi')
      expect(settled.status).toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })
})
