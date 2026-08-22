/**
 * Shared build helper for tests that assert on `packages/theo/dist/` artifacts.
 * Multiple tests (`theokit-build-succeeds`, `publint-attw-green`,
 * `devtools-entry-dist`) require the same built package — running
 * `pnpm --filter theokit build` from each one races, wiping dist/ mid-read.
 *
 * Strategy:
 *  - Decide ONCE PER PROCESS whether this run's dist/ is usable, and reuse that decision.
 *  - When it is not, acquire a filesystem mutex and run a single build.
 *  - Other concurrent callers wait for the lock then verify dist/ existence.
 *
 * ## B-M72-01 — why the decision is memoised, measured 2026-08-13
 *
 * The docblock above already warned that concurrent builds "race, wiping dist/ mid-read", and the
 * mutex was written for exactly that. It serialises WRITERS against each other — and that was not
 * the failure that kept happening.
 *
 * `hasFreshBuild()` was evaluated per CALL, against a 10-minute window, and a full suite run takes
 * about that long. So two callers in the SAME run got different answers: an early one saw a fresh
 * dist, passed the check and went off to read it; a later one — past the window — decided it was
 * stale and rebuilt, and `tsup` cleans the directory before writing. The readers were inside the
 * protocol the whole time and the protocol still let dist vanish under them.
 *
 * Measured three times as an intermittent failure of `r3a-emitted-bundle-node-free` and
 * `import-validation` (once with `dist/cli/index.js` simply absent), always green in isolation. The
 * culprit was captured by watching the directory and snapshotting `ps` at the instant it
 * disappeared: `pnpm --filter theokit build` → `tsup`, spawned from this helper.
 *
 * Memoising makes every caller in one run agree. The window still governs a FRESH process, which is
 * what it was for; it no longer governs the middle of a run.
 *
 * ## B-M76-03 — that claim was wrong, measured 2026-08-13 (M77)
 *
 * "Every caller in one run" was false: **vitest runs test files in separate worker processes**, so a
 * per-PROCESS memo makes every caller in one WORKER agree, which is not the same thing. The original
 * failure survived, just narrower — worker A decides dist is fresh and goes off to read it; worker B,
 * started eleven minutes later, finds the mtime outside the window, decides it is stale and rebuilds,
 * and `tsup` cleans the directory before writing.
 *
 * Measured again on the M77 full run: 7 failures across `import-validation` and `devtools-treeshake`,
 * all green in isolation immediately after.
 *
 * The decision is now shared ACROSS processes by a marker file recording which RUN validated dist —
 * keyed by the parent pid every worker of a vitest run shares. Same run ⇒ trust it, no clock
 * involved. Different run ⇒ fall back to the window, which is what the window was actually for: a
 * dist left over from yesterday. No time window can fix this on its own; any window can expire
 * between two workers of the same run, and that IS the bug.
 */
import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(__dirname, '../../..')
const DIST = resolve(ROOT, 'packages/theo/dist')
const INDEX_DTS = resolve(DIST, 'index.d.ts')
const LOCK_DIR = resolve(tmpdir(), 'theokit-test-locks')
const LOCK_FILE = resolve(LOCK_DIR, 'packages-theo-build.lock')
/** The window a build stays trusted when no marker from this run vouches for it. Exported so a
 * test asserts against the SAME number the decision uses — a duplicated literal is how a test ends
 * up green against a window it invented (this one read 24h while the code read 10min). */
export const FRESH_WINDOW_MS = 10 * 60 * 1000

/** Records which RUN last validated dist. Shared across every worker of that run. */
export const VALIDATION_MARKER = resolve(LOCK_DIR, 'packages-theo-build.validated.json')

/**
 * The id every worker of one vitest run agrees on.
 *
 * The parent pid: with the fork pool it is the vitest main process, with the thread pool the workers
 * share the process outright. Either way it is the same value for the whole run and a different one
 * for the next — which is exactly the equivalence class the decision needs, and the one a clock
 * cannot express.
 */
const runId = (): number => process.ppid

const markerRunId = (markerPath: string): number | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(markerPath, 'utf8'))
    const value = (parsed as { runId?: unknown }).runId
    return typeof value === 'number' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Record that THIS run has validated dist, so later workers do not re-decide against the clock.
 *
 * `markerPath` is injectable for ONE reason, learned the hard way: a test that exercised this by
 * deleting the real marker sabotaged the other workers reading dist at that moment — it re-created
 * the very race the marker removes, and took four unrelated test files down with it. Shared
 * cross-process state is not something a test may borrow.
 */
export const markDistValidatedForThisRun = (markerPath: string = VALIDATION_MARKER): void => {
  mkdirSync(resolve(markerPath, '..'), { recursive: true })
  writeFileSync(markerPath, JSON.stringify({ runId: runId() }), 'utf8')
}

/**
 * Whether dist can be read without rebuilding.
 *
 * The marker vouches for a validation, never for the existence of files — so a missing `index.d.ts`
 * is unusable no matter which run wrote the marker. Otherwise: same run ⇒ trust it; another run ⇒
 * the freshness window decides.
 *
 * `distTypesPath` is injectable for the same reason `markerPath` already was, and its absence was
 * the whole of usetheokit/theokit#375. The tests isolated the marker and then asserted against the
 * REAL `packages/theo/dist/index.d.ts` — shared, cross-worker, and being rewritten by whichever
 * suite happened to be building at that moment. So the guard that exists to end a dist race lost
 * one: it passed alone and failed intermittently in the full suite. Three of its cases also
 * degraded to `if (existsSync(dts)) return`, silently exercising nothing, and a fourth stamped the
 * mtime of the real build output — a test writing to the state its siblings read.
 */
export const isDistUsableWithoutRebuilding = (
  markerPath: string = VALIDATION_MARKER,
  distTypesPath: string = INDEX_DTS,
): boolean => {
  if (!existsSync(distTypesPath)) return false
  if (markerRunId(markerPath) === runId()) return true
  return Date.now() - statSync(distTypesPath).mtimeMs < FRESH_WINDOW_MS
}

const hasFreshBuild = isDistUsableWithoutRebuilding

/**
 * This process's single answer to "is dist/ usable?".
 *
 * `undefined` until the first caller asks. After that every caller in the run reuses it, so the
 * freshness window cannot expire between two tests of the same suite and turn a reader's valid dist
 * into a rebuild.
 */
let distDecidedUsable: boolean | undefined

const acquireLock = (): number | null => {
  mkdirSync(LOCK_DIR, { recursive: true })
  try {
    return openSync(LOCK_FILE, 'wx')
  } catch {
    return null
  }
}

const waitForLockRelease = (timeoutMs = 240_000): void => {
  const start = Date.now()
  while (existsSync(LOCK_FILE) && Date.now() - start < timeoutMs) {
    const until = Date.now() + 100
    while (Date.now() < until) {
      // busy-wait 100ms slice — acceptable for serializing build runs
    }
  }
}

export const buildTheokitPackageOnce = (): void => {
  if (distDecidedUsable === true) return
  if (hasFreshBuild()) {
    distDecidedUsable = true
    // Publish the conclusion so a worker starting later in this run reaches the same one instead of
    // re-deciding against a clock that may have moved past the window.
    markDistValidatedForThisRun()
    return
  }
  const lockFd = acquireLock()
  if (lockFd === null) {
    waitForLockRelease()
    if (hasFreshBuild()) {
      distDecidedUsable = true
      markDistValidatedForThisRun()
      return
    }
    // Lock released but no dist still — fall through and build ourselves
  }
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- developer-local test running the framework's own build CLI
    execSync('pnpm --filter theokit build', {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 240_000,
    })
    distDecidedUsable = true
    markDistValidatedForThisRun()
  } finally {
    if (lockFd !== null) closeSync(lockFd)
    try {
      unlinkSync(LOCK_FILE)
    } catch {
      // already removed by other process
    }
  }
}

/**
 * Budget for a `beforeAll` that calls {@link buildTheokitPackageOnce}.
 *
 * Vitest's default `hookTimeout` is **10 s**, and this helper may run `pnpm --filter theokit build`
 * — for which it allows 240 s — or wait on another worker's build lock. A 10 s ceiling over that is
 * not a timeout, it is a coin flip: it passed for as long as `dist` happened to be warm, and started
 * failing in CI the moment file parallelism let several workers reach the lock at once.
 *
 * Declared here, next to the 240 s the build itself gets, so the two numbers cannot drift apart.
 */
export const BUILD_HOOK_TIMEOUT_MS = 300_000

export const THEOKIT_DIST = DIST

/** Reset the per-process decision. Exists so the guard below can exercise both branches. */
export const __resetBuildDecisionForTests = (): void => {
  distDecidedUsable = undefined
}
