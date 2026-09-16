/**
 * The headless surface renders a patch as a patch — and says so when it truncates.
 *
 * `toolLine` was one generic line for every tool: `exec <name> <JSON.stringify(input).slice(0,200)>`.
 * For a read that is fine (`exec read_file {"path":"tax.mjs"}`). For `apply_patch` it collapses the
 * edit into escaped JSON on a single line, with literal `\n` where the diff's newlines were — the
 * one tool call a reader most wants to actually read.
 *
 * Two defects, and the second is the one that bites without being seen:
 *
 * 1. the patch is unreadable, while the TUI has rendered it properly all along
 *    (`formatToolHeader` → `Edited <files> (+N -M)`);
 * 2. `.slice(0, 200)` cuts a real multi-hunk patch mid-line and **says nothing** — the log shows half
 *    an edit and nothing marks the half that is missing. A truncation nobody can see is worse than a
 *    long line.
 */
import { describe, expect, it } from 'vitest'

import { toolLine } from '../../src/runtime/tool-line.js'

const PATCH = `*** Begin Patch
*** Update File: tax.mjs
@@
 export function applyTax(amount, rate) {
-  return (amount + amount) * rate
+  return amount + amount * rate
 }
*** End Patch`

describe('toolLine', () => {
  it('test_a_patch_renders_as_a_patch_not_as_escaped_json', () => {
    const out = toolLine({ toolName: 'apply_patch', input: { patch: PATCH } })

    expect(out, 'the diff body must survive as lines').toContain('-  return (amount + amount) * rate')
    expect(out).toContain('+  return amount + amount * rate')
    expect(out, 'escaped newlines mean it went through JSON.stringify').not.toContain('\\n')
  })

  it('test_a_truncated_patch_says_it_was_truncated', () => {
    // The silent half of the old behaviour. A reader seeing half an edit must be told it is half.
    const long = `*** Begin Patch\n${'+ a line that goes on\n'.repeat(400)}*** End Patch`
    const out = toolLine({ toolName: 'apply_patch', input: { patch: long } })

    expect(out).toMatch(/truncated/i)
    expect(out).toMatch(/\d+ more lines?/i)
  })

  it('test_a_short_patch_is_not_marked_truncated', () => {
    // Anti-vacuity: a formatter that always appended the notice would satisfy the case above.
    expect(toolLine({ toolName: 'apply_patch', input: { patch: PATCH } })).not.toMatch(/truncated/i)
  })

  it('test_every_other_tool_keeps_the_line_it_had', () => {
    // The generic line is right for the rest, and changing it would be scope this did not ask for.
    expect(toolLine({ toolName: 'read_file', input: { path: 'tax.mjs' } })).toBe(
      'exec read_file {"path":"tax.mjs"}',
    )
    expect(toolLine({ toolName: undefined, input: undefined })).toBe('exec tool {}')
  })

  it('test_a_patch_without_a_string_body_falls_back_to_the_generic_line', () => {
    // The input crosses from a model. A renderer that assumed the shape would throw on a turn that
    // is already going wrong.
    expect(toolLine({ toolName: 'apply_patch', input: { patch: 42 } })).toContain('exec apply_patch')
  })
})
