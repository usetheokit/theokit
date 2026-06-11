/**
 * RED tests for T0.1 — core/contracts/action-protocol.ts
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 0 / T0.1.
 * EC absorbed: EC-1 (zod v3+v4), EC-7 (root path empty key), EC-8 (array
 * index dot-notation), EC-13 (dot vs bracket — implemented as dot).
 */
import { describe, expectTypeOf, it, expect } from 'vitest'

import {
  ActionError,
  ActionInputError,
  type ActionResult,
  extractUniversalIssues,
  isActionError,
  isInputError,
  type SerializedActionResult,
  type UniversalZodIssue,
} from '../../packages/theo/src/core/contracts/action-protocol.js'

describe('ActionError.codeToStatus', () => {
  it('should map VALIDATION_ERROR code to status 422', () => {
    expect(ActionError.codeToStatus('VALIDATION_ERROR')).toBe(422)
  })

  it('should map UNAUTHORIZED code to status 401', () => {
    expect(ActionError.codeToStatus('UNAUTHORIZED')).toBe(401)
  })

  // EC-3 — symmetric size-limit codes
  it('should map PAYLOAD_TOO_LARGE code to status 413', () => {
    expect(ActionError.codeToStatus('PAYLOAD_TOO_LARGE')).toBe(413)
  })
})

describe('ActionInputError.fields', () => {
  it('should build fields map from single-level path', () => {
    const issues: UniversalZodIssue[] = [{ path: ['email'], message: 'Invalid email' }]
    const err = new ActionInputError(issues)
    expect(err.fields).toEqual({ email: ['Invalid email'] })
  })

  it('should preserve full dot-path for nested fields', () => {
    // D6 + EC-13: nested zod schemas use full dot-notation (NOT just path[0])
    const issues: UniversalZodIssue[] = [{ path: ['user', 'address', 'zip'], message: 'Required' }]
    const err = new ActionInputError(issues)
    expect(err.fields).toEqual({ 'user.address.zip': ['Required'] })
  })

  // EC-8 — array index segments encoded as dot-notation strings (not bracket)
  it('should encode array index as dot-notation string segment', () => {
    const issues: UniversalZodIssue[] = [
      { path: ['items', 0, 'name'], message: 'Required' },
      { path: ['items', 2, 'name'], message: 'Required' },
    ]
    const err = new ActionInputError(issues)
    expect(err.fields).toEqual({
      'items.0.name': ['Required'],
      'items.2.name': ['Required'],
    })
  })

  // EC-7 — root-level error uses empty string key
  it('should use empty string key for root-level errors', () => {
    const issues: UniversalZodIssue[] = [{ path: [], message: 'Root level rejection' }]
    const err = new ActionInputError(issues)
    expect(err.fields).toEqual({ '': ['Root level rejection'] })
  })

  it('should dedupe duplicate (path, message) tuples', () => {
    const issues: UniversalZodIssue[] = [
      { path: ['email'], message: 'Invalid' },
      { path: ['email'], message: 'Invalid' }, // duplicate
      { path: ['email'], message: 'Required' }, // different message — kept
    ]
    const err = new ActionInputError(issues)
    expect(err.fields).toEqual({ email: ['Invalid', 'Required'] })
  })

  // EC-1 — accept zod v3 ZodIssue shape
  it('should accept zod v3 ZodIssue shape', () => {
    // Duck-typed; v3 issue minimum surface: { path, message }
    const v3LikeIssue = {
      path: ['name'],
      message: 'Required',
      code: 'invalid_type',
      expected: 'string',
      received: 'undefined',
    }
    const err = new ActionInputError([v3LikeIssue] as unknown[])
    expect(err.fields).toEqual({ name: ['Required'] })
    expect(err.issues).toHaveLength(1)
  })

  // EC-1 — accept zod v4 $ZodIssue shape (different code/input fields)
  it('should accept zod v4 $ZodIssue shape', () => {
    const v4LikeIssue = {
      path: ['email'],
      message: 'Invalid email',
      code: 'invalid_format',
      format: 'email',
      input: 'not-an-email',
    }
    const err = new ActionInputError([v4LikeIssue] as unknown[])
    expect(err.fields).toEqual({ email: ['Invalid email'] })
    expect(err.issues).toHaveLength(1)
  })
})

describe('extractUniversalIssues', () => {
  // EC-1 — normalize both shapes to UniversalZodIssue[]
  it('should normalize zod v3 and v4 issue shapes to UniversalZodIssue[]', () => {
    const v3 = { path: ['a'], message: 'A required', code: 'invalid_type' }
    const v4 = { path: ['b'], message: 'B invalid', code: 'invalid_format' }
    const normalized = extractUniversalIssues([v3, v4])
    expect(normalized).toHaveLength(2)
    expect(normalized[0].path).toEqual(['a'])
    expect(normalized[0].message).toBe('A required')
    expect(normalized[1].path).toEqual(['b'])
    expect(normalized[1].message).toBe('B invalid')
  })

  it('should return empty array on null/undefined/non-array input', () => {
    expect(extractUniversalIssues(null)).toEqual([])
    expect(extractUniversalIssues(undefined)).toEqual([])
    expect(extractUniversalIssues('not an array')).toEqual([])
    expect(extractUniversalIssues({})).toEqual([])
  })

  it('should skip entries missing required {path, message}', () => {
    const mixed = [
      { path: ['ok'], message: 'good' },
      { not: 'a', valid: 'issue' },
      null,
      { path: ['no-msg'] }, // missing message
      { message: 'no path' }, // missing path
    ]
    expect(extractUniversalIssues(mixed)).toEqual([{ path: ['ok'], message: 'good' }])
  })
})

describe('isInputError type guard', () => {
  it('should narrow type via isInputError guard', () => {
    const inputErr: unknown = new ActionInputError([{ path: ['x'], message: 'bad' }])
    const generalErr: unknown = new ActionError({ code: 'UNAUTHORIZED' })

    expect(isInputError(inputErr)).toBe(true)
    expect(isInputError(generalErr)).toBe(false)
    expect(isInputError(new Error('plain'))).toBe(false)
    expect(isInputError(null)).toBe(false)
    expect(isInputError({ type: 'TheoActionInputError' })).toBe(false) // duck-type alone insufficient

    if (isInputError(inputErr)) {
      // Type narrowing — TS should infer ActionInputError here
      expectTypeOf(inputErr.fields).toEqualTypeOf<Record<string, string[]>>()
      expect(Array.isArray(inputErr.issues)).toBe(true)
    }
  })
})

describe('ActionError.fromJson', () => {
  it('should distinguish input vs general error in fromJson', () => {
    const inputJson = {
      type: 'TheoActionInputError',
      code: 'VALIDATION_ERROR',
      message: 'bad input',
      issues: [{ path: ['x'], message: 'bad' }],
    }
    const generalJson = {
      type: 'TheoActionError',
      code: 'UNAUTHORIZED',
      message: 'auth missing',
    }

    const parsedInput = ActionError.fromJson(inputJson)
    const parsedGeneral = ActionError.fromJson(generalJson)

    expect(parsedInput).toBeInstanceOf(ActionInputError)
    expect(isInputError(parsedInput)).toBe(true)
    expect(parsedGeneral).toBeInstanceOf(ActionError)
    expect(isInputError(parsedGeneral)).toBe(false)
    expect(parsedGeneral.code).toBe('UNAUTHORIZED')
  })

  it('should fall back to INTERNAL_SERVER_ERROR on malformed body', () => {
    const bad = ActionError.fromJson('not an object')
    expect(bad).toBeInstanceOf(ActionError)
    expect(bad.code).toBe('INTERNAL_SERVER_ERROR')

    const empty = ActionError.fromJson({})
    expect(empty).toBeInstanceOf(ActionError)
    expect(empty.code).toBe('INTERNAL_SERVER_ERROR')

    const noType = ActionError.fromJson({ code: 'NOT_VALID' })
    expect(noType).toBeInstanceOf(ActionError)
    expect(noType.code).toBe('INTERNAL_SERVER_ERROR')
  })
})

describe('isActionError type guard', () => {
  it('should recognize both ActionError and ActionInputError', () => {
    expect(isActionError(new ActionError({ code: 'NOT_FOUND' }))).toBe(true)
    expect(isActionError(new ActionInputError([{ path: ['x'], message: 'y' }]))).toBe(true)
    expect(isActionError(new Error('plain'))).toBe(false)
    expect(isActionError(null)).toBe(false)
  })
})

describe('Discriminated unions', () => {
  it('should accept ActionResult with data', () => {
    const ok: ActionResult<{ id: number }> = { data: { id: 1 }, error: undefined }
    expect(ok.data?.id).toBe(1)
  })

  it('should accept SerializedActionResult variants', () => {
    const data: SerializedActionResult = {
      type: 'data',
      status: 200,
      contentType: 'application/json+devalue',
      body: '"hello"',
    }
    const empty: SerializedActionResult = { type: 'empty', status: 204 }
    const error: SerializedActionResult = {
      type: 'error',
      status: 422,
      contentType: 'application/json',
      body: '{"type":"TheoActionError","code":"VALIDATION_ERROR"}',
    }
    expect(data.type).toBe('data')
    expect(empty.type).toBe('empty')
    expect(error.type).toBe('error')
  })
})
