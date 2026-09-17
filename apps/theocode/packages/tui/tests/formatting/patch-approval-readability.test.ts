// What the operator reads before approving a patch.
//
// The approval put the RAW V4A body into `description`, so the prompt showed `*** Begin Patch`,
// `*** Update File:` and `*** End Patch` — envelope markers that carry nothing for the person
// deciding — while the lines that matter had no per-file heading and no position. Observed
// 2026-09-15 in a side-by-side run where the other two agents rendered the same change as a diff
// with a file heading and numbered context, and this one showed the envelope.
//
// The decision is "do I want this edit". The envelope is the part that never helps make it.

import { describe, expect, it } from 'vitest'

import { formatApproval } from '../../src/formatting/tool-header.js'

const PATCH = `*** Begin Patch
*** Update File: packages/agent/src/discount.ts
@@ export function applyDiscount
-  return price - price * percent
+  return price - price * (percent / 100)
*** End Patch`

function describePatch(patch: string): string {
  return formatApproval({ toolName: 'ApplyPatch', input: { patch } }).description ?? ''
}

describe('formatApproval — apply_patch', () => {
  it('drops the V4A envelope markers, which carry nothing for the decision', () => {
    const d = describePatch(PATCH)
    expect(d).not.toContain('*** Begin Patch')
    expect(d).not.toContain('*** End Patch')
    expect(d).not.toContain('*** Update File:')
  })

  it('heads each file with its path and the verb, so the target is never guessed', () => {
    expect(describePatch(PATCH)).toContain('Update packages/agent/src/discount.ts')
  })

  it('keeps every changed line, marked, in order', () => {
    const d = describePatch(PATCH)
    expect(d).toContain('-  return price - price * percent')
    expect(d).toContain('+  return price - price * (percent / 100)')
    expect(d.indexOf('-  return')).toBeLessThan(d.indexOf('+  return'))
  })

  it('names an Add and a Delete by their own verb', () => {
    const add = describePatch('*** Begin Patch\n*** Add File: a/b.ts\n+one\n*** End Patch')
    expect(add).toContain('Add a/b.ts')
    const del = describePatch('*** Begin Patch\n*** Delete File: a/c.ts\n*** End Patch')
    expect(del).toContain('Delete a/c.ts')
  })

  it('heads every file in a multi-file patch, in order, keeping each hunk', () => {
    // The single-file cases above never exercise the separator between blocks, and a patch that
    // touches three files is the ordinary shape of a real edit — the one an operator most needs to
    // read before approving.
    const multi = [
      '*** Begin Patch',
      '*** Update File: a/one.ts',
      '@@ ctx1',
      '-old1',
      '+new1',
      '*** Add File: b/two.ts',
      '+created',
      '*** Delete File: c/three.ts',
      '*** End Patch',
    ].join('\n')
    const d = describePatch(multi)
    expect(d).toContain('Update a/one.ts')
    expect(d).toContain('Add b/two.ts')
    expect(d).toContain('Delete c/three.ts')
    expect(d.indexOf('Update a/one.ts')).toBeLessThan(d.indexOf('Add b/two.ts'))
    expect(d.indexOf('Add b/two.ts')).toBeLessThan(d.indexOf('Delete c/three.ts'))
    expect(d).toContain('-old1')
    expect(d).toContain('+created')
  })

  it('leaves a patch it cannot parse alone rather than showing the operator nothing', () => {
    // A body with no file marker is not V4A. Returning an empty description would hide the change
    // being approved, which is worse than the envelope this test exists to remove.
    const odd = describePatch('some text that is not a patch at all')
    expect(odd).toContain('some text that is not a patch at all')
  })
})
