/**
 * RED tests for T5.1 — devtools ActionCallRecord + PII masking + reducer.
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 5 / T5.1 + ADR D7.
 * EC absorbed: EC-12 (PII mask heuristic).
 */
import { describe, expect, it } from 'vitest'

import { type ActionCallRecord, initialState } from '../../packages/theo/src/devtools/shared.js'
import { devtoolsReducer } from '../../packages/theo/src/devtools/state/reducer.js'
import { maskPiiFields } from '../../packages/theo/src/devtools/format/pii-mask.js'

describe('devtools — ActionCallRecord shape', () => {
  it('should be present in initialState as actionCalls: []', () => {
    expect(initialState.actionCalls).toEqual([])
  })

  it('should accept a well-formed record via ACTION_CALL_ADD', () => {
    const rec: ActionCallRecord = {
      id: 'a1',
      timestamp: 1717000000000,
      name: 'createUser',
      input: { name: 'Alice', email: 'a@b.com' },
      output: { id: '1' },
      durationMs: 12,
      status: 'success',
    }
    const next = devtoolsReducer(initialState, { type: 'ACTION_CALL_ADD', record: rec })
    expect(next.actionCalls).toHaveLength(1)
    expect(next.actionCalls[0]).toEqual(rec)
  })

  it('should ring-buffer cap at RING_BUFFER_CAP (50)', () => {
    let state = initialState
    for (let i = 0; i < 60; i++) {
      const rec: ActionCallRecord = {
        id: `a${i}`,
        timestamp: i,
        name: 'noop',
        input: {},
        durationMs: 1,
        status: 'success',
      }
      state = devtoolsReducer(state, { type: 'ACTION_CALL_ADD', record: rec })
    }
    expect(state.actionCalls).toHaveLength(50)
    // appendCapped convention: newest at index 0; eviction drops oldest.
    expect(state.actionCalls[0].id).toBe('a59')
    expect(state.actionCalls[49].id).toBe('a10')
  })

  it('should clear on RESET_ACTION_CALLS', () => {
    const rec: ActionCallRecord = {
      id: 'a1',
      timestamp: 1,
      name: 'x',
      input: {},
      durationMs: 1,
      status: 'success',
    }
    const populated = devtoolsReducer(initialState, { type: 'ACTION_CALL_ADD', record: rec })
    const cleared = devtoolsReducer(populated, { type: 'RESET_ACTION_CALLS' })
    expect(cleared.actionCalls).toEqual([])
  })
})

// Fake test marker — using a constant avoids sonarjs/no-hardcoded-passwords
// triggering on literal "password" / "secret" / etc. fields in test fixtures.
const FAKE = '__TEST_FIXTURE_VALUE__'

describe('devtools — PII mask heuristic (EC-12 + ADR D7)', () => {
  it('should mask common sensitive field names', () => {
    const masked = maskPiiFields({
      name: 'Alice',
      password: FAKE,
      token: FAKE,
      apiKey: FAKE,
      api_key: FAKE,
      secret: FAKE,
      credit_card: FAKE,
      ssn: FAKE,
      cpf: FAKE,
      cnpj: FAKE,
    }) as Record<string, unknown>
    expect(masked.name).toBe('Alice')
    expect(masked.password).toBe('***')
    expect(masked.token).toBe('***')
    expect(masked.apiKey).toBe('***')
    expect(masked.api_key).toBe('***')
    expect(masked.secret).toBe('***')
    expect(masked.credit_card).toBe('***')
    expect(masked.ssn).toBe('***')
    expect(masked.cpf).toBe('***')
    expect(masked.cnpj).toBe('***')
  })

  it('should be case-insensitive', () => {
    const masked = maskPiiFields({ PASSWORD: FAKE, Token: FAKE, APIKey: FAKE }) as Record<
      string,
      unknown
    >
    expect(masked.PASSWORD).toBe('***')
    expect(masked.Token).toBe('***')
    expect(masked.APIKey).toBe('***')
  })

  it('should pass-through non-sensitive primitives', () => {
    expect(maskPiiFields({ count: 42, ok: true, label: 'X' })).toEqual({
      count: 42,
      ok: true,
      label: 'X',
    })
  })

  it('should handle non-object input gracefully (pass-through)', () => {
    expect(maskPiiFields(null)).toBe(null)
    expect(maskPiiFields(undefined)).toBe(undefined)
    expect(maskPiiFields('plain string')).toBe('plain string')
    expect(maskPiiFields(42)).toBe(42)
  })

  it('should walk nested objects', () => {
    const masked = maskPiiFields({
      user: { name: 'Alice', password: FAKE },
      meta: { token: FAKE },
    }) as Record<string, Record<string, unknown>>
    expect(masked.user.name).toBe('Alice')
    expect(masked.user.password).toBe('***')
    expect(masked.meta.token).toBe('***')
  })

  it('should handle arrays of objects', () => {
    const masked = maskPiiFields({
      users: [
        { name: 'A', password: FAKE },
        { name: 'B', password: FAKE },
      ],
    }) as { users: Array<{ name: string; password: string }> }
    expect(masked.users[0].password).toBe('***')
    expect(masked.users[1].password).toBe('***')
    expect(masked.users[0].name).toBe('A')
  })

  it('should expose isSensitiveKey helper', async () => {
    const { isSensitiveKey } = await import('../../packages/theo/src/devtools/format/pii-mask.js')
    expect(isSensitiveKey('password')).toBe(true)
    expect(isSensitiveKey('PASSWORD')).toBe(true)
    expect(isSensitiveKey('userPassword')).toBe(true)
    expect(isSensitiveKey('tokenize')).toBe(true) // known false positive — documented
    expect(isSensitiveKey('name')).toBe(false)
    expect(isSensitiveKey('id')).toBe(false)
  })
})
