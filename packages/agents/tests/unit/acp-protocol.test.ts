/**
 * M17 (theokit-ai-first) — ACP (Agent Client Protocol) stdio framing.
 *
 * ACP talks to a coding agent (Claude Code, Amp, Codex) over stdio as newline-delimited JSON.
 * The transport-agnostic CORE — encoding a message and decoding a byte stream that may split a
 * JSON object across chunks — is pure and testable here. The actual subprocess spawn is a Node
 * API and lives in the adapter layer (G8) / SDK, not in `packages/agents`.
 *
 * TDD RED-first.
 */
import { describe, expect, it } from 'vitest'

import { AcpMessageDecoder, encodeAcpMessage } from '../../src/acp/protocol.js'

describe('encodeAcpMessage', () => {
  it('serializes to a single JSON line terminated by a newline', () => {
    expect(encodeAcpMessage({ method: 'ping', id: 1 })).toBe('{"method":"ping","id":1}\n')
  })
})

describe('AcpMessageDecoder', () => {
  it('decodes multiple whole messages from one chunk', () => {
    const d = new AcpMessageDecoder()
    const msgs = d.push('{"a":1}\n{"b":2}\n')
    expect(msgs).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('buffers a message split across chunks and emits it once complete', () => {
    const d = new AcpMessageDecoder()
    expect(d.push('{"hello":"wor')).toEqual([]) // partial — nothing yet
    expect(d.push('ld"}\n')).toEqual([{ hello: 'world' }]) // completed
  })

  it('handles a chunk containing one whole message and a partial next one', () => {
    const d = new AcpMessageDecoder()
    expect(d.push('{"n":1}\n{"n":2')).toEqual([{ n: 1 }])
    expect(d.push('}\n')).toEqual([{ n: 2 }])
  })

  it('ignores blank lines between messages', () => {
    const d = new AcpMessageDecoder()
    expect(d.push('{"a":1}\n\n{"b":2}\n')).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('throws on a completed line that is not valid JSON (fail-fast, typed)', () => {
    const d = new AcpMessageDecoder()
    expect(() => d.push('not json\n')).toThrow(/ACP/i)
  })
})
