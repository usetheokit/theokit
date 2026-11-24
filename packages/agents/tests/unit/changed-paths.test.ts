import { describe, expect, it } from 'vitest'

import { changedPathsOf } from '../../src/presets-entry.js'

const patch = [
  '*** Begin Patch',
  '*** Add File: src/new.ts',
  '+x',
  '*** Delete File: src/old.ts',
  '*** End Patch',
].join('\n')

describe('changedPathsOf', () => {
  it('collects write_file, aliased Edit and apply_patch paths in order without duplicates', () => {
    const out = changedPathsOf(
      [
        { toolName: 'write_file', input: { path: 'a.txt' } },
        { toolName: 'Edit', input: { path: 'b.txt' } },
        { toolName: 'ApplyPatch', input: { patch } },
        { toolName: 'write_file', input: { path: 'a.txt' } },
      ],
      { aliases: { Edit: 'edit_file', ApplyPatch: 'apply_patch' } },
    )
    expect(out).toEqual(['a.txt', 'b.txt', 'src/new.ts', 'src/old.ts'])
  })

  it('ignores read-only tools, unaliased names and malformed input', () => {
    expect(
      changedPathsOf([
        { toolName: 'read_file', input: { path: 'x' } },
        { toolName: 'Edit', input: { path: 'y' } },
        { toolName: 'write_file', input: null },
        { toolName: 'write_file', input: { path: 3 } },
        { toolName: 'apply_patch', input: { patch: 1 } },
        { toolName: 'toString', input: { path: 'z' } },
      ]),
    ).toEqual([])
  })
})
