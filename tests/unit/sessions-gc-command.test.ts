import { describe, expect, it } from 'vitest'

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  formatGcPlan,
  sessionsGcCommand,
} from '../../packages/theo/src/cli/commands/sessions-gc.js'

/**
 * M72 — the operator-facing half of transcript retention.
 *
 * The plan's correctness is proven in `packages/agents/tests/unit/transcript-gc.test.ts`; what this
 * asserts is the thing the operator actually receives. A retention pass whose output does not say
 * WHICH sessions went and WHY the others stayed cannot be reviewed, and reviewing it is the entire
 * reason `--apply` is not the default.
 */

const plan = {
  cwd: '/p',
  root: '/r',
  candidates: [{ id: 'old-1', transcript: '/r/old-1.jsonl', modifiedAt: new Date(0) }],
  kept: [
    { id: 'live', reason: 'active writer lease' },
    { id: 'recent', reason: 'within the newest 10' },
  ],
}

describe('formatGcPlan', () => {
  it('test_a_dry_run_says_nothing_was_deleted', () => {
    // The single most important line: an operator skimming the output must not mistake a preview
    // for an execution.
    const lines = formatGcPlan(plan, { dryRun: true, removed: ['old-1'], errors: [] })
    expect(lines.join('\n')).toMatch(/dry run/i)
    expect(lines.join('\n')).toMatch(/nothing was deleted/i)
    expect(lines.join('\n')).toMatch(/would remove/i)
  })

  it('test_an_applied_run_does_NOT_claim_to_be_a_dry_run', () => {
    const lines = formatGcPlan(plan, { dryRun: false, removed: ['old-1'], errors: [] })
    expect(lines.join('\n')).not.toMatch(/dry run/i)
    expect(lines.join('\n')).toMatch(/applied/i)
  })

  it('test_every_kept_session_is_printed_WITH_its_reason', () => {
    // "Skipped 4 sessions" tells an operator nothing. "kept because it holds an active writer
    // lease" tells them whether to go stop something.
    const text = formatGcPlan(plan, { dryRun: true, removed: [], errors: [] }).join('\n')
    expect(text).toContain('live — active writer lease')
    expect(text).toContain('recent — within the newest 10')
  })

  it('test_failures_are_printed_and_say_the_rest_still_ran', () => {
    // Fail-open per candidate is only defensible if the operator learns which one failed.
    const text = formatGcPlan(plan, {
      dryRun: false,
      removed: ['old-2'],
      errors: [{ id: 'old-1', message: 'EACCES' }],
    }).join('\n')
    expect(text).toMatch(/old-1/)
    expect(text).toMatch(/EACCES/)
    expect(text).toMatch(/rest still ran/i)
  })

  it('test_an_empty_plan_says_so_rather_than_printing_nothing', () => {
    // Silence reads as failure. "Nothing to collect" is the answer.
    const text = formatGcPlan(
      { ...plan, candidates: [], kept: [] },
      { dryRun: true, removed: [], errors: [] },
    ).join('\n')
    expect(text).toMatch(/nothing to collect/i)
  })
})

/**
 * F-wire-1 — the command itself, not just its formatter.
 *
 * The tests above cover `formatGcPlan`, a pure function, with hand-built result objects. Nothing
 * called `sessionsGcCommand`, which is the function that actually invokes `runTranscriptGC` — so
 * when T2.2 made that async, the only in-repo production caller kept calling it synchronously and
 * every test still passed. `result.removed` was `undefined` on a Promise, and `.length` threw
 * before the command printed anything.
 *
 * `pnpm typecheck` did not catch it either: `packages/agents/dist/session.d.ts` was a day older
 * than the source and still declared the synchronous return, so the whole workspace typechecked
 * against pre-change types.
 *
 * The lesson is the one this branch keeps re-learning: a test that exercises the pure half of a
 * module is not a test of the module.
 */
describe('sessionsGcCommand — the seam the formatter tests never crossed', () => {
  it('test_the_command_returns_rendered_lines_not_a_pending_promise', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gc-cmd-root-'))
    const cwd = mkdtempSync(join(tmpdir(), 'gc-cmd-cwd-'))
    const dir = join(root, 'projects', cwd.replace(/[/\\]/g, '-'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'only.jsonl'), '{"type":"user"}\n')

    // THEOKIT_HOME rather than a `root` option: the command has no such option, and adding one
    // purely so a test can reach it would put a test-only parameter on a user-facing CLI. The env
    // var is the mechanism `transcriptRoot()` actually honours, so this drives the production path.
    const previous = process.env.THEOKIT_HOME
    process.env.THEOKIT_HOME = root
    let result
    try {
      result = await sessionsGcCommand({ cwd })
    } finally {
      if (previous === undefined) delete process.env.THEOKIT_HOME
      else process.env.THEOKIT_HOME = previous
    }

    expect(Array.isArray(result.lines), 'lines must be rendered, not a thenable').toBe(true)
    expect(result.lines.length).toBeGreaterThan(0)
    expect(typeof result.failed).toBe('number')
    // The formatter reads `result.dryRun` off the GC result. Unawaited, that is `undefined` on a
    // Promise and the run silently reports itself as applied.
    expect(result.lines.join('\n')).toContain('Dry run')
  })

  it('test_a_default_invocation_never_deletes', async () => {
    // `apply` defaults to false; asserted here because this command removes user transcripts and
    // the default must stay the harmless one.
    const root = mkdtempSync(join(tmpdir(), 'gc-cmd-root-'))
    const cwd = mkdtempSync(join(tmpdir(), 'gc-cmd-cwd-'))
    const dir = join(root, 'projects', cwd.replace(/[/\\]/g, '-'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'a.jsonl'), '{"type":"user"}\n')

    const previous = process.env.THEOKIT_HOME
    process.env.THEOKIT_HOME = root
    let result
    try {
      result = await sessionsGcCommand({ cwd })
    } finally {
      if (previous === undefined) delete process.env.THEOKIT_HOME
      else process.env.THEOKIT_HOME = previous
    }

    expect(existsSync(join(dir, 'a.jsonl'))).toBe(true)
    expect(result.failed).toBe(0)
  })
})
