import { describe, expectTypeOf, it } from 'vitest'

import {
  bindToolScope,
  sandboxWritePolicy,
  type ToolScope,
} from '../../packages/agents/src/tools/tool-scope.js'

/**
 * M78 — the type-level half of "an unconfined shell is unrepresentable".
 *
 * The runtime guard (`packages/agents/tests/unit/tool-scope.test.ts`) proves an `undefined` override
 * cannot clear the sandbox. This file proves the other door: a scope cannot be BUILT without one.
 *
 * It is a `.test-d.ts` on purpose. The failure being closed is a scope that assembles fine and
 * produces an unconfined shell in silence — so the assertion that matters is "this does not
 * compile", which no runtime test can make.
 */

/**
 * The sandbox type as THIS API declares it, derived from the function under test.
 *
 * Not `import type { SandboxProvider } from '@theokit/sdk/sandbox'`: pnpm keeps three copies of
 * `@theokit/sdk@4.51.1` (peer-resolution hashes), the root and `packages/agents` resolve different
 * ones, and `SandboxProvider` carries a `protected` member — so the two are NOMINALLY incompatible
 * and the test failed on a difference that does not exist for any real caller.
 *
 * Deriving from the signature also states the better assertion: the test speaks the vocabulary the
 * API publishes, instead of a separately-resolved twin of it.
 */
type Sandbox = Parameters<typeof bindToolScope>[0]['sandbox']
const sandbox = {} as Sandbox

describe('a scope without a sandbox does not compile', () => {
  it('test_omitting_sandbox_is_a_type_error', () => {
    // @ts-expect-error — `sandbox` is required. Deleting this line makes the test fail, which is what
    // keeps the assertion honest: `@ts-expect-error` over code that compiles is itself an error.
    bindToolScope({ projectRoot: '/proj' })
  })

  it('test_passing_sandbox_undefined_is_a_type_error_too', () => {
    // The near-miss that a required field alone would not catch under a loose `exactOptionalPropertyTypes`
    // setting: naming the field and giving it nothing.
    // @ts-expect-error — `undefined` is not a `SandboxProvider`.
    bindToolScope({ projectRoot: '/proj', sandbox: undefined })
  })

  it('test_a_scope_WITH_a_sandbox_compiles', () => {
    // The counter-proof. Without it, a `bindToolScope` typed to reject everything would satisfy both
    // assertions above — a gate that refuses all input is not a gate, it is a removed feature.
    expectTypeOf(bindToolScope({ projectRoot: '/proj', sandbox })).toExtend<ToolScope>()
  })
})

describe('the bound scope keeps its shape', () => {
  it('test_the_scope_fields_are_non_optional_strings_once_bound', () => {
    const scope = bindToolScope({ projectRoot: '/proj', sandbox })
    // `writeRoot` is optional on the INPUT and resolved on the SCOPE. A consumer reading
    // `scope.writeRoot` must never have to narrow it.
    expectTypeOf(scope.writeRoot).toEqualTypeOf<string>()
    expectTypeOf(scope.projectRoot).toEqualTypeOf<string>()
    expectTypeOf(scope.sandbox).toEqualTypeOf<Sandbox>()
  })

  it('test_bind_returns_the_tool_the_factory_returns', () => {
    // The generic must carry the tool type through, or every call site needs a cast — which is how a
    // binder meant to remove boilerplate ends up adding it.
    const scope = bindToolScope({ projectRoot: '/proj', sandbox })
    const factory = (_options: { projectRoot: string; name?: string }): { kind: 'tool' } => ({
      kind: 'tool',
    })
    expectTypeOf(scope.bind(factory)()).toEqualTypeOf<{ kind: 'tool' }>()
  })
})

describe('sandboxWritePolicy speaks the SDK vocabulary', () => {
  it('test_the_mode_is_the_SDK_union_not_a_string', () => {
    // A `.test-d.ts` is type-checked AND executed, so the rejected call lives in a function nobody
    // calls: the assertion is that it does not COMPILE, and running it would only prove the runtime
    // guard, which `tool-scope.test.ts` already covers.
    const neverCalled = (): unknown =>
      // @ts-expect-error — an arbitrary string is not a `SandboxMode`. A product typo'ing the mode
      // would otherwise get a policy derived from a mode that does not exist.
      sandboxWritePolicy('workspace-writ', '/proj')
    expectTypeOf(neverCalled).toBeFunction()

    expectTypeOf(sandboxWritePolicy('workspace-write', '/proj')).toExtend<{
      writes: boolean
      allowAbsolute: boolean
    }>()
  })
})
