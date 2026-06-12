import { describe, expect, it } from 'vitest'

import { envelopeCodeToStatus } from '../../packages/theo/src/core/contracts/envelope-code-to-status.js'

describe('envelopeCodeToStatus', () => {
  const knownMappings: [string, number][] = [
    ['BAD_REQUEST', 400],
    ['UNAUTHORIZED', 401],
    ['FORBIDDEN', 403],
    ['NOT_FOUND', 404],
    ['METHOD_NOT_ALLOWED', 405],
    ['PAYLOAD_TOO_LARGE', 413],
    ['UNPROCESSABLE_ENTITY', 422],
    ['TOO_MANY_REQUESTS', 429],
    ['RATE_LIMITED', 429],
    ['BAD_GATEWAY', 502],
    ['SERVICE_UNAVAILABLE', 503],
    ['GATEWAY_TIMEOUT', 504],
    ['INTERNAL_SERVER_ERROR', 500],
  ]

  it.each(knownMappings)('should map %s to %d', (code, expected) => {
    expect(envelopeCodeToStatus(code)).toBe(expected)
  })

  it('should return 500 for unknown error codes', () => {
    expect(envelopeCodeToStatus('TOTALLY_UNKNOWN')).toBe(500)
    expect(envelopeCodeToStatus('')).toBe(500)
  })
})
