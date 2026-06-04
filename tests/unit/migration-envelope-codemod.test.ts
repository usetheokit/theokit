/**
 * RED tests for G5 T3.2 — migration codemod
 *
 * Per plan g5-error-envelope-cross-layer v1.0 § Phase 3 / T3.2.
 * Acceptance: rewrites the documented patterns, idempotent, preserves
 * unknown error names + non-pattern matches.
 */
import { describe, expect, it } from 'vitest'

// @ts-expect-error — .mjs imports without typed declarations
import { applyMigration } from '../../scripts/migrations/envelope-0-2-to-0-4.mjs'

describe('envelope-0-2-to-0-4 codemod (G5 T3.2)', () => {
  it("rewrites err.name === 'AuthRequiredError' to envelope code UNAUTHORIZED", () => {
    // Given: legacy class-identity check on the server-throwing class
    const input = `if (err.name === 'AuthRequiredError') { return 401; }`

    // When: codemod applied
    const { source, count } = applyMigration(input)

    // Then: envelope-aware check emitted; one rewrite counted
    expect(source).toBe(`if (err.envelope.code === 'UNAUTHORIZED') { return 401; }`)
    expect(count).toBe(1)
  })

  it("rewrites err.name === 'FileTooLargeError' to PAYLOAD_TOO_LARGE", () => {
    // Given: file-too-large legacy check
    const input = `if (e.name === "FileTooLargeError") throw e;`

    // Then: rewritten with envelope code and preserved quote style
    const { source } = applyMigration(input)
    expect(source).toContain(`e.envelope.code === "PAYLOAD_TOO_LARGE"`)
  })

  it('rewrites SDK class names (AuthenticationError / RateLimitError / BudgetExceededError)', () => {
    // Given: a function with multiple SDK identity checks
    const input = [
      `if (err.name === 'AuthenticationError') return 'unauth';`,
      `if (err.name === 'RateLimitError') return 'slow-down';`,
      `if (err.name === 'BudgetExceededError') return 'too-spendy';`,
    ].join('\n')

    // When: codemod applied
    const { source, count } = applyMigration(input)

    // Then: all 3 rewrites
    expect(count).toBe(3)
    expect(source).toContain('UNAUTHORIZED')
    expect(source).toContain('RATE_LIMITED')
    expect(source).toContain('BUDGET_EXCEEDED')
  })

  it("preserves chained identifier access (e.g., e.cause.name === 'X')", () => {
    // Given: a chained-access check
    const input = `if (e.cause.name === 'AuthRequiredError') return 1;`

    // Then: chained access preserved on the LHS
    const { source } = applyMigration(input)
    expect(source).toBe(`if (e.cause.envelope.code === 'UNAUTHORIZED') return 1;`)
  })

  it('preserves loose equality (==) when present', () => {
    // Given: a loose-equality check (uncommon but possible)
    const input = `if (err.name == 'AuthRequiredError') return 401;`

    // Then: operator preserved
    const { source } = applyMigration(input)
    expect(source).toBe(`if (err.envelope.code == 'UNAUTHORIZED') return 401;`)
  })

  it('ignores unknown class names (no rewrite, count = 0)', () => {
    // Given: a check against a class NOT in the migration map
    const input = `if (err.name === 'MyOwnCustomError') return 1;`

    // Then: nothing changes
    const { source, count } = applyMigration(input)
    expect(source).toBe(input)
    expect(count).toBe(0)
  })

  it('is idempotent — running on already-migrated source produces zero rewrites', () => {
    // Given: source that was already migrated
    const input = `if (err.envelope.code === 'UNAUTHORIZED') return 1;`

    // When: codemod applied again
    const { source, count } = applyMigration(input)

    // Then: zero rewrites and source unchanged
    expect(source).toBe(input)
    expect(count).toBe(0)
  })

  it('preserves backtick template strings as the quote style', () => {
    // Given: a backtick-quoted class name (uncommon but valid TS)
    const input = 'if (err.name === `AuthRequiredError`) return 1;'

    // Then: quote style preserved
    const { source } = applyMigration(input)
    expect(source).toBe('if (err.envelope.code === `UNAUTHORIZED`) return 1;')
  })
})
