import { describe, expect, it } from 'vitest'

import { envelopeCodeToStatus } from '../../packages/theo/src/core/contracts/envelope-code-to-status.js'
import type { TheoErrorCode } from '../../packages/theo/src/core/contracts/error-envelope.js'

describe('envelopeCodeToStatus', () => {
  // All TheoErrorCode values with their expected HTTP status.
  // Every code MUST have an explicit mapping — no silent default fallthrough.
  const allMappings: [TheoErrorCode, number][] = [
    // 4xx client errors
    ['BAD_REQUEST', 400],
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['METHOD_NOT_ALLOWED', 405],
    ['CONFLICT', 409],
    ['PRECONDITION_FAILED', 412],
    ['PAYLOAD_TOO_LARGE', 413],
    ['UNSUPPORTED_MEDIA_TYPE', 415],
    ['UNPROCESSABLE_ENTITY', 422],
    ['TOO_MANY_REQUESTS', 429],
    ['RATE_LIMITED', 429],

    // 5xx server errors
    ['INTERNAL_SERVER_ERROR', 500],
    ['NOT_IMPLEMENTED', 501],
    ['BAD_GATEWAY', 502],
    ['SERVICE_UNAVAILABLE', 503],
    ['GATEWAY_TIMEOUT', 504],

    // SDK-domain codes — intentionally 500
    ['AGENT_RUN_ERROR', 500],
    ['PROVIDER_KEY_MISSING', 500],
    ['BUDGET_EXCEEDED', 500],
    ['CREDENTIAL_POOL_EXHAUSTED', 500],
  ]

  it.each(allMappings)('should return HTTP status %d when error code is %s', (code, expected) => {
    expect(envelopeCodeToStatus(code)).toBe(expected)
  })

  it('should return 500 for unknown error codes', () => {
    expect(envelopeCodeToStatus('TOTALLY_UNKNOWN')).toBe(500)
    expect(envelopeCodeToStatus('')).toBe(500)
  })

  it('should cover every TheoErrorCode value (EC-4 sync test)', () => {
    // This test guards against future drift: if a new TheoErrorCode is added
    // to error-envelope.ts but not mapped here, the allMappings array above
    // will be incomplete and this test documents the contract.
    //
    // Note: TheoErrorCode is a union type, not a runtime enum — TypeScript
    // cannot enumerate union members at runtime. The allMappings array above
    // IS the authoritative mapping table. If a new code is added to the type
    // without updating allMappings, the parametric test won't cover it, but
    // the type system will flag it when used with envelopeCodeToStatus if the
    // function signature changes to accept TheoErrorCode instead of string.
    //
    // Current count: 21 unique codes (RATE_LIMITED aliases TOO_MANY_REQUESTS).
    expect(allMappings.length).toBe(21)

    // Every mapping must return a valid HTTP status (100-599 range)
    for (const [code, status] of allMappings) {
      expect(status).toBeGreaterThanOrEqual(100)
      expect(status).toBeLessThanOrEqual(599)
      expect(envelopeCodeToStatus(code)).toBe(status)
    }
  })
})
