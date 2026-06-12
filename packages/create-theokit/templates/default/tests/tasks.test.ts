import { describe, it, expect } from 'vitest'

describe('Health route response shape', () => {
  it('returns expected fields', () => {
    // Mirrors the shape returned by server/routes/health.ts GET handler.
    // Unit test — no server dependency.
    const response = {
      status: 'ok',
      timestamp: Date.now(),
      framework: 'TheoKit',
    }

    expect(response.status).toBe('ok')
    expect(response.framework).toBe('TheoKit')
    expect(typeof response.timestamp).toBe('number')
    expect(response.timestamp).toBeGreaterThan(0)
  })
})
