/**
 * B-047 — a pasted API key is submitted without its surrounding whitespace.
 *
 * See `secret-buffer.ts` for why this is tested here rather than through the component.
 */
import { describe, expect, it } from 'vitest'

import { submittableSecret } from '../../src/components/secret-buffer.js'

describe('B-047 — the submitted secret carries no pasted whitespace', () => {
  it('test_an_ordinary_key_is_submitted_unchanged', () => {
    // Anti-vacuity floor: mangling every input would satisfy the assertions below.
    expect(submittableSecret('sk-ant-secret')).toBe('sk-ant-secret')
  })

  it('test_a_pasted_key_with_a_trailing_newline_is_trimmed', () => {
    expect(submittableSecret('sk-ant-secret\n'), 'the trailing newline reached login()').toBe(
      'sk-ant-secret',
    )
  })

  it('test_a_key_with_surrounding_spaces_is_trimmed', () => {
    expect(submittableSecret('  sk-ant-secret  ')).toBe('sk-ant-secret')
  })

  it('test_a_blank_buffer_submits_nothing', () => {
    // Whitespace only is not a secret. The component cancels on `undefined` rather than storing it.
    expect(submittableSecret('   ')).toBe(undefined)
    expect(submittableSecret('')).toBe(undefined)
  })

  // The pasted-newline case moved to `@theokit/tui@0.53.0`: `FreeTextInput mask` strips newlines on
  // insert, and asserts it there with an EXACT mask-length count. Keeping a copy of the assertion
  // here would test a function this package no longer owns.
})
