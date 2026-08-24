import { describe, expect, it } from 'vitest'

import { AgentClient } from '../../src/client/agent-client.js'

/**
 * B-015 / usetheokit/theokit#364 — a conversation did not survive a reload.
 *
 * `#chatId` was initialised in the field declaration as `crypto.randomUUID()`, so
 * every `new AgentClient(...)` drew a fresh one, and the class offered no way to
 * supply one or to read the one it drew. The id is not decorative: the HTTP
 * transport sends it as the top-level `id`, which the server reads as the
 * session id (`client/http-transport.ts:88-92`). A new id is a new conversation,
 * so reloading the page silently abandoned the thread on the server.
 *
 * Both halves are needed and neither is sufficient. Reading without supplying
 * lets an application persist an id it can never restore; supplying without
 * reading means it has nothing to persist.
 */

const inertTransport = (): unknown => ({
  sendMessages: () => Promise.resolve(new ReadableStream({ start: (c) => c.close() })),
})

describe('a conversation can be resumed across a reload (B-015)', () => {
  it('test_the_drawn_id_is_readable', () => {
    const client = new AgentClient(inertTransport() as never)

    // Without this an application cannot persist what it would later restore.
    expect(client.chatId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i)
  })

  it('test_a_supplied_id_is_used_rather_than_a_fresh_one', () => {
    const client = new AgentClient(inertTransport() as never, undefined, {
      chatId: 'conversation-42',
    })

    expect(client.chatId).toBe('conversation-42')
  })

  it('test_two_clients_restored_from_one_id_agree', () => {
    // The reload, expressed: a second client built from the persisted id is the
    // same conversation as far as the server is concerned.
    const first = new AgentClient(inertTransport() as never)
    const restored = new AgentClient(inertTransport() as never, undefined, {
      chatId: first.chatId,
    })

    expect(restored.chatId).toBe(first.chatId)
  })

  it('test_two_clients_with_no_id_are_different_conversations', () => {
    // The default must stay a fresh draw — otherwise two unrelated tabs would
    // share a thread, which is the opposite defect.
    const a = new AgentClient(inertTransport() as never)
    const b = new AgentClient(inertTransport() as never)

    expect(a.chatId).not.toBe(b.chatId)
  })
})
