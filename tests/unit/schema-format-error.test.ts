/**
 * RED tests for G5 T1.3 — formatError hook in theoConfigSchema
 *
 * Per plan g5-error-envelope-cross-layer v1.0 § Phase 1 / T1.3.
 * Blueprint ADR D3 — trpc errorFormatter ergonomic pattern; type-inferred.
 */
import { describe, expect, it } from 'vitest'

import { theoConfigSchema } from '../../packages/theo/src/config/schema.js'
import type { TheoErrorEnvelope } from '../../packages/theo/src/core/contracts/error-envelope.js'

describe('theoConfigSchema.formatError (G5 T1.3)', () => {
  it('should accept a function transforming the envelope', () => {
    // Given: a config with a formatError function that adds a hint extension
    const config = theoConfigSchema.parse({
      formatError: (env: TheoErrorEnvelope) => ({
        ...env,
        ext: { ...((env.ext as Record<string, unknown>) ?? {}), hint: 'see docs' },
      }),
    })

    // Then: the function is preserved and callable
    expect(typeof config.formatError).toBe('function')
    const transformed = config.formatError?.(
      {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'boom',
      },
      {},
    ) as TheoErrorEnvelope<{ hint: string }>
    expect(transformed?.ext?.hint).toBe('see docs')
  })

  it('should default formatError to undefined when omitted', () => {
    // Given: a config with no formatError hook
    const config = theoConfigSchema.parse({})

    // Then: formatError is undefined (identity behavior at consumer)
    expect(config.formatError).toBeUndefined()
  })

  it('should reject non-function formatError values', () => {
    // Given: a config passing a non-function value
    const result = theoConfigSchema.safeParse({ formatError: 'not-a-function' })

    // Then: Zod rejects the input
    expect(result.success).toBe(false)
  })
})
