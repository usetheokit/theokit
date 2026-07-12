/**
 * M41 (ADR-0050 D4) — InProcessTransport: `ChatTransport` over the in-process seam
 * (`streamAgentTurnInProcess`), for the terminal/desktop surfaces. Bridges the generator to a
 * ReadableStream, `reconnectToStream` → null (mirrors ai's DirectChatTransport), and owns the inline
 * HITL pending-map so `approve(id, decision)` resolves a parked approval.
 */
import { describe, expect, it } from 'vitest'
import type { UIMessage, UIMessageChunk } from 'ai'

import {
  InProcessTransport,
  type InProcessRunInput,
} from '../../packages/theo/src/client/in-process-transport.js'

async function collect(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = []
  const reader = stream.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    out.push(value)
  }
  return out
}

const USER: UIMessage = { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'count to 2' }] }
const sendOpts = (abortSignal?: AbortSignal) => ({
  trigger: 'submit-message' as const,
  chatId: 'c1',
  messageId: undefined,
  messages: [USER],
  abortSignal,
})

describe('InProcessTransport (M41)', () => {
  it('test_sendMessages_bridges_generator_to_readable_stream', async () => {
    const run = (_input: InProcessRunInput): AsyncGenerator<UIMessageChunk> =>
      (async function* () {
        yield { type: 'start' } as UIMessageChunk
        yield { type: 'text-start', id: 't0' } as UIMessageChunk
        yield { type: 'text-delta', id: 't0', delta: 'ab' } as UIMessageChunk
        yield { type: 'finish' } as UIMessageChunk
      })()
    const transport = new InProcessTransport({ run })
    const chunks = await collect(await transport.sendMessages(sendOpts()))
    expect(chunks).toHaveLength(4)
    expect(chunks[2]).toMatchObject({ type: 'text-delta', delta: 'ab' })
  })

  it('test_sendMessages_forwards_last_user_text_to_runner', async () => {
    let seen = ''
    const run = (input: InProcessRunInput): AsyncGenerator<UIMessageChunk> =>
      (async function* () {
        seen = input.message
        yield { type: 'finish' } as UIMessageChunk
      })()
    const transport = new InProcessTransport({ run })
    await collect(await transport.sendMessages(sendOpts()))
    expect(seen).toBe('count to 2')
  })

  it('test_reconnect_returns_null', async () => {
    const transport = new InProcessTransport({ run: () => (async function* () {})() })
    expect(await transport.reconnectToStream()).toBeNull()
  })

  it('test_approve_resolves_pending_inline_request', async () => {
    // A gated run: the runner parks on `awaitApproval` before emitting its final chunk.
    const run = (input: InProcessRunInput): AsyncGenerator<UIMessageChunk> =>
      (async function* () {
        yield { type: 'start' } as UIMessageChunk
        const decision = await input.awaitApproval?.({
          approvalId: 'a1',
          toolName: 'write_file',
          opts: {},
        })
        yield { type: 'text-start', id: 't0' } as UIMessageChunk
        yield {
          type: 'text-delta',
          id: 't0',
          delta: typeof decision === 'object' && decision.approved ? 'approved' : 'denied',
        } as UIMessageChunk
        yield { type: 'finish' } as UIMessageChunk
      })()

    const transport = new InProcessTransport({ run })
    const stream = await transport.sendMessages(sendOpts())

    // Drain the stream eagerly in the background (as the AgentClient does). The pull advances the
    // generator to `awaitApproval`, which parks and registers the pending approval.
    const drained = collect(stream)

    // Settle the parked approval once it is registered (retry — the pull is async).
    for (let i = 0; i < 50; i++) {
      try {
        await transport.approve('a1', { approved: true })
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
    }

    const chunks = await drained
    expect(
      chunks.some((c) => c.type === 'text-delta' && (c as { delta: string }).delta === 'approved'),
    ).toBe(true)
  })

  it('test_approve_unknown_id_rejects', async () => {
    const transport = new InProcessTransport({ run: () => (async function* () {})() })
    await expect(transport.approve('nope', { approved: true })).rejects.toThrow(
      /No pending approval 'nope'/,
    )
  })

  it('test_duplicate_approval_id_rejects_the_second_registration', async () => {
    // A second awaitApproval with an already-pending id must fail fast, not silently overwrite the first.
    const run = (input: InProcessRunInput): AsyncGenerator<UIMessageChunk> =>
      (async function* () {
        const first = input.awaitApproval?.({ approvalId: 'dup', toolName: 'x', opts: {} })
        let secondRejected = false
        try {
          await input.awaitApproval?.({ approvalId: 'dup', toolName: 'y', opts: {} })
        } catch {
          secondRejected = true
        }
        yield {
          type: 'text-delta',
          id: 't0',
          delta: secondRejected ? 'rejected' : 'ok',
        } as UIMessageChunk
        yield { type: 'finish' } as UIMessageChunk
        void first // the first registration stays parked (never resolved in this test)
      })()
    const transport = new InProcessTransport({ run })
    const chunks = await collect(await transport.sendMessages(sendOpts()))
    expect(
      chunks.some((c) => c.type === 'text-delta' && (c as { delta: string }).delta === 'rejected'),
    ).toBe(true)
  })

  it('test_cancel_calls_generator_return', async () => {
    let returned = false
    const run = (): AsyncGenerator<UIMessageChunk> => {
      const gen = (async function* () {
        yield { type: 'start' } as UIMessageChunk
        yield { type: 'finish' } as UIMessageChunk
      })()
      const origReturn = gen.return.bind(gen)
      gen.return = ((value?: unknown) => {
        returned = true
        return origReturn(value as never)
      }) as typeof gen.return
      return gen
    }
    const transport = new InProcessTransport({ run })
    const stream = await transport.sendMessages(sendOpts())
    const reader = stream.getReader()
    await reader.read()
    await reader.cancel()
    expect(returned).toBe(true)
  })
})
