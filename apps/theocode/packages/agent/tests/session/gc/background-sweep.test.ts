/**
 * B-142 — the background sweep starts and returns; it does not sweep.
 *
 * The whole point is the return, so the assertions are about what happens BEFORE the child finishes.
 */
import { mkdtempSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * Scratch roots, removed when the file finishes.
 *
 * MEASURED 2026-09-03: /tmp held 2 773 leaked `theocode-*` directories from suites that create one
 * per case and never remove it. Sixteen other test files here already clean up, so this follows the
 * convention rather than inventing one, and the cost of skipping it is paid once per test on every
 * machine that ever runs the suite.
 */
const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

import { startSessionSweepInBackground } from '../../../src/session/gc/auto-runtime.js'

function scratchRoot(): string {
  const base = mkdtempSync(join(tmpdir(), 'theocode-bgsweep-'))
  roots.push(base)
  const root = join(base, 'projects')
  mkdirSync(root, { recursive: true })
  return root
}
const stampOf = (root: string): string => join(root, '..', '.last-session-gc')

/**
 * A child that never runs: the test asserts what the parent did, not what a sweep found.
 *
 * `closingWith` is the variant that FIRES the close handler, because the parent's only user-visible
 * output happens there — and a mutation check proved that branch was unprotected: deleting the
 * entire first-run sentence, the one that tells the operator how to turn deletion off, left the
 * suite green.
 */
const fakeChild = (): { on: (e: 'close', cb: (c: number | null) => void) => void } => ({
  on: () => {},
})

const closingWith = (
  code: number | null,
): { on: (e: 'close', cb: (c: number | null) => void) => void } => ({
  on: (_event, cb) => {
    cb(code)
  },
})

describe('startSessionSweepInBackground', () => {
  it('test_it_hands_the_sweep_to_a_child_and_returns_before_that_child_finishes', () => {
    // The finding, as an assertion: 37 s of synchronous sweeping used to happen inside this call.
    //
    // What proves the delegation is the SEAM, not the clock. `spawnSweep` is injected, so "the work
    // was handed to a child" is a fact this test can read directly; `fakeChild` never fires `close`,
    // so a parent that waited for the sweep to finish could not have returned here at all, and one
    // that reported a finished sweep would have had to invent it.
    //
    // The clock stays only as a coarse regression net, and its ceiling is chosen against the
    // measurement `spawn-sweep.ts` records: 4.9 s was the FASTEST in-process sweep ever measured
    // (warm, 13 269 projects). Anything under that is evidence the parent did not do the work, and
    // 4 s is far enough above a delegating call — which spawns nothing here — that a loaded runner
    // cannot approach it. The old ceiling was 500 ms, close enough to the contention this repository
    // documents in `vitest.config.ts` to decide a pass on scheduling.
    //
    // Stated honestly, because the net is weaker than it looks: `projectsRootOverride` points at an
    // EMPTY directory, so an inline sweep of THAT root would return in microseconds and no clock
    // could see it. The delegation assertion is what carries the claim; the clock only catches a
    // parent that goes looking at the real tree.
    const root = scratchRoot()
    const handed: (readonly string[])[] = []
    const reports: string[] = []
    const started = Date.now()

    const outcome = startSessionSweepInBackground({
      enabled: true,
      onReport: (l) => reports.push(l),
      projectsRootOverride: root,
      spawnSweep: (cmd) => {
        handed.push(cmd.args)
        return fakeChild()
      },
    })

    expect(outcome.started).toBe(true)
    expect(handed, 'the sweep was never handed to a child — this call did the work itself').toHaveLength(1)
    expect(handed[0], 'the child was spawned without the collector subcommand').toContain('gc')
    expect(reports, 'the call reported a finished sweep before the child had finished one').toEqual([])
    expect(Date.now() - started, 'the call took longer than the fastest sweep ever measured').toBeLessThan(4_000)
  })

  it('test_a_disabled_collector_spawns_nothing_and_stamps_nothing', () => {
    const root = scratchRoot()
    let spawned = false

    const outcome = startSessionSweepInBackground({
      enabled: false,
      onReport: () => {},
      projectsRootOverride: root,
      spawnSweep: () => {
        spawned = true
        return fakeChild()
      },
    })

    expect(outcome).toMatchObject({ started: false, reason: 'disabled' })
    expect(spawned).toBe(false)
    expect(existsSync(stampOf(root))).toBe(false)
  })

  it('test_the_first_sweep_asks_the_child_NOT_to_apply', () => {
    // B-139 has to survive the move to a child process, or the redesign silently undoes it.
    const root = scratchRoot()
    let args: readonly string[] = []

    startSessionSweepInBackground({
      enabled: true,
      onReport: () => {},
      projectsRootOverride: root,
      spawnSweep: (cmd) => {
        args = cmd.args
        return fakeChild()
      },
    })

    expect(args).toContain('gc')
    expect(args, 'the first background sweep would have deleted').not.toContain('--apply')
  })

  it('test_the_second_sweep_asks_the_child_to_apply', () => {
    // Anti-vacuity: never passing --apply is the useless collector B-138 was about.
    const root = scratchRoot()
    writeFileSync(stampOf(root), new Date('2026-09-01T00:00:00Z').toISOString())
    let args: readonly string[] = []

    startSessionSweepInBackground({
      enabled: true,
      now: new Date('2026-09-05T00:00:00Z'),
      onReport: () => {},
      projectsRootOverride: root,
      spawnSweep: (cmd) => {
        args = cmd.args
        return fakeChild()
      },
    })

    expect(args).toContain('--apply')
  })

  it('test_it_does_not_spawn_twice_inside_the_interval', () => {
    const root = scratchRoot()
    let spawns = 0
    const call = (now: Date): void => {
      startSessionSweepInBackground({
        enabled: true,
        now,
        onReport: () => {},
        projectsRootOverride: root,
        spawnSweep: () => {
          spawns += 1
          return fakeChild()
        },
      })
    }

    call(new Date('2026-09-03T12:00:00Z'))
    call(new Date('2026-09-03T13:00:00Z'))

    expect(spawns).toBe(1)
  })

  it('test_a_spawn_failure_is_reported_and_never_thrown', () => {
    // It runs beside a user's session. Housekeeping that can take the agent down is worse than
    // housekeeping that does not happen.
    const root = scratchRoot()
    const reports: string[] = []

    const outcome = startSessionSweepInBackground({
      enabled: true,
      onReport: (l) => reports.push(l),
      projectsRootOverride: root,
      spawnSweep: () => {
        throw new Error('EAGAIN')
      },
    })

    expect(outcome).toMatchObject({ started: false, reason: 'spawn-failed' })
    expect(reports.join(' ')).toContain('EAGAIN')
  })
})

describe('what the operator is told when the child finishes', () => {
  const reportFor = (opts: { stamped?: string }): string[] => {
    const root = scratchRoot()
    if (opts.stamped !== undefined) writeFileSync(stampOf(root), opts.stamped)
    const reports: string[] = []
    startSessionSweepInBackground({
      enabled: true,
      now: new Date('2026-09-05T00:00:00Z'),
      onReport: (l) => reports.push(l),
      projectsRootOverride: root,
      spawnSweep: () => closingWith(0),
    })
    return reports
  }

  it('test_the_first_sweep_says_it_removed_nothing_and_how_to_keep_collection_manual', () => {
    // This sentence is the entire consent story for a default that deletes an operator's
    // transcripts. Losing it is not a cosmetic regression.
    const text = reportFor({}).join(' ')

    expect(text).toContain('DRY RUN')
    expect(text, 'the operator was not told how to turn it off').toContain('session_gc = false')
  })

  it('test_a_later_sweep_does_not_repeat_the_first_run_sentence', () => {
    // Anti-vacuity: printing it every time would satisfy the test above and turn the one message
    // that matters into noise the operator learns to skip.
    const text = reportFor({ stamped: new Date('2026-09-01T00:00:00Z').toISOString() }).join(' ')

    expect(text).toContain('background sweep finished')
    expect(text).not.toContain('DRY RUN')
  })

  it('test_a_non_zero_exit_is_reported_rather_than_read_as_success', () => {
    // A child that died is not a sweep that ran. Reporting "finished" for both is the shape that
    // makes a broken collector look healthy for as long as nobody checks.
    const root = scratchRoot()
    const reports: string[] = []
    startSessionSweepInBackground({
      enabled: true,
      onReport: (l) => reports.push(l),
      projectsRootOverride: root,
      spawnSweep: () => closingWith(1),
    })

    expect(reports.join(' ')).toContain('exit 1')
  })
})

/**
 * B-150 — moving the sweep to a child process threw away what it did.
 *
 * B-132's DoD says "what the automation did is visible, so 'it ran and removed nothing' is
 * distinguishable from 'it never ran'". B-139's says "the first automatic sweep removes nothing and
 * SAYS WHAT IT WOULD HAVE REMOVED". Both were met by the in-process form, which reported counts.
 *
 * B-142 moved the sweep into a child spawned with `stdio: 'ignore'` and the counts went with it. The
 * parent said "background sweep finished" and nothing else — so two Definitions of Done regressed
 * silently, in items already marked shipped, by a fix for a third.
 *
 * The instrument was wrong for the concern. `'ignore'` was chosen because "the TUI owns the screen",
 * which is an argument against INHERITING the child's streams. Piping captures them without
 * displaying anything, which is what was wanted all along.
 */
describe('what the child did reaches the operator', () => {
  const childSaying = (line: string) => ({
    stdout: {
      on: (_e: 'data', cb: (chunk: unknown) => void) => {
        cb(line)
      },
    },
    on: (_event: 'close', cb: (code: number | null) => void) => {
      cb(0)
    },
  })

  it('test_the_first_sweep_reports_what_it_WOULD_have_removed', () => {
    // B-139's bullet. "Nothing was removed" without "and here is what would have been" tells the
    // operator the collector is harmless, not what it is about to do to them tomorrow.
    const root = scratchRoot()
    const reports: string[] = []

    startSessionSweepInBackground({
      enabled: true,
      onReport: (l) => reports.push(l),
      projectsRootOverride: root,
      spawnSweep: () => childSaying('DRY-RUN — nothing was removed; use --apply to execute\n'),
    })

    expect(reports.join(' ')).toContain('DRY-RUN')
  })

  it('test_an_applying_sweep_reports_its_counts', () => {
    // B-132's bullet. "Finished" is not "removed 12", and the difference is the whole point of the
    // requirement.
    const root = scratchRoot()
    writeFileSync(stampOf(root), new Date('2026-09-01T00:00:00Z').toISOString())
    const reports: string[] = []

    startSessionSweepInBackground({
      enabled: true,
      now: new Date('2026-09-05T00:00:00Z'),
      onReport: (l) => reports.push(l),
      projectsRootOverride: root,
      spawnSweep: () => childSaying('APPLIED — 12 artifact(s) removed\n'),
    })

    expect(reports.join(' ')).toContain('12')
  })

  it('test_a_silent_child_still_produces_a_report', () => {
    // Anti-vacuity in the direction that matters: if the child says nothing, the parent must still
    // say the sweep happened. Reporting only when there is output would make a broken child
    // indistinguishable from a collector that never ran.
    const root = scratchRoot()
    const reports: string[] = []

    startSessionSweepInBackground({
      enabled: true,
      onReport: (l) => reports.push(l),
      projectsRootOverride: root,
      spawnSweep: () => ({ on: (_e, cb) => cb(0) }),
    })

    expect(reports.join(' ')).toContain('sweep')
  })
})

/**
 * The three tolerant helpers, on the branch that makes them tolerant.
 *
 * Each one catches and carries on, and each catch is a DECISION with a consequence — measured
 * 2026-09-03 as the only uncovered lines this release added to the file. `rules/error-handling.md`
 * puts negative cases where the handling is proven; a swallow whose report is untested is
 * indistinguishable from a swallow.
 */
describe('the sweep reports what it could not do instead of failing', () => {
  it('test_a_missing_entry_point_is_reported_rather_than_silently_not_swept', () => {
    // The sharpest of the three. `buildSweepCommand` refuses to spawn without a script, because a
    // child with none exits 0 having swept nothing and the collector would announce a finished sweep
    // every day while collecting nothing — B-138. Refusing is only half the fix; saying so is the
    // other half, and it is this line.
    const root = scratchRoot()
    const said: string[] = []
    const argv = process.argv
    process.argv = [argv[0] ?? 'node']

    try {
      const outcome = startSessionSweepInBackground({
        enabled: true,
        onReport: (l) => said.push(l),
        projectsRootOverride: root,
        spawnSweep: fakeChild,
      })

      expect(outcome.started).toBe(false)
      expect(outcome.reason).toBe('unspawnable')
      expect(said.join(' '), 'the sweep refused to start and said nothing').toContain('no script')
    } finally {
      process.argv = argv
    }
  })

  it('test_an_unwritable_state_directory_does_not_stop_the_sweep', () => {
    // A read-only home must not mean the retention policy stops being applied; it means the interval
    // is not remembered, which is the smaller of the two problems. The stamp lives one level ABOVE
    // the projects root, so a root nested under a FILE makes the write fail without touching the
    // caller's disk.
    const blocker = join(scratchRoot(), 'a-file')
    mkdirSync(dirname(blocker), { recursive: true })
    writeFileSync(blocker, 'not a directory\n')
    const said: string[] = []

    const outcome = startSessionSweepInBackground({
      enabled: true,
      onReport: (l) => said.push(l),
      projectsRootOverride: join(blocker, 'nested', 'projects'),
      spawnSweep: fakeChild,
    })

    expect(outcome.started, 'a stamp that could not be written stopped the collection').toBe(true)
    expect(said.join(' ')).toContain('could not record the run time')
  })

  it('test_a_healthy_run_reports_neither_of_those', () => {
    // Anti-vacuity: a helper that reported unconditionally would satisfy both assertions above.
    const said: string[] = []

    startSessionSweepInBackground({
      enabled: true,
      onReport: (l) => said.push(l),
      projectsRootOverride: scratchRoot(),
      spawnSweep: fakeChild,
    })

    expect(said.join(' ')).not.toContain('could not')
    expect(said.join(' ')).not.toContain('no script')
  })
})

describe('a stamp that cannot be understood is not a stamp', () => {
  it('test_a_corrupt_stamp_lets_the_sweep_run_rather_than_blocking_it_forever', () => {
    // What this proves, stated precisely, because the first version of this comment overclaimed.
    //
    // It asserts the OUTCOME — a stamp that does not parse must not stop collection, because a
    // garbage date honoured as real could park the interval in the future and disable the collector
    // permanently. It does NOT pin `readLastRun`'s NaN branch, and a mutation check is what showed
    // the difference: replacing that branch with `return at` leaves this test green, because
    // `sweepDecision` guards NaN a second time (`auto.ts:51`).
    //
    // The redundancy is deliberate and worth keeping — the two functions are separately reachable —
    // but it means the first guard is not observable through this seam. Claiming otherwise would
    // make this one of the blind tests this session spent its time removing.
    const root = scratchRoot()
    mkdirSync(dirname(root), { recursive: true })
    writeFileSync(join(dirname(root), '.last-session-gc'), 'not a date at all\n')

    const outcome = startSessionSweepInBackground({
      enabled: true,
      onReport: () => {},
      projectsRootOverride: root,
      spawnSweep: fakeChild,
    })

    expect(outcome.started, 'a corrupt stamp stopped the collector').toBe(true)
    expect(outcome.reason, 'a corrupt stamp was read as a real previous run').toBe('first-run-dry')
  })

  it('test_a_stamp_from_an_hour_ago_still_holds_the_sweep_back', () => {
    // Anti-vacuity: a reader that discarded every stamp would satisfy the assertion above.
    const root = scratchRoot()
    mkdirSync(dirname(root), { recursive: true })
    writeFileSync(join(dirname(root), '.last-session-gc'), new Date().toISOString())

    const outcome = startSessionSweepInBackground({
      enabled: true,
      onReport: () => {},
      projectsRootOverride: root,
      spawnSweep: fakeChild,
    })

    expect(outcome.started).toBe(false)
    expect(outcome.reason).toBe('too-soon')
  })
})
