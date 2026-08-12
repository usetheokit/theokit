/**
 * Shared build helper for tests that assert on `fixtures/template-default`'s
 * production bundle. Multiple tests can request a build concurrently — we
 * serialize via filesystem mutex AND reuse a build that is fresh (mtime
 * within 5 minutes) to avoid clobbering each other in vitest's parallel
 * worker pool.
 *
 * Rationale: the previous race produced `dist/` disappearing between
 * `existsSync` and `readFileSync` because two `pnpm exec theokit build`
 * processes were deleting `.theokit/` simultaneously.
 */
import { execSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(__dirname, '../../..')
const FIXTURE = resolve(ROOT, 'fixtures/template-default')
const ASSETS = resolve(FIXTURE, '.theokit/client/assets')
const LOCK_DIR = resolve(tmpdir(), 'theokit-test-locks')
const LOCK_FILE = resolve(LOCK_DIR, 'template-default-build.lock')
const FRESH_WINDOW_MS = 5 * 60 * 1000

const hasFreshBuild = (): boolean => {
  if (!existsSync(ASSETS)) return false
  const indexFiles = readdirSync(ASSETS).filter((f) => /^index-.*\.js$/.test(f))
  if (indexFiles.length === 0) return false
  const newest = indexFiles
    .map((f) => statSync(join(ASSETS, f)).mtimeMs)
    .reduce((a, b) => Math.max(a, b), 0)
  return Date.now() - newest < FRESH_WINDOW_MS
}

const acquireLock = (): number | null => {
  mkdirSync(LOCK_DIR, { recursive: true })
  try {
    return openSync(LOCK_FILE, 'wx')
  } catch {
    return null
  }
}

const waitForLockRelease = (timeoutMs = 180_000): void => {
  const start = Date.now()
  while (existsSync(LOCK_FILE) && Date.now() - start < timeoutMs) {
    const buffer = Buffer.alloc(4096)
    // Busy-wait 50ms slices — acceptable for build coordination
    const until = Date.now() + 50
    while (Date.now() < until) {
      buffer[0] = 0
    }
  }
}

export const buildTemplateDefaultOnce = (): void => {
  if (hasFreshBuild()) return
  const lockFd = acquireLock()
  if (lockFd === null) {
    waitForLockRelease()
    if (hasFreshBuild()) return
    // Lock released but no build present — fall through to build ourselves
  }
  try {
    // `stdio: 'pipe'` keeps the build quiet on the happy path, which is right — but the previous
    // shape then let the failure surface as a bare `Command failed: pnpm exec theokit build`, with
    // the compiler's own explanation discarded.
    //
    // That is not a cosmetic loss. This build fails in CI and succeeds locally, and for three
    // consecutive runs the only thing anyone could learn from the log was that it failed. A test
    // whose failure carries no evidence is a test that gets re-run and then ignored.
    //
    // The catch below re-throws with the captured output attached. Backlog B-M67-17.
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- developer-local test running the framework's own CLI
    execSync('pnpm exec theokit build', {
      cwd: FIXTURE,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        CI: '1',
        // T5a.2 prerequisite: template-default fixture doesn't install
        // better-sqlite3 (CLI's hard-required native dep). Skip preflight
        // ABI check — Node-floor check stays enforced.
        THEOKIT_SKIP_NATIVE_PREFLIGHT: '1',
      },
      timeout: 180_000,
    })
  } catch (cause) {
    const { stdout, stderr } = cause as { stdout?: Buffer | string; stderr?: Buffer | string }
    // `execSync` puts `undefined` on the stream it did not capture, and `String(undefined)` is the
    // literal text "undefined" — which then appears in the report as if the build had said it.
    const asText = (stream: Buffer | string | undefined): string =>
      stream === undefined ? '' : String(stream)
    const output = [asText(stdout), asText(stderr)].join('\n').trim()
    throw new Error(
      `\`pnpm exec theokit build\` failed in ${FIXTURE}.\n\n` +
        (output.length > 0
          ? `The build said:\n${output.slice(-4000)}`
          : 'The build produced no output at all — check that the `theokit` bin resolves in the ' +
            'fixture (it comes from the workspace link, so `packages/theo` must be built first).'),
      { cause },
    )
  } finally {
    if (lockFd !== null) closeSync(lockFd)
    try {
      unlinkSync(LOCK_FILE)
    } catch {
      // already removed by other process — fine
    }
  }
}

export const TEMPLATE_DEFAULT_FIXTURE = FIXTURE
export const TEMPLATE_DEFAULT_ASSETS = ASSETS
