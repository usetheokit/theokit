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
import { describe, expect, it } from 'vitest'

import { buildSweepCommand } from '../../../src/session/gc/sweep-wiring.js'

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
