import { describe, expect, it } from 'vitest'
import type { UIMessageChunk } from 'ai'

import { agentHandle } from '../../packages/theo/src/client/agent-handle.js'
import { InProcessTransport } from '../../packages/theo/src/client/in-process-transport.js'
import { ChannelTransport } from '../../packages/theo/src/client/channel-transport.js'

/**
 * M47 (ADR-M47-2, DoD 2) — the SAME handle drives all three surfaces: web via `handle.path` (HttpTransport,
 * tested in agent-handle.test.ts), TUI via `handle.inProcess(run)` (InProcessTransport), desktop via
 * `handle.channel(source)` (ChannelTransport). The binders are methods on the handle; they're dropped by
 * `JSON.stringify` so the handle's serializable `{ path }` core is preserved.
 */
describe('M47 — handle surface binders (one handle, three transports)', () => {
  const chat = agentHandle<{ message: string }>('/api/agents/chat')

  async function* emptyRun(): AsyncGenerator<UIMessageChunk> {
    // no chunks — the binder only needs to build the transport, not stream here.
  }

  it('test_handle_inProcess_returns_InProcessTransport', () => {
    const transport = chat.inProcess(emptyRun)
    expect(transport).toBeInstanceOf(InProcessTransport)
  })

  it('test_handle_channel_returns_ChannelTransport', () => {
    // A minimal ChannelPushSource: start() returns a teardown; no chunks delivered here.
    const source = { start: () => () => undefined }
    const transport = chat.channel(source)
    expect(transport).toBeInstanceOf(ChannelTransport)
  })

  it('test_binders_do_not_break_serializable_core', () => {
    // The methods are non-data — JSON keeps only { path }.
    expect(JSON.parse(JSON.stringify(chat))).toEqual({ path: '/api/agents/chat' })
  })
})
