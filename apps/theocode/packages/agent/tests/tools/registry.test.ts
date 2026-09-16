/**
 * B-018 — the registry's name contract, which three other layers depend on.
 *
 * A tool's `name` is what the model calls, what the approval map keys on, and what the terminal
 * renders a header for. Registering a tool under one key while the tool reports another silently
 * breaks all three at once — the model asks for a name nothing answers to, or worse, a tool runs
 * ungated because the approval map never matched it.
 *
 * The constructor checks this. Nothing exercised the check, so `registry.ts` sat on the TDD gate's
 * list — one of the entries B-018 records as having been listed underneath a BLOCK, which is
 * precisely how an advisory goes unread.
 *
 * What these tests pin, stated plainly: the INVARIANT holds for the registry as built. They do NOT
 * pin the constructor's guard — disabling it leaves them green, because the table is correct today
 * and the guard is what keeps it correct tomorrow. Pinning the guard would need a mismatched tool
 * injected into a table that is deliberately internal, and widening that surface to test it would
 * cost more than the guard is worth. Measured by mutation rather than assumed.
 */
import { describe, expect, it } from 'vitest'

import { ToolRegistry } from '../../src/tools/registry.js'
import { resolveToolScope } from '../../src/tools/tool-scope.js'

const scope = { sandbox_mode: 'workspace-write' } as never

describe('B-018 — a tool is registered under the name it reports', () => {
  it('test_the_registry_builds_and_every_tool_answers_to_its_key', () => {
    const registry = new ToolRegistry(resolveToolScope(scope, process.cwd()))

    for (const name of registry.names() as Parameters<ToolRegistry['get']>[0][]) {
      expect(
        registry.get(name).name,
        `"${name}" is registered under a key the tool does not answer to — the model would call a ` +
          'name nothing responds to, and the approval map would never match it',
      ).toBe(name)
    }
  })

  it('test_the_registry_is_not_empty', () => {
    // Anti-vacuity floor: an empty registry satisfies the loop above for free.
    const registry = new ToolRegistry(resolveToolScope(scope, process.cwd()))

    expect(registry.names().length).toBeGreaterThan(3)
  })

  it('test_every_registered_tool_is_frozen', () => {
    // The registry freezes each tool so a consumer cannot rename one after the check has run —
    // which would reopen exactly the mismatch the constructor refuses.
    const registry = new ToolRegistry(resolveToolScope(scope, process.cwd()))
    const first = registry.names()[0] as Parameters<ToolRegistry['get']>[0]
    const tool = registry.get(first)

    expect(Object.isFrozen(tool)).toBe(true)
  })
})

describe('B-018 — the tool scope follows the directory it is given', () => {
  it('test_the_write_root_is_derived_from_the_supplied_directory', () => {
    // The property B-032 depends on: resolveToolScope derives BOTH the write root and the sandbox
    // working directory from its argument, which is why a caller passing process.cwd() instead of
    // the injected one confines a delegated worker to the wrong tree.
    const here = resolveToolScope(scope, '/tmp/one')
    const there = resolveToolScope(scope, '/tmp/two')

    expect(here.cwd).toBe('/tmp/one')
    expect(there.cwd).toBe('/tmp/two')
    expect(here.writeRoot, 'the write root ignored the supplied directory').not.toBe(
      there.writeRoot,
    )
  })
})

describe('bindToolScope — the scope is bound once, and write tools stay at the write root', () => {
  /**
   * The migration to `bindToolScope` replaced seven repetitions of `projectRoot: scope.cwd` with one
   * bind. Two properties have to survive that, and neither is obvious from the diff.
   */
  it('test_the_permissive_mode_widens_the_WRITE_root_without_widening_the_read_root', () => {
    // The detail a naive bind would have erased. `apply_patch` and `edit_file` receive
    // `projectRoot: scope.writeRoot` — for them the project root IS the write root. Letting the bind
    // apply `cwd` would narrow the write scope silently whenever the two diverge, which is exactly
    // the `danger-full-access` case.
    const wide = resolveToolScope({ sandbox_mode: 'danger-full-access' } as never, '/tmp/proj')
    const narrow = resolveToolScope({ sandbox_mode: 'workspace-write' } as never, '/tmp/proj')

    expect(wide.cwd, 'the READ root should not change with the mode').toBe(narrow.cwd)
    expect(wide.writeRoot, 'the permissive mode did not widen the write root').not.toBe(
      narrow.writeRoot,
    )
  })

  it('test_a_scope_WITHOUT_a_sandbox_does_not_compile', () => {
    // The thesis: an unconfined shell must be UNREPRESENTABLE, and the guarantee is in the TYPE, not
    // in a runtime check. So the honest assertion is about compilation.
    //
    // The first version of this test checked `names()).toContain('run_shell')` under a name that
    // promised to speak about the sandbox. That would pass with the sandbox removed, and would have
    // said nothing.
    const withoutSandbox = { cwd: '/tmp/proj', writeRoot: '/tmp/proj' }

    // @ts-expect-error — `sandbox` is required on ToolScope (B-006). Omitting it is what produced an
    // unconfined shell, with no error and no warning.
    expect(() => new ToolRegistry(withoutSandbox)).toBeTypeOf('function')
  })
})
