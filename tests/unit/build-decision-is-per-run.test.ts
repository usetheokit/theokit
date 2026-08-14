import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  __resetBuildDecisionForTests,
  FRESH_WINDOW_MS,
  isDistUsableWithoutRebuilding,
  markDistValidatedForThisRun,
  VALIDATION_MARKER,
} from '../integration/_helpers/build-theokit-package.js'

/**
 * B-M76-03 — the dist race, third measurement.
 *
 * ## Why the previous fix did not hold
 *
 * B-M72-01 memoised the "is dist usable?" decision and stated that this made "every caller in one
 * run agree". That claim was wrong, and the reason is embarrassing in a useful way: **vitest runs
 * test files in separate worker processes**. A per-PROCESS memo makes every caller in one *worker*
 * agree, which is not the same thing at all.
 *
 * So the original failure survived, just narrower: worker A starts early, decides dist is fresh, and
 * goes off to read it. Worker B starts eleven minutes later, finds the mtime outside the ten-minute
 * window, decides it is stale, and rebuilds — and `tsup` cleans the directory before writing.
 *
 * Measured again on the M77 full run: 7 failures across `import-validation` and
 * `devtools-treeshake`, all green in isolation immediately afterwards.
 *
 * ## The fix, and why the parent pid
 *
 * A marker file records WHICH RUN validated dist, by the parent process id that every worker of a
 * vitest run shares. Same run ⇒ trust the decision unconditionally, with no clock involved. A
 * different run ⇒ fall back to the freshness window, which is what the window was actually for: a
 * dist left over from yesterday.
 *
 * A pure time window cannot fix this. Any window can expire between two workers of the same run —
 * that is precisely the bug — and widening it only makes a genuinely stale dist survive longer.
 */

/**
 * The test owns its OWN marker and never touches {@link VALIDATION_MARKER}.
 *
 * The first version of this file deleted the real one in `beforeEach`, and that single line
 * sabotaged every worker reading dist at that instant — re-creating the race the marker exists to
 * remove, and taking four unrelated test files down with it in the same run. Shared cross-process
 * state is not something a test may borrow, however briefly.
 */
const MARKER = resolve(mkdtempSync(join(tmpdir(), 'theokit-build-marker-')), 'validated.json')

beforeEach(() => {
  __resetBuildDecisionForTests()
  rmSync(MARKER, { force: true })
})
afterEach(() => {
  rmSync(MARKER, { force: true })
})

it('test_the_shared_marker_path_is_the_one_the_helper_defaults_to', () => {
  // Keeps the injection honest: an isolated marker only proves anything if the real default is the
  // shared file the workers actually agree on.
  expect(VALIDATION_MARKER).toMatch(/theokit-test-locks/)
  expect(MARKER).not.toBe(VALIDATION_MARKER)
})

describe('the marker identifies the RUN, not a moment in time', () => {
  it('test_a_marker_from_THIS_run_makes_dist_usable_regardless_of_age', () => {
    markDistValidatedForThisRun(MARKER)
    // Age the marker well past any window. Same run ⇒ still usable: this is the exact case the
    // per-process memo could not cover, because the later worker never saw the earlier decision.
    const old = new Date(Date.now() - 60 * 60 * 1000)
    utimesSync(MARKER, old, old)

    expect(isDistUsableWithoutRebuilding(MARKER)).toBe(true)
  })

  it('test_a_marker_from_ANOTHER_run_hands_the_decision_back_to_the_window', () => {
    // The counter-proof. Without it, writing a marker once would disable rebuilding forever and the
    // helper would happily test yesterday's artifacts.
    //
    // The claim is deliberately relative, not absolute: a foreign marker must not VOUCH for dist —
    // the window must decide. Asserting a flat `false` here would be asserting that dist is stale,
    // which depends on when the machine last built and is nothing to do with this behaviour.
    mkdirSync(resolve(tmpdir(), 'theokit-test-locks'), { recursive: true })
    markDistValidatedForThisRun(MARKER)
    const mine = JSON.parse(readFileSync(MARKER, 'utf8')) as { runId: number }
    expect(mine.runId).toBe(process.ppid)

    writeFileSync(MARKER, JSON.stringify({ runId: mine.runId + 100_000 }), 'utf8')
    const old = new Date(Date.now() - 60 * 60 * 1000)
    utimesSync(MARKER, old, old)

    const dts = resolve(__dirname, '../../packages/theo/dist/index.d.ts')
    const windowSays = existsSync(dts) && Date.now() - statSync(dts).mtimeMs < FRESH_WINDOW_MS
    expect(isDistUsableWithoutRebuilding(MARKER)).toBe(windowSays)
  })

  it('test_a_marker_from_another_run_over_a_MISSING_dist_is_not_usable', () => {
    // The absolute half of the claim above, expressed where it holds unconditionally.
    writeFileSync(MARKER, JSON.stringify({ runId: process.ppid + 100_000 }), 'utf8')
    const dts = resolve(__dirname, '../../packages/theo/dist/index.d.ts')
    if (existsSync(dts)) return // cannot exercise without deleting real build output
    expect(isDistUsableWithoutRebuilding(MARKER)).toBe(false)
  })

  it('test_with_NO_marker_a_freshly_built_dist_is_still_accepted', () => {
    // A first worker, on a machine where someone just ran `pnpm build` by hand, must not rebuild.
    // The window keeps doing the job it was written for — it just stops governing mid-run.
    //
    // The test ESTABLISHES the freshness its name claims instead of hoping for it. The first version
    // asserted the dist was younger than 24 hours and then expected acceptance — while the code it
    // exercises uses a 10-MINUTE window. So it passed when the suite ran soon after a build and
    // failed when it did not, which is how it went red roughly one run in three, always in a
    // different place in the log. A unit test that reads the wall clock is a bug by contract
    // (`rules/testing.md` § 6), and this one was mine.
    //
    // Stamping the mtime is benign in direction: it can only make dist look fresher, and dist IS
    // valid here — no sibling asserts the STALE side (the one that could is written against the
    // same window and adapts).
    const dts = resolve(__dirname, '../../packages/theo/dist/index.d.ts')
    if (!existsSync(dts)) return // nothing built here; the assertion below has no subject

    const now = new Date()
    utimesSync(dts, now, now)

    expect(Date.now() - statSync(dts).mtimeMs).toBeLessThan(FRESH_WINDOW_MS)
    expect(isDistUsableWithoutRebuilding(MARKER)).toBe(true)
  })

  it('test_a_missing_dist_is_never_usable_even_with_a_marker_from_this_run', () => {
    // The marker vouches for a validation, not for the existence of files. If dist is genuinely
    // gone, trusting the marker would hand the reader a directory that is not there.
    markDistValidatedForThisRun(MARKER)
    const dts = resolve(__dirname, '../../packages/theo/dist/index.d.ts')
    if (existsSync(dts)) return // cannot exercise without deleting real build output
    expect(isDistUsableWithoutRebuilding(MARKER)).toBe(false)
  })
})
