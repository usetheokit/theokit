/**
 * The pre-commit gate refuses a commit that grew paths nobody staged
 * (usetheokit/theokit#378).
 *
 * The defect it guards: with a partially staged file in the tree — index content
 * differing from the worktree, which is what `git add -p` produces and what two
 * people editing the same CHANGELOG produce — lint-staged's stash/restore cycle
 * restored the whole working tree into the index. A commit that named six paths
 * carried fourteen, and the eight extra were somebody else's unfinished work. The
 * commit after it then deleted the six, because its tree snapshot predated them.
 *
 * Both were recovered by a human reading `git show --stat`. Nothing in the
 * tooling noticed, which is the part worth fixing: the loss is silent and the
 * recovery depends on somebody being suspicious.
 *
 * The check lives in its own script so it can be exercised here. A gate that only
 * runs inside a git hook is a gate nobody tests until the day it matters.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const GATE = resolve(__dirname, '../../.githooks/assert-no-unstaged-sneaked-in.sh')

interface GateResult {
  code: number
  stderr: string
}

describe('the pre-commit gate against a widened commit (#378)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sneaked-in-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * Run the gate over two staged-path listings, as the hook does.
   *
   * Callers pass paths already in the order `sort(1)` produces, because that is
   * what the hook feeds `comm` and `comm` requires both inputs in the SAME order.
   * Re-sorting here with a JS collation would be a different order than the shell's
   * byte order, and the fixture would stop resembling the thing under test.
   */
  const run = (before: string[], after: string[]): GateResult => {
    const b = join(dir, 'before')
    const a = join(dir, 'after')
    writeFileSync(b, before.length === 0 ? '' : `${before.join('\n')}\n`)
    writeFileSync(a, after.length === 0 ? '' : `${after.join('\n')}\n`)
    try {
      // The hook runs under whatever bash the developer's git found. Resolving a fixed
      // path here would exercise a different interpreter than the one that runs the gate.
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
      execFileSync('bash', [GATE, b, a], { encoding: 'utf8', stdio: 'pipe' })
      return { code: 0, stderr: '' }
    } catch (err) {
      const e = err as { status?: number; stderr?: string }
      return { code: e.status ?? -1, stderr: e.stderr ?? '' }
    }
  }

  it('test_an_unchanged_staged_set_passes', () => {
    expect(run(['CHANGELOG.md', 'src/a.ts'], ['CHANGELOG.md', 'src/a.ts']).code).toBe(0)
  })

  it('test_a_shrinking_staged_set_passes', () => {
    // Legitimate: a formatter can leave a file byte-identical, dropping it from the
    // index. Refusing that would block ordinary commits to stop a rare one.
    expect(run(['CHANGELOG.md', 'src/a.ts'], ['src/a.ts']).code).toBe(0)
  })

  it('test_a_grown_staged_set_is_refused_and_names_what_appeared', () => {
    const result = run(
      ['CHANGELOG.md', 'src/a.ts'],
      ['CHANGELOG.md', 'other/unfinished.ts', 'src/a.ts'],
    )

    expect(result.code).toBe(1)
    // The fifth metric: the message names the file, why, and what to do about it.
    expect(result.stderr).toContain('other/unfinished.ts')
    expect(result.stderr).toContain('git reset')
    expect(result.stderr).not.toContain('src/a.ts')
  })

  it('test_the_real_shape_of_the_incident_is_refused', () => {
    // The six paths of `3762c7d0f` against the fourteen the hook actually committed.
    const staged = [
      '.changeset/agent-step-ceiling.md',
      'CHANGELOG.md',
      'packages/agents/src/bridge/agent-builder.ts',
      'packages/agents/src/bridge/define-agent.ts',
      'packages/agents/src/bridge/sdk-adapter.ts',
      'packages/agents/tests/integration/step-ceiling.test.ts',
    ]
    const committed = [...staged, 'packages/theo/src/vite-plugin/server-boundary.ts']

    const result = run(staged, committed)

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('packages/theo/src/vite-plugin/server-boundary.ts')
  })

  it('test_an_empty_staged_set_on_both_sides_passes', () => {
    // `comm` over two empty listings must not be read as growth.
    expect(run([], []).code).toBe(0)
  })

  it('test_growth_from_an_empty_staged_set_is_refused', () => {
    expect(run([], ['appeared.ts']).code).toBe(1)
  })
})
