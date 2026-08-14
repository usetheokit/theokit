import { writableRootsFor, type SandboxMode, type SandboxProvider } from '@theokit/sdk/sandbox'
import { describe, expect, it } from 'vitest'

import { bindToolScope, sandboxWritePolicy } from '../../src/tools/tool-scope.js'

/**
 * M78 — the tool scope binder.
 *
 * ## The defect
 *
 * The framework ships the ingredients (`createSandboxBackend`, `resolveSandboxPosture`) and no
 * BINDER. Measured on `@theokit/sdk-tools@0.26.1`: `projectRoot` is REQUIRED on 11 factories, and
 * `sandbox` is **optional** on three — `createGitDiffTool`, `createGitStatusTool` and, the one that
 * matters, `createShellTool`.
 *
 * So a scope assembled without a sandbox produces an UNCONFINED SHELL with no error and no warning.
 * The consumer that prompted this milestone documented exactly that. Every product then rediscovers,
 * per tool, which root each factory accepts — and the failure mode of getting it wrong is silence.
 *
 * ## What the binder is, and what it deliberately is not
 *
 * It binds `{ projectRoot, writeRoot, sandbox }` once and hands back scoped factories. It does NOT
 * enumerate the eleven tools: a generic `bind` is the same declarative map with none of the
 * maintenance, and a twelfth tool in `sdk-tools` needs no change here (OCP). Naming eleven thin
 * wrappers would be eleven places to forget the sandbox — the failure being closed.
 */

const fakeSandbox = { mode: 'workspace-write' } as unknown as SandboxProvider
const otherSandbox = { mode: 'read-only' } as unknown as SandboxProvider

/** A stand-in for a `sdk-tools` factory: records what the binder actually passed it. */
function spyFactory() {
  const calls: Record<string, unknown>[] = []
  const factory = (options: Record<string, unknown>): string => {
    calls.push(options)
    return 'tool'
  }
  return { factory, calls }
}

describe('bindToolScope — the scope is applied once, and cannot be assembled without a sandbox', () => {
  it('test_the_scope_fields_reach_the_factory', () => {
    const { factory, calls } = spyFactory()
    const scope = bindToolScope({ projectRoot: '/proj', sandbox: fakeSandbox })

    scope.bind(factory)()

    expect(calls[0]).toMatchObject({ projectRoot: '/proj', sandbox: fakeSandbox })
  })

  it('test_writeRoot_defaults_to_projectRoot', () => {
    // A product that never distinguishes the two should not have to say so twice. The default is
    // the conservative one: writes land where the project is, not somewhere broader.
    const scope = bindToolScope({ projectRoot: '/proj', sandbox: fakeSandbox })
    expect(scope.writeRoot).toBe('/proj')
  })

  it('test_an_explicit_writeRoot_is_kept', () => {
    const scope = bindToolScope({
      projectRoot: '/proj',
      writeRoot: '/proj/build',
      sandbox: fakeSandbox,
    })
    expect(scope.writeRoot).toBe('/proj/build')
  })

  it('test_per_tool_options_are_forwarded_alongside_the_scope', () => {
    // The risk the milestone names: a binder that freezes everything is useless. What it forbids is
    // the ABSENCE of a sandbox, never variation in the rest.
    const { factory, calls } = spyFactory()
    const scope = bindToolScope({ projectRoot: '/proj', sandbox: fakeSandbox })

    scope.bind(factory)({ name: 'run_shell', timeoutMs: 5000 })

    expect(calls[0]).toMatchObject({
      projectRoot: '/proj',
      sandbox: fakeSandbox,
      name: 'run_shell',
      timeoutMs: 5000,
    })
  })
})

describe('the sandbox cannot be removed — only replaced', () => {
  it('test_a_DIFFERENT_sandbox_may_be_passed_per_tool', () => {
    // Variation is legitimate: one tool may need a stricter confinement than the rest.
    const { factory, calls } = spyFactory()
    const scope = bindToolScope({ projectRoot: '/proj', sandbox: fakeSandbox })

    scope.bind(factory)({ sandbox: otherSandbox })

    expect(calls[0].sandbox).toBe(otherSandbox)
  })

  it('test_passing_sandbox_undefined_falls_back_to_the_scope_instead_of_unbinding_it', () => {
    // The runtime half of "unconfined is unrepresentable". The type already forbids omitting the
    // sandbox when building the scope; this closes the other door — an override that clears it.
    // `undefined` reaches here from ordinary code (`{ sandbox: maybeSandbox }`), so refusing to act
    // on it is what keeps an accidental `undefined` from silently unconfining a shell.
    const { factory, calls } = spyFactory()
    const scope = bindToolScope({ projectRoot: '/proj', sandbox: fakeSandbox })

    scope.bind(factory)({ sandbox: undefined })

    expect(calls[0].sandbox).toBe(fakeSandbox)
  })

  it('test_the_same_holds_for_projectRoot_and_writeRoot', () => {
    // Same reasoning, same door: an `undefined` root would send a write to the process cwd.
    const { factory, calls } = spyFactory()
    const scope = bindToolScope({ projectRoot: '/proj', sandbox: fakeSandbox })

    scope.bind(factory)({ projectRoot: undefined, writeRoot: undefined })

    expect(calls[0]).toMatchObject({ projectRoot: '/proj', writeRoot: '/proj' })
  })
})

describe('sandboxWritePolicy — a projection of the SDK, never a second source of truth', () => {
  it('test_read_only_permits_no_writes', () => {
    expect(sandboxWritePolicy('read-only', '/proj')).toEqual({
      writes: false,
      allowAbsolute: false,
    })
  })

  it('test_workspace_write_permits_writes_but_no_absolute_paths', () => {
    expect(sandboxWritePolicy('workspace-write', '/proj')).toEqual({
      writes: true,
      allowAbsolute: false,
    })
  })

  it('test_danger_full_access_permits_absolute_paths', () => {
    // The measurement that made this test worth writing: `writableRootsFor` returns `null` for this
    // mode, and `null` means UNRESTRICTED — not "no writes". Guessing the other way would have
    // shipped a policy that forbids writes exactly where everything is allowed.
    expect(sandboxWritePolicy('danger-full-access', '/proj')).toEqual({
      writes: true,
      allowAbsolute: true,
    })
  })

  it('test_the_policy_agrees_with_writableRootsFor_for_every_mode', () => {
    // The anti-drift assertion. This function exists so products stop re-deriving write policy by
    // hand; if it ever disagreed with the SDK's own answer it would be a THIRD derivation, which is
    // worse than the two it replaces.
    const modes = ['read-only', 'workspace-write', 'danger-full-access'] as const
    for (const mode of modes) {
      const policy = sandboxWritePolicy(mode, '/proj')
      const roots = writableRootsFor(mode, '/proj')
      expect(policy.writes, `${mode}: writes`).toBe(roots === null || roots.length > 0)
      expect(policy.allowAbsolute, `${mode}: allowAbsolute`).toBe(roots === null)
    }
  })

  it('test_the_scope_exposes_the_policy_of_its_own_sandbox_mode', () => {
    const scope = bindToolScope({
      projectRoot: '/proj',
      sandbox: fakeSandbox,
      mode: 'read-only',
    })
    expect(scope.policy.writes).toBe(false)
  })
})

describe('an unknown mode fails loud instead of guessing', () => {
  it('test_a_mode_outside_the_union_throws_naming_the_alternatives', () => {
    // Found while writing the type test: for a mode outside the union `writableRootsFor` returns
    // `undefined`, which its own signature (`readonly string[] | null`) does not admit. Only a
    // product that read the mode from config and cast it can get here — and that is exactly the
    // caller who must not receive a `TypeError` on `.length` three frames deep.
    expect(() => sandboxWritePolicy('workspace-writ' as SandboxMode, '/proj')).toThrow(
      /unknown sandbox mode/i,
    )
    expect(() => sandboxWritePolicy('' as SandboxMode, '/proj')).toThrow(/danger-full-access/)
  })
})
