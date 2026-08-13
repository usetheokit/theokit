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
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, openSync, closeSync, unlinkSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(__dirname, '../../..')
const DIST = resolve(ROOT, 'packages/theo/dist')
const INDEX_DTS = resolve(DIST, 'index.d.ts')
const LOCK_DIR = resolve(tmpdir(), 'theokit-test-locks')
const LOCK_FILE = resolve(LOCK_DIR, 'packages-theo-build.lock')
const FRESH_WINDOW_MS = 10 * 60 * 1000

const hasFreshBuild = (): boolean => {
  if (!existsSync(INDEX_DTS)) return false
  return Date.now() - statSync(INDEX_DTS).mtimeMs < FRESH_WINDOW_MS
}

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
    return
  }
  const lockFd = acquireLock()
  if (lockFd === null) {
    waitForLockRelease()
    if (hasFreshBuild()) {
      distDecidedUsable = true
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
  } finally {
    if (lockFd !== null) closeSync(lockFd)
    try {
      unlinkSync(LOCK_FILE)
    } catch {
      // already removed by other process
    }
  }
}

export const THEOKIT_DIST = DIST

/** Reset the per-process decision. Exists so the guard below can exercise both branches. */
export const __resetBuildDecisionForTests = (): void => {
  distDecidedUsable = undefined
}
