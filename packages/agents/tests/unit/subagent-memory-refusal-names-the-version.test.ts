/**
 * An SDK that refuses `memory:` should say so, not send the author to fix their frontmatter.
 *
 * ## The measurement behind it
 *
 * Loading a real subagent out of `.theokit/agents/` against the published tarballs, 2026-09-16,
 * with a control (a second subagent declaring no `memory:`, which must load on every version):
 *
 *   5.3.0  ConfigurationError: Subagent note-taker.md: unknown frontmatter field "memory"
 *          (accepted: name, description, model, tools, reasoning_effort, mcp, sandbox)
 *   5.9.0  loads both; `memory: "project"` survives the parse
 *
 * The failure is LOUD. What is wrong is where it points: it names the field and the accepted keys,
 * so a reader concludes their frontmatter is wrong rather than their SDK too old, and deletes the
 * line they meant to write.
 *
 * ## Why this is not a floor bump
 *
 * Raising `^5.3.0` to `^5.9.0` was tried first and reverted.
 * `the-declared-sdk-range-delivers-what-the-code-assumes.test.ts` refuses a floor past 5.4 and
 * gives the reason: a version gap that announces itself is guarded, not closed by the range,
 * because closing it strands every consumer — including the ones who never write `memory:` — to
 * duplicate a refusal they would already have received. That policy is right, and this is the
 * missing half of it: the refusal did not announce itself usefully until now.
 */
import { describe, expect, it } from 'vitest'

import { explainSubagentMemoryRefusal } from '../../src/bridge/sdk-adapter-create-options.js'

const refusal = (): Error =>
  new Error(
    'Subagent note-taker.md: unknown frontmatter field "memory" ' +
      '(accepted: name, description, model, tools, reasoning_effort, mcp, sandbox)',
  )

describe('a memory: refusal from an older SDK names the version', () => {
  it('test_an_old_sdk_refusing_memory_is_rewritten_to_name_the_version', () => {
    const out = explainSubagentMemoryRefusal(refusal(), '5.3.0')
    expect(out).toBeInstanceOf(Error)
    expect(
      (out as Error).message,
      'the version the field landed in must be in the message',
    ).toMatch(/5\.9\.0/)
    expect((out as Error).message, 'and the repair must be the upgrade').toMatch(/Upgrade @theokit/)
  })

  it('test_a_new_sdk_leaves_an_unknown_field_error_alone', () => {
    // The operator really did mistype something on 5.9.0, and telling them to upgrade would send
    // them away from the actual typo.
    const original = refusal()
    expect(explainSubagentMemoryRefusal(original, '5.9.0')).toBe(original)
  })

  it('test_an_unrelated_error_on_an_old_sdk_is_left_alone', () => {
    // The version alone must not re-label every parse failure. A missing `description` on 5.3.0 is
    // a real frontmatter error and the SDK's message is the right one.
    const original = new Error('Subagent x.md: unknown frontmatter field "descriptoin"')
    expect(explainSubagentMemoryRefusal(original, '5.3.0')).toBe(original)
  })

  it('test_an_unreadable_version_is_not_diagnosed', () => {
    // The opposite asymmetry from the two guards beside it, and deliberate: they refuse on "cannot
    // tell" because passing an option blind is unsafe. This one only rewrites a message, and
    // asserting a cause we could not read the version for is a fabricated diagnosis.
    const original = refusal()
    expect(explainSubagentMemoryRefusal(original, undefined)).toBe(original)
  })
})
