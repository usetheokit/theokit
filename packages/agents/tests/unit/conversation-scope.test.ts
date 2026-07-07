/**
 * M11 (theokit-ai-first) — {resource, thread} conversation scoping.
 *
 * ADR-0040 § D2: mapping a request's (resource, thread) to a conversation id is a HOME concern
 * (auth/session → conversation), NOT the SDK's storage engine. `deriveConversationId` is a pure,
 * deterministic, collision-safe derivation so multi-tenant apps isolate history without hand-rolling
 * `user-${id}-thread-${id}` strings. Background compression stays SDK-side.
 *
 * TDD RED-first.
 */
import { describe, expect, it } from 'vitest'

import { deriveConversationId, parseConversationId } from '../../src/conversation-scope.js'

describe('deriveConversationId', () => {
  it('is deterministic for the same (resource, thread)', () => {
    expect(deriveConversationId('user-1', 'thread-a')).toBe(deriveConversationId('user-1', 'thread-a'))
  })

  it('isolates different resources and different threads', () => {
    const a = deriveConversationId('user-1', 't')
    const b = deriveConversationId('user-2', 't')
    const c = deriveConversationId('user-1', 'u')
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('is collision-safe when a value contains the separator character', () => {
    // Without encoding, ('a/b','c') and ('a','b/c') would collide. They must not.
    expect(deriveConversationId('a/b', 'c')).not.toBe(deriveConversationId('a', 'b/c'))
  })

  it('fails fast on an empty resource or thread', () => {
    expect(() => deriveConversationId('', 't')).toThrow(/resource/i)
    expect(() => deriveConversationId('r', '')).toThrow(/thread/i)
  })
})

describe('parseConversationId', () => {
  it('round-trips a derived id back to its (resource, thread)', () => {
    const id = deriveConversationId('user 1', 'thread/a')
    expect(parseConversationId(id)).toEqual({ resource: 'user 1', thread: 'thread/a' })
  })

  it('returns null for a value that is not a derived scope id', () => {
    expect(parseConversationId('not-a-scope')).toBeNull()
  })
})
