/**
 * #105 — which files a turn actually wrote, taken from the tool calls it made.
 *
 * Codex ends a turn by printing the working tree's diff. That is the right idea and the wrong
 * scope: in a repository that was already dirty it prints everything, including what the operator
 * changed by hand before the turn started, and the reader cannot tell the two apart.
 *
 * The agent's own write-scoped calls carry the answer, so this collects it from them. `apply_patch`
 * hides the paths inside the patch text; the others name them in a field.
 *
 * Every branch narrows before it reads. The input crosses from a model, and a collector that threw
 * on an unexpected shape would take down a turn that was merely going somewhere odd — the rule
 * `tool-line.ts` already states for the surface beside this one.
 */
import { describe, expect, it } from 'vitest'

import { changedPaths } from '../../src/runtime/changed-paths.js'

describe('#105 — the paths a turn wrote', () => {
  it('test_apply_patch_paths_come_from_the_patch_body', () => {
    // The shape that matters most: `apply_patch` has no `path` field at all.
    const patch = [
      '*** Begin Patch',
      '*** Add File: src/a.ts',
      '+export const a = 1',
      '*** Update File: src/b.ts',
      '@@',
      '-old',
      '+new',
      '*** Delete File: src/c.ts',
      '*** End Patch',
    ].join('\n')

    expect(changedPaths([{ toolName: 'apply_patch', input: { patch } }])).toEqual([
      'src/a.ts',
      'src/b.ts',
      'src/c.ts',
    ])
  })

  it('test_the_field_naming_tools_are_read_from_their_field', () => {
    expect(
      changedPaths([
        { toolName: 'write_file', input: { path: 'x.txt' } },
        { toolName: 'edit_file', input: { path: 'y.txt' } },
      ]),
    ).toEqual(['x.txt', 'y.txt'])
  })

  it('test_read_only_tools_contribute_nothing', () => {
    // Anti-vacuity. A collector that returned every path it saw would pass the arms above and then
    // print a diff for a turn that changed nothing, which is worse than printing none.
    expect(
      changedPaths([
        { toolName: 'read_file', input: { path: 'x.txt' } },
        { toolName: 'grep', input: { pattern: 'x', path: 'y.txt' } },
        { toolName: 'run_shell', input: { command: 'ls' } },
      ]),
    ).toEqual([])
  })

  it('test_a_path_written_twice_appears_once', () => {
    expect(
      changedPaths([
        { toolName: 'write_file', input: { path: 'x.txt' } },
        { toolName: 'write_file', input: { path: 'x.txt' } },
      ]),
    ).toEqual(['x.txt'])
  })

  it('test_hostile_shapes_are_skipped_rather_than_thrown_on', () => {
    // The input crosses from a model. Every one of these has been seen from some model somewhere.
    expect(
      changedPaths([
        { toolName: 'apply_patch', input: null },
        { toolName: 'apply_patch', input: { patch: 42 } },
        { toolName: 'write_file', input: { path: '' } },
        { toolName: 'write_file' },
        {},
      ]),
    ).toEqual([])
  })
})
