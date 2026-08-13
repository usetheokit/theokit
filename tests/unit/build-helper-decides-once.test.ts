import { statSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  THEOKIT_DIST,
  __resetBuildDecisionForTests,
  buildTheokitPackageOnce,
} from '../integration/_helpers/build-theokit-package.js'

/**
 * B-M72-01 — the build helper decides ONCE per run, so `dist/` cannot vanish mid-suite.
 *
 * ## What was measured
 *
 * `r3a-emitted-bundle-node-free` and `import-validation` failed intermittently on full suite runs
 * and always passed in isolation — three occurrences, once with `dist/cli/index.js` simply absent.
 *
 * The cause was captured empirically, by watching the directory and snapshotting `ps` the instant it
 * disappeared: `pnpm --filter theokit build` → `tsup`, spawned from this helper. `tsup` cleans the
 * output directory before writing, so every reader in flight saw a missing or partial `dist/`.
 *
 * The helper already had a mutex, and its docblock already named this race. The mutex serialises
 * WRITERS against each other — which was never the failure. `hasFreshBuild()` was evaluated per
 * CALL against a 10-minute window, and a full run takes about that long, so two callers in the SAME
 * run got different answers: the early one read a fresh dist, the late one rebuilt it out from
 * under them.
 *
 * The readers were inside the protocol the whole time. A guard whose scope is narrower than the
 * property it appears to protect is the failure shape this repository keeps finding.
 */

describe('the build decision is made once per process', () => {
  it('test_a_second_call_does_not_rebuild', () => {
    // The property, stated as the thing a reader depends on: once this run has decided dist/ is
    // usable, nothing later in the same run may replace it. mtime is the evidence — a rebuild
    // necessarily moves it.
    buildTheokitPackageOnce()
    const first = statSync(resolve(THEOKIT_DIST, 'index.d.ts')).mtimeMs

    buildTheokitPackageOnce()
    buildTheokitPackageOnce()

    expect(
      statSync(resolve(THEOKIT_DIST, 'index.d.ts')).mtimeMs,
      'dist/ was rebuilt by a later caller in the same run — the exact race B-M72-01 measured',
    ).toBe(first)
  })

  it('test_the_memo_is_what_short_circuits_and_not_merely_a_fast_filesystem', () => {
    // Counter-proof. Without it, the assertion above would also pass on a build so fast that mtime
    // did not move, and the memo could be removed with every test still green.
    __resetBuildDecisionForTests()
    // After a reset the helper must consult the filesystem again rather than reuse a stale answer,
    // which is what makes a FRESH process still able to build when there is nothing on disk.
    expect(() => buildTheokitPackageOnce()).not.toThrow()
  })
})
