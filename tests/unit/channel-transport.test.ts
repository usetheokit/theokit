/**
 * M42 (ADR-0051) — ChannelTransport: `ChatTransport` over a Tauri-`Channel`-shaped INJECTED push
 * source. Bridges pushed JSONL `UIMessageChunk` lines → ReadableStream; skips malformed lines; honors
 * abort; `reconnectToStream` → null (single-process parity); `approve` routes to the injected settle.
 */
import { describe, expect, it, vi } from 'vitest'
import type { UIMessage, UIMessageChunk } from 'ai'

import { AgentClient } from '../../packages/theo/src/client/agent-client.js'
import {
  ChannelTransport,
  type ChannelPushSource,
  type ChannelTurnHandlers,
} from '../../packages/theo/src/client/channel-transport.js'
import type { ApprovalDecision } from '../../packages/theo/src/client/transport.js'

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

/** A fake push source that replays scripted lines to onLine then onClose (synchronously in start). */
function scriptedSource(
  lines: string[],
  extra: Partial<ChannelPushSource> = {},
): ChannelPushSource {
  return {
    start(_turn, handlers: ChannelTurnHandlers) {
      for (const line of lines) handlers.onLine(line)
      handlers.onClose()
      return () => undefined
    },
    ...extra,
  }
}

const chunk = (o: Record<string, unknown>): string => JSON.stringify(o)

describe('ChannelTransport (M42)', () => {
  it('test_sendMessages_bridges_pushed_jsonl_to_uimessagechunks', async () => {
    const source = scriptedSource([
      chunk({ type: 'start' }),
      chunk({ type: 'text-start', id: 't0' }),
      chunk({ type: 'text-delta', id: 't0', delta: 'ok' }),
      chunk({ type: 'finish' }),
    ])
    const transport = new ChannelTransport({ source })
    const chunks = await collect(await transport.sendMessages(sendOpts()))
    expect(chunks).toHaveLength(4)
    expect(chunks[2]).toMatchObject({ type: 'text-delta', delta: 'ok' })
  })

  it('test_sendMessages_forwards_last_user_text_to_start', async () => {
    let seen = ''
    const source: ChannelPushSource = {
      start(turn, handlers) {
        seen = turn.message
        handlers.onClose()
        return () => undefined
      },
    }
    await collect(await new ChannelTransport({ source }).sendMessages(sendOpts()))
    expect(seen).toBe('count to 2')
  })

  it('test_malformed_jsonl_line_is_skipped_not_fatal', async () => {
    const source = scriptedSource([
      chunk({ type: 'start' }),
      'this is not json{{{', // corrupt push
      chunk({ type: 'text-delta', id: 't0', delta: 'survived' }),
      chunk({ type: 'finish' }),
    ])
    const chunks = await collect(await new ChannelTransport({ source }).sendMessages(sendOpts()))
    // The corrupt line is dropped; the surrounding valid frames still arrive.
    expect(chunks).toHaveLength(3)
    expect(
      chunks.some((c) => c.type === 'text-delta' && (c as { delta: string }).delta === 'survived'),
    ).toBe(true)
  })

  it('test_wellformed_but_non_chunk_payload_is_skipped', async () => {
    // Structurally valid JSON that is NOT a UIMessageChunk (no string `type`) is dropped by the
    // discriminant guard — it never reaches readUIMessageStream (ADR-0051 D4).
    const source = scriptedSource([
      chunk({ type: 'start' }),
      chunk({ foo: 'bar' }), // valid JSON, not a chunk
      JSON.stringify({ type: 42 }), // `type` not a string
      chunk({ type: 'text-delta', id: 't0', delta: 'kept' }),
      chunk({ type: 'finish' }),
    ])
    const chunks = await collect(await new ChannelTransport({ source }).sendMessages(sendOpts()))
    expect(chunks).toHaveLength(3) // start + text-delta + finish; the two non-chunks dropped
    expect(chunks.every((c) => typeof c.type === 'string')).toBe(true)
  })

  it('test_onError_errors_the_stream', async () => {
    const source: ChannelPushSource = {
      start(_turn, handlers) {
        handlers.onLine(chunk({ type: 'start' }))
        handlers.onError?.(new Error('channel broke'))
        return () => undefined
      },
    }
    const stream = await new ChannelTransport({ source }).sendMessages(sendOpts())
    await expect(collect(stream)).rejects.toThrow(/channel broke/)
  })

  it('test_abort_tears_down_the_source_and_closes', async () => {
    let torn = false
    const controller = new AbortController()
    const source: ChannelPushSource = {
      start(_turn, handlers) {
        handlers.onLine(chunk({ type: 'start' }))
        // never calls onClose — the turn is "live" until aborted
        return () => {
          torn = true
        }
      },
    }
    const stream = await new ChannelTransport({ source }).sendMessages(sendOpts(controller.signal))
    const reader = stream.getReader()
    const first = await reader.read()
    expect(first.value).toMatchObject({ type: 'start' })
    controller.abort()
    const next = await reader.read()
    expect(next.done).toBe(true) // stream closed on abort
    expect(torn).toBe(true) // source teardown ran
  })

  it('test_reader_cancel_tears_down_source', async () => {
    let torn = false
    const source: ChannelPushSource = {
      start(_turn, handlers) {
        handlers.onLine(chunk({ type: 'start' }))
        return () => {
          torn = true
        }
      },
    }
    const stream = await new ChannelTransport({ source }).sendMessages(sendOpts())
    const reader = stream.getReader()
    await reader.read()
    await reader.cancel() // consumer stops reading
    expect(torn).toBe(true)
  })

  it('test_reconnect_returns_null', async () => {
    const transport = new ChannelTransport({ source: scriptedSource([]) })
    expect(await transport.reconnectToStream()).toBeNull()
  })

  it('test_approve_routes_to_injected_settle', async () => {
    const settle = vi.fn(async (_id: string, _d: ApprovalDecision) => undefined)
    const transport = new ChannelTransport({ source: scriptedSource([], { settle }) })
    await transport.approve('a1', { approved: true, reason: 'ok' })
    expect(settle).toHaveBeenCalledWith('a1', { approved: true, reason: 'ok' })
  })

  it('test_approve_without_settle_throws', async () => {
    const transport = new ChannelTransport({ source: scriptedSource([]) })
    await expect(transport.approve('a1', { approved: true })).rejects.toThrow(/no HITL settle/)
  })

  it('test_agent_client_drives_channel_transport_same_shape', async () => {
    // The SAME AgentClient store (what useAgent binds over) drives the ChannelTransport — proving the
    // Tauri webview gets the unified client with no bespoke reader (M42 DoD).
    const source = scriptedSource([
      chunk({ type: 'start' }),
      chunk({ type: 'text-start', id: 't0' }),
      chunk({ type: 'text-delta', id: 't0', delta: 'Hello' }),
      chunk({ type: 'text-end', id: 't0' }),
      chunk({ type: 'finish' }),
    ])
    const client = new AgentClient(new ChannelTransport({ source }))
    client.send({ message: 'hi' })
    await new Promise<void>((resolve) => {
      const unsub = client.subscribe(() => {
        if (client.getSnapshot().status !== 'streaming') {
          unsub()
          resolve()
        }
      })
    })
    expect(client.getSnapshot().status).toBe('done')
    const text = client
      .getSnapshot()
      .messages.flatMap((m) => m.parts)
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(text).toBe('Hello')
  })
})
