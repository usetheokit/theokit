/**
 * B-142 — the sweep runs in another process, because `void` cannot make synchronous work async.
 *
 * An independent review measured the trigger against the tree this repository itself cites as
 * measured (13 269 projects, `filesystem.ts:31-38`): the event loop was blocked for **37.1 s cold
 * and 4.9–13.2 s warm**. `planAllProjectsOnDisk` is `async`, but its body runs synchronously until
 * the first `await`, and `classifyProjects` is invoked eagerly while the argument object is built —
 * so `void collectSessionsAutomatically(...)` deferred the tail and the tail was empty. The comment
 * in `main.tsx` claiming "housekeeping must never be something the operator waits for" was false on
 * the only tree size anyone had measured.
 *
 * There is no in-process fix: the sweep is synchronous JavaScript inside a dependency, and no
 * amount of scheduling makes a synchronous block yield. Another process is the mechanism.
 *
 * What it runs is the command that already exists — `sessions gc --all-projects` — rather than a
 * second implementation of the delete path. The parent still owns the DECISION (enabled, interval,
 * first-run-is-a-dry-run); the child only does the work.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  buildSweepCommand,
  startSessionSweepInBackground,
} from '../../../src/session/gc/sweep-wiring.js'

describe('buildSweepCommand', () => {
  it('test_it_runs_the_command_that_already_exists', () => {
    // Not a second delete path. The flags are the ones `args.ts` already parses.
    const cmd = buildSweepCommand({
      apply: true,
      execPath: '/usr/bin/node',
      script: '/app/cli.mjs',
    })

    expect(cmd.command).toBe('/usr/bin/node')
    expect(cmd.args).toEqual(['/app/cli.mjs', 'sessions', 'gc', '--all-projects', '--apply'])
  })

  it('test_the_first_sweep_omits_apply_so_the_child_dry_runs', () => {
    // B-139's look-first property has to survive the move to a child process, or the redesign
    // silently undoes it.
    const cmd = buildSweepCommand({ apply: false, execPath: 'node', script: 'cli.mjs' })

    expect(cmd.args).not.toContain('--apply')
    expect(cmd.args).toContain('gc')
  })

  it('test_it_refuses_to_build_a_command_with_no_script_to_run', () => {
    // `process.argv[1]` is undefined in some embeddings.
    //
    // This comment used to say such a child "starts an idle REPL that never exits — a leaked process
    // per launch, forever". MEASURED 2026-09-03 and false: with `stdio: 'ignore'` the child's stdin
    // is /dev/null, so node reads EOF and exits 0 immediately. B-147 corrected that claim in
    // `spawn-sweep.ts` and left THIS copy of it standing — a correction applied to one instance
    // while the class stayed, which is the shape B-134 had.
    //
    // The guard is still right, for a smaller and more precise reason: the child would exit 0 having
    // swept nothing, and `sweepFinishedLine` would report a finished sweep — the collector announcing
    // success every day while collecting nothing (B-138). Refusing to spawn reports it instead.
    expect(() => buildSweepCommand({ apply: true, execPath: 'node', script: undefined })).toThrow(
      /script/i,
    )
  })

  it('test_it_refuses_an_empty_executable', () => {
    expect(() => buildSweepCommand({ apply: true, execPath: '', script: 'cli.mjs' })).toThrow(
      /executable/i,
    )
  })
})

/**
 * B-144 — the child is bounded, because an unbounded subprocess is what this whole release was about.
 *
 * B-128 fixed a timeout the operator could not reach. B-137 fixed a `git` call that had no timeout at
 * all, on the CLI's first line. Then B-142 moved the sweep into a child process and gave it **no
 * bound whatsoever** — the same defect, introduced by the fix for a different one.
 *
 * The failure mode is specific and it accumulates. A sweep that hangs — a network-backed tree, a
 * `stat` that blocks on a dead mount — leaves a child running for as long as the TUI does. The next
 * day the stamp is due again and another is spawned. Nothing ever reaps them.
 *
 * The bound is deliberately generous: 37.1 s was MEASURED on a 13 269-project tree, so a limit near
 * that would kill legitimate sweeps on a large disk. Ten minutes is an order of magnitude past the
 * worst measurement and still finite, which is the only property that matters here.
 */
/**
 * The bound on the child now belongs to the framework's `scheduleSessionSweep` (tested in
 * packages/agents `sweep-schedule.test.ts`). These cases pin that TheoCode's wiring reaches it with
 * the options a delete path needs, read from the options the real spawn is handed.
 */
describe('the child process is bounded', () => {
  const scratch: string[] = []
  afterAll(() => {
    for (const d of scratch) rmSync(d, { recursive: true, force: true })
  })

  const scratchDir = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'theocode-spawn-'))
    scratch.push(d)
    return d
  }
  const spawnedOptions = (): Record<string, unknown> => {
    let seen: Record<string, unknown> = {}
    startSessionSweepInBackground({
      enabled: true,
      onReport: () => {},
      projectsRootOverride: join(scratchDir(), 'projects'),
      spawn: ((_c: string, _a: readonly string[], o: Record<string, unknown>) => {
        seen = o
        return {
          stdout: { on: () => {}, unref: () => {} },
          on: () => {},
          unref: () => {},
        }
      }) as never,
    })
    return seen
  }

  it('test_it_carries_a_timeout', () => {
    expect(spawnedOptions().timeout, 'the spawned sweep has no bound at all').toBeGreaterThan(0)
  })

  it('test_the_bound_is_far_past_the_worst_measured_sweep', () => {
    // 37.1 s cold on a 13 269-project tree. A bound near that kills real sweeps on a large disk.
    expect(spawnedOptions().timeout).toBeGreaterThan(60_000)
  })

  it('test_it_names_the_signal_rather_than_leaving_it_to_the_default', () => {
    expect(spawnedOptions().killSignal).toBe('SIGTERM')
  })

  it('test_the_child_inherits_no_stream_it_could_write_over_the_frame_with', () => {
    const stdio = spawnedOptions().stdio
    expect(stdio).toEqual(['ignore', 'pipe', 'ignore'])
    expect(stdio, 'a stream is inherited and would land on the frame').not.toContain('inherit')
  })
})
