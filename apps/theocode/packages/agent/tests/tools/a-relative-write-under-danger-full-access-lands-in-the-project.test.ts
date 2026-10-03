import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ToolRegistry } from '../../src/tools/registry.js'
import { resolveToolScope } from '../../src/tools/tool-scope.js'

/**
 * #939, measured on the real binary: once `danger-full-access` could run headless, the first edit
 * asked for `hello.txt` and failed with `EACCES: permission denied, open '/hello.txt'`.
 *
 * The mode widens the write root to `/`, and the SDK write tools resolve a relative path against
 * that root, so every relative path the model wrote pointed at the filesystem root. The mode was
 * reachable before only through the TUI, after a human approval, and wrote to the wrong place there
 * too. A relative path means the project; the widened root only has to let absolute paths through.
 */

type Handler = (input: Record<string, string>, ctx: never) => Promise<string>

function handlerOf(registry: ToolRegistry, name: 'ApplyPatch' | 'Edit'): Handler {
  return registry.get(name).handler as unknown as Handler
}

let project: string
let outside: string

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'theocode-project-'))
  outside = mkdtempSync(join(tmpdir(), 'theocode-outside-'))
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

function wideRegistry(): ToolRegistry {
  return new ToolRegistry(
    resolveToolScope({ sandbox_mode: 'danger-full-access' } as never, project),
  )
}

describe('a relative write under danger-full-access lands in the project', () => {
  it('test_apply_patch_adds_a_relative_file_inside_the_project', async () => {
    const result = await handlerOf(wideRegistry(), 'ApplyPatch')(
      { patch: '*** Begin Patch\n*** Add File: hello.txt\n+ok\n*** End Patch' },
      undefined as never,
    )

    expect(JSON.parse(result)).toMatchObject({ ok: true })
    expect(readFileSync(join(project, 'hello.txt'), 'utf8')).toBe('ok\n')
  })

  it('test_apply_patch_still_writes_an_absolute_path_outside_the_project', async () => {
    // The point of the mode. Anchoring relative paths must not narrow it back to the project.
    const target = join(outside, 'note.txt')

    const result = await handlerOf(wideRegistry(), 'ApplyPatch')(
      { patch: `*** Begin Patch\n*** Add File: ${target}\n+far\n*** End Patch` },
      undefined as never,
    )

    expect(JSON.parse(result)).toMatchObject({ ok: true })
    expect(readFileSync(target, 'utf8')).toBe('far\n')
  })

  it('test_apply_patch_leaves_a_body_line_that_looks_like_a_header_alone', async () => {
    // Only header lines carry paths. An added line whose text is a header must be written verbatim.
    const result = await handlerOf(wideRegistry(), 'ApplyPatch')(
      { patch: '*** Begin Patch\n*** Add File: doc.md\n+*** Add File: x\n*** End Patch' },
      undefined as never,
    )

    expect(JSON.parse(result)).toMatchObject({ ok: true })
    expect(readFileSync(join(project, 'doc.md'), 'utf8')).toBe('*** Add File: x\n')
  })

  it('test_edit_changes_a_relative_file_inside_the_project', async () => {
    writeFileSync(join(project, 'a.txt'), 'before\n')

    const result = await handlerOf(wideRegistry(), 'Edit')(
      { path: 'a.txt', old_string: 'before', new_string: 'after' },
      undefined as never,
    )

    expect(JSON.parse(result)).toMatchObject({ ok: true })
    expect(readFileSync(join(project, 'a.txt'), 'utf8')).toBe('after\n')
  })
})
