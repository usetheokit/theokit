import { execFileSync } from 'node:child_process'

/**
 * B-429 — the whole run must leave `git status --porcelain` unchanged under `packages/`.
 *
 * A test that writes a probe inside the source tree is read by a concurrent lint, build or
 * typecheck. The status is snapshotted before the run and compared after it, so a leaked file
 * fails the run (even if it is cleaned up late) and names the paths. Pre-existing local changes are
 * part of the snapshot and do not count.
 */
function status(): string[] {
  try {
    return execFileSync('git', ['status', '--porcelain', '--', 'packages/'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean)
  } catch {
    return [] // not a git checkout (e.g. a source tarball): nothing to compare
  }
}

let before: string[] = []

export function setup(): void {
  before = status()
}

export function teardown(): void {
  const seen = new Set(before)
  const leaked = status().filter((line) => !seen.has(line))
  if (leaked.length > 0) {
    throw new Error(
      `B-429: the test run changed the source tree under packages/:\n${leaked.join('\n')}\n` +
        'Tests must write probe files to os.tmpdir(), not into packages/.',
    )
  }
}
