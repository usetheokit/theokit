/**
 * #96 — the composition produces something the agent-module loader ACCEPTS.
 *
 * Every other test here asserts what `composeRun` computes: the policy, the model, the posture.
 * None asserted that `mod` is loadable, and that is the gap this file closes.
 *
 * The cost of the gap, measured: `buildChatAgent` became async in 0.7.0 (#65), `mod.default` held
 * a Promise, and BOTH surfaces stopped being able to start a turn. `theocode exec` answered
 *
 *   ERROR: [@theokit/agents] agent module: an agents/ file must default-export a defineAgent(...)
 *
 * on every invocation. It shipped in v0.7.0 and v0.7.1 behind typecheck, 1211 tests, lint,
 * depcruise, crossval and twelve green CI checks. Nothing executed a turn, so nothing knew.
 *
 * ## Why the type system cannot do this
 *
 * The obvious fix — name the consumer's contract instead of the producer's return type — is not
 * available: `streamAgentTurnInProcess(mod: unknown, …)` declares no contract, and the real one is
 * enforced at runtime by `compileAgentModule`. So the annotation on `RunComposition.mod` tracks
 * `buildChatAgent` no matter how it is written, and an executed check is the only gate left.
 *
 * ## Why this calls the framework's own loader
 *
 * Asserting `typeof mod.default === 'object'` would have passed for the Promise too. The assertion
 * has to be the same function the runtime calls, or it is a different question with a similar shape
 * — the failure this repository keeps paying for.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { compileAgentModule } from '@theokit/agents'
import { afterAll, describe, expect, it } from 'vitest'

import { composeRun } from '../src/run-composition.js'

/**
 * Every temporary root this file makes, removed when it finishes.
 *
 * The pattern is `packages/agent/tests/aggregate-cut-wiring.test.ts:44-57`'s, inline rather than
 * imported because this package has exactly one file that needs it — a helper module with a single
 * consumer is more machinery than the three lines it saves. Measured cost of skipping it, in this
 * repository: 193 directories and 15 MB of generated corpora from one uncleaned file in an
 * afternoon.
 */
const made: string[] = []

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
  made.length = 0
})

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  made.push(dir)
  return dir
}

/**
 * B-167 — the operator root. `CompositionSeams` already carried it as `userDir`; it simply was not
 * forwarded to the build, so this test read whatever `~/.theokit/` the machine held.
 */
const OPERATOR_HOME = tempRoot('b167-cli-home-')

describe('#96 — the composed module loads', () => {
  it('test_the_agent_module_compiles_the_way_the_runtime_compiles_it', async () => {
    // The injected trust store, same seam the sibling test uses: reading the real `~/.theokit`
    // one would make this depend on whichever machine runs it.
    const cwd = tempRoot('compose-smoke-')
    const store = join(cwd, 'trusted-dirs.json')
    writeFileSync(store, JSON.stringify({ trusted: [cwd] }), { mode: 0o600 })

    const composed = await composeRun({ overrides: [] }, { cwd, store, userDir: OPERATOR_HOME })

    // The framework's own entry point, not a shape check. This throws AgentDefinitionError on a
    // Promise, on a thunk, and on anything else the loader will not take.
    expect(() => compileAgentModule(composed.mod, 'smoke')).not.toThrow()
  })

  it('test_a_promise_in_default_is_refused_so_this_arm_is_not_vacuous', () => {
    // Anti-vacuity, and it reproduces the exact 0.7.0 defect. Without this, an arm asserting
    // `not.toThrow()` would pass against a loader that accepted everything.
    //
    // The cast is the good news. Reported from here as `theokit#663`; in `@theokit/agents@13.0.0-
    // next.2` the parameter is `AgentModule`, so this line no longer compiles without help — the
    // shape that shipped broken in 0.7.0 and 0.7.1 is now a COMPILE error, caught before a commit
    // rather than on the first turn of a released version.
    //
    // The arm stays anyway, and the cast is what keeps it honest. The type guards a TypeScript
    // caller; the runtime guard is what stands between a JS consumer — or a module arriving from a
    // dynamic `import()`, where the type is `unknown` by construction — and a loader that would
    // accept anything. Deleting this because the compiler now covers one of the two paths would
    // leave the other unasserted.
    const promiseModule = { default: Promise.resolve({}) } as unknown as Parameters<
      typeof compileAgentModule
    >[0]
    expect(() => compileAgentModule(promiseModule, 'smoke')).toThrow(
      /must default-export a defineAgent/,
    )
  })
})
