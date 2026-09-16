/**
 * #105 — a non-zero exit does not throw away what git printed.
 *
 * For several subcommands a non-zero exit IS the answer rather than a failure: `git diff` exits 1
 * when there is a difference under `--no-index` or `--exit-code`, and it has already written the
 * diff to stdout by then. `execFileSync` throws on that exit, and the catch was returning
 * `stdout: ''` — so the caller saw a failed call and an empty result where git had produced a
 * complete answer.
 *
 * Measured on the real product: the end-of-turn diff printed nothing for a file the agent had just
 * created, because a newly created file is untracked and the only way to diff it is `--no-index`,
 * which always exits 1 when it finds the difference it was asked to find.
 *
 * `ok` still reports the exit status, unchanged, so no existing caller changes behaviour. What
 * changes is that the output is no longer discarded on the way past.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { createGitRunner } from '../src/git-runner.js'

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

describe('#105 — git output survives a non-zero exit', () => {
  it('test_a_no_index_diff_returns_its_body_even_though_it_exits_one', () => {
    const dir = tempRoot('git-exit-')
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'hello\n')

    const git = createGitRunner({ timeoutMs: 10_000, onWarn: () => {} })
    const res = git(['diff', '--no-index', '--', '/dev/null', file])

    expect(res.ok, 'git diff --no-index exits 1 on a difference; ok must still report that').toBe(false)
    expect(res.stdout, 'the diff git printed was discarded').toContain('+hello')
  })

  it('test_a_real_failure_still_yields_no_output', () => {
    // Anti-vacuity: returning the error text as stdout would satisfy the arm above. A command that
    // never produced output must still produce none.
    const git = createGitRunner({ timeoutMs: 10_000, onWarn: () => {} })
    const res = git(['rev-parse', '--verify', 'refs/heads/definitely-not-a-branch-xyzzy'])

    expect(res.ok).toBe(false)
    expect(res.stdout.trim()).toBe('')
  })
})
