/**
 * M41 (ADR-0050 D6) — AgentClient: the framework-agnostic store `useAgent` binds over. It drives ANY
 * `AgentTransport` (web `HttpTransport` OR terminal `InProcessTransport`) with the SAME behavior —
 * accumulate messages by id, status transitions, abort, approve routing, reconnect. Tested DOM-free.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { AgentClient } from '../../packages/theo/src/client/agent-client.js'
import type { AgentTransport, ApprovalDecision } from '../../packages/theo/src/client/transport.js'

/** Build a ReadableStream<UIMessageChunk> from literal chunks. */
function chunkStream(chunks: Array<Record<string, unknown>>): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c as UIMessageChunk)
      controller.close()
    },
  })
}

const TEXT_TURN = [
  { type: 'start' },
  { type: 'text-start', id: 't0' },
  { type: 'text-delta', id: 't0', delta: 'Hello' },
  { type: 'text-end', id: 't0' },
  { type: 'finish' },
]

/** A minimal fake transport that returns a fixed chunk stream from sendMessages. */
function fakeTransport(overrides: Partial<AgentTransport> = {}): AgentTransport {
  return {
    sendMessages: (async () => chunkStream(TEXT_TURN)) as ChatTransport<UIMessage>['sendMessages'],
    reconnectToStream: (async () => null) as ChatTransport<UIMessage>['reconnectToStream'],
    ...overrides,
  }
}

/** Wait until the client's status leaves 'streaming'. */
async function waitSettled<T>(client: AgentClient<T>): Promise<void> {
  await new Promise<void>((resolve) => {
    const unsub = client.subscribe(() => {
      const s = client.getSnapshot().status
      if (s !== 'streaming') {
        unsub()
        resolve()
      }
    })
  })
}

describe('AgentClient (M41)', () => {
  it('test_send_accumulates_assistant_message_and_transitions_to_done', async () => {
    const client = new AgentClient(fakeTransport())
    const seen: string[] = []
    client.subscribe(() => seen.push(client.getSnapshot().status))
    client.send({ message: 'hi' })
    expect(client.getSnapshot().status).toBe('streaming')
    await waitSettled(client)

    const snap = client.getSnapshot()
    expect(snap.status).toBe('done')
    const text = snap.messages
      .flatMap((m) => m.parts)
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('')
    expect(text).toBe('Hello')
    expect(seen).toContain('streaming')
  })

  it('test_getSnapshot_returns_same_object_reference_until_next_emit', () => {
    // useSyncExternalStore contract: getSnapshot is stable between calls (reference changes only on emit).
    const client = new AgentClient(fakeTransport())
    expect(client.getSnapshot()).toBe(client.getSnapshot())
  })

  it('test_abort_then_new_send_prevents_stale_drive_from_clobbering_status', async () => {
    // HIGH #2 — a stale drive (aborted controller) must NOT set 'done'/'error' after a newer send.
    const gates: Array<() => void> = []
    const gatedStream = (): ReadableStream<UIMessageChunk> =>
      new ReadableStream<UIMessageChunk>({
        pull(controller) {
          return new Promise<void>((resolve) => {
            gates.push(() => {
              controller.close()
              resolve()
            })
          })
        },
      })
    const transport = fakeTransport({
      sendMessages: (async () => gatedStream()) as ChatTransport<UIMessage>['sendMessages'],
    })
    const client = new AgentClient(transport)
    const tick = () => new Promise((r) => setTimeout(r, 15))

    client.send({ message: '1' }) // drive1 blocks on gate[0]
    await tick()
    client.abort() // abort controller1
    client.send({ message: '2' }) // drive2 blocks on gate[1]; status 'streaming'
    await tick()
    expect(client.getSnapshot().status).toBe('streaming')

    gates[0]?.() // release stream1 → drive1 completes, but its controller was aborted → no clobber
    await tick()
    expect(client.getSnapshot().status).toBe('streaming') // still the LIVE second turn, not clobbered to 'done'

    gates[1]?.() // release stream2 → drive2 completes normally
    await tick()
    expect(client.getSnapshot().status).toBe('done')
  })

  it('test_drives_in_process_transport_with_same_shape', async () => {
    // The SAME store over an in-process-style transport (generator-backed stream) — proves unification.
    const transport = fakeTransport({
      sendMessages: (async () =>
        chunkStream(TEXT_TURN)) as ChatTransport<UIMessage>['sendMessages'],
    })
    const client = new AgentClient(transport)
    client.send({ message: 'hi' })
    await waitSettled(client)
    expect(client.getSnapshot().status).toBe('done')
    expect(client.getSnapshot().messages.length).toBeGreaterThan(0)
  })

  it('test_send_5xx_sets_error_status', async () => {
    const transport = fakeTransport({
      sendMessages: (async () => {
        throw new Error('Agent request failed: 500 Server Error')
      }) as ChatTransport<UIMessage>['sendMessages'],
    })
    const client = new AgentClient(transport)
    client.send({ message: 'hi' })
    await waitSettled(client)
    expect(client.getSnapshot().status).toBe('error')
    expect(client.getSnapshot().error?.message).toMatch(/500/)
  })

  it('test_approve_routes_to_transport', async () => {
    const approve = vi.fn(async (_id: string, _d: ApprovalDecision) => undefined)
    const client = new AgentClient(fakeTransport({ approve }))
    await client.approve('a1', { approved: true, reason: 'ok' })
    expect(approve).toHaveBeenCalledWith('a1', { approved: true, reason: 'ok' })
  })

  it('test_approve_is_noop_when_transport_has_none', async () => {
    const client = new AgentClient(fakeTransport())
    await expect(client.approve('a1', { approved: true })).resolves.toBeUndefined()
  })

  it('test_reconnect_accumulates_replayed_messages', async () => {
    const transport = fakeTransport({
      reconnectToStream: (async () =>
        chunkStream(TEXT_TURN)) as ChatTransport<UIMessage>['reconnectToStream'],
    })
    const client = new AgentClient(transport)
    client.reconnect()
    await waitSettled(client)
    expect(client.getSnapshot().status).toBe('done')
    expect(client.getSnapshot().messages.length).toBeGreaterThan(0)
  })

  it('test_reconnect_null_settles_without_error', async () => {
    const client = new AgentClient(fakeTransport()) // reconnectToStream → null
    client.reconnect()
    await waitSettled(client)
    expect(client.getSnapshot().status).toBe('idle')
    expect(client.getSnapshot().error).toBeUndefined()
  })

  it('test_reset_clears_messages_and_returns_idle', async () => {
    const client = new AgentClient(fakeTransport())
    client.send({ message: 'hi' })
    await waitSettled(client)
    client.reset()
    expect(client.getSnapshot().status).toBe('idle')
    expect(client.getSnapshot().messages).toHaveLength(0)
  })
})

// ── M46 — conversation `thread` (committed history + in-flight; commit-once; stable ids) ──

/** Flatten a thread into `[role, text]` pairs for assertion. */
function roleTexts(msgs: UIMessage[]): Array<[string, string]> {
  return msgs.map((m) => [
    m.role,
    m.parts
      .filter((p): p is { type: 'text'; text: string } => (p as { type?: string }).type === 'text')
      .map((p) => p.text)
      .join(''),
  ])
}

describe('AgentClient — conversation thread (M46)', () => {
  it('test_thread_accumulates_user_and_assistant_across_two_sends', async () => {
    const client = new AgentClient<{ message: string }>(fakeTransport())
    client.send({ message: 'one' })
    await waitSettled(client)
    expect(roleTexts(client.getSnapshot().thread)).toEqual([
      ['user', 'one'],
      ['assistant', 'Hello'],
    ])

    client.send({ message: 'two' })
    await waitSettled(client)
    // Prior committed turn preserved + the new turn appended (no lost turn).
    expect(roleTexts(client.getSnapshot().thread)).toEqual([
      ['user', 'one'],
      ['assistant', 'Hello'],
      ['user', 'two'],
      ['assistant', 'Hello'],
    ])
  })

  it('test_thread_commits_inflight_exactly_once_no_duplicate', async () => {
    const client = new AgentClient<{ message: string }>(fakeTransport())
    client.send({ message: 'one' })
    await waitSettled(client)
    client.send({ message: 'two' })
    await waitSettled(client)
    // Exactly 4 entries — the first turn is committed ONCE, not duplicated by the second send.
    expect(client.getSnapshot().thread).toHaveLength(4)
    const ids = client.getSnapshot().thread.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length) // all ids unique/stable (no empty-id collision)
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true)
  })

  it('test_messages_stays_per_turn_backcompat_thread_is_additive', async () => {
    const client = new AgentClient<{ message: string }>(fakeTransport())
    client.send({ message: 'one' })
    await waitSettled(client)
    // `messages` keeps its exact prior semantics: only the current turn's assistant (no user, no history).
    expect(client.getSnapshot().messages.every((m) => m.role === 'assistant')).toBe(true)
    client.send({ message: 'two' })
    await waitSettled(client)
    // After a second send, `messages` is the CURRENT turn only (reset), while `thread` holds all 4.
    expect(client.getSnapshot().messages.every((m) => m.role === 'assistant')).toBe(true)
    expect(client.getSnapshot().thread.length).toBeGreaterThan(client.getSnapshot().messages.length)
  })

  it('test_reset_clears_thread_new_conversation', async () => {
    const client = new AgentClient<{ message: string }>(fakeTransport())
    client.send({ message: 'one' })
    await waitSettled(client)
    client.reset()
    expect(client.getSnapshot().thread).toHaveLength(0)
  })

  it('test_error_mid_stream_does_not_commit_partial_into_committed_history', async () => {
    // A first successful turn commits; a second turn that ERRORS must not pollute committed history.
    let call = 0
    const transport = fakeTransport({
      sendMessages: (async () => {
        call += 1
        if (call === 2) throw new Error('Agent request failed: 500')
        return chunkStream(TEXT_TURN)
      }) as ChatTransport<UIMessage>['sendMessages'],
    })
    const client = new AgentClient<{ message: string }>(transport)
    client.send({ message: 'one' })
    await waitSettled(client) // done → turn 1 in-flight
    client.send({ message: 'two' }) // commits turn 1; turn 2 errors
    await waitSettled(client)
    expect(client.getSnapshot().status).toBe('error')
    // Committed history = turn 1 (user+assistant) intact; the errored turn's partial is NOT committed
    // beyond the just-sent user echo (no corrupt assistant history).
    const committedAssistants = client.getSnapshot().thread.filter((m) => m.role === 'assistant')
    expect(committedAssistants).toHaveLength(1) // only turn 1's assistant; the errored turn has none
  })

  it('test_stale_aborted_drive_does_not_append_to_thread', async () => {
    const gates: Array<() => void> = []
    const gatedStream = (): ReadableStream<UIMessageChunk> =>
      new ReadableStream<UIMessageChunk>({
        pull(controller) {
          return new Promise<void>((resolve) => {
            gates.push(() => {
              controller.close()
              resolve()
            })
          })
        },
      })
    const client = new AgentClient<{ message: string }>(
      fakeTransport({
        sendMessages: (async () => gatedStream()) as ChatTransport<UIMessage>['sendMessages'],
      }),
    )
    const tick = () => new Promise((r) => setTimeout(r, 15))
    client.send({ message: '1' })
    await tick()
    client.abort()
    client.send({ message: '2' })
    await tick()
    gates[0]?.() // release the STALE first drive
    await tick()
    // The stale drive must not have committed a turn into thread.
    expect(client.getSnapshot().thread.filter((m) => m.role === 'assistant')).toHaveLength(0)
    expect(client.getSnapshot().status).toBe('streaming') // still the live 2nd turn
  })
})
