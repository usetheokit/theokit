/**
 * #105 — what the turn changed, from git, scoped to the files the turn wrote.
 *
 * The value is the same one this repository has been paying for all day: the ARTIFACT, not the
 * assertion. The agent's prose says `Created hello.py`; this says what the tree now holds, from
 * git, and the two can disagree.
 */
import { describe, expect, it, vi } from 'vitest'

import { turnDiff } from '../../src/runtime/turn-diff.js'

const git = (out: string, ok = true) =>
  vi.fn((_args: string[]) => ({ ok, stdout: out }))

describe('#105 — the diff of a turn', () => {
  it('test_it_asks_git_only_about_the_paths_the_turn_wrote', () => {
    // The scope IS the feature. `git diff` with no pathspec prints the operator's own uncommitted
    // work too, and a reader cannot tell that from the agent's.
    const run = git('diff text')
    turnDiff(run, ['a.ts', 'b.ts'])

    const args = run.mock.calls[0]?.[0] ?? []
    expect(args).toContain('--')
    expect(args.slice(args.indexOf('--') + 1)).toEqual(['a.ts', 'b.ts'])
  })

  it('test_no_paths_means_no_git_call_and_no_output', () => {
    // Anti-vacuity, and the common case: most turns write nothing. Running git anyway would print
    // an empty section on every read-only turn and train people to ignore the section.
    const run = git('')
    expect(turnDiff(run, [])).toBeUndefined()
    expect(run).not.toHaveBeenCalled()
  })

  it('test_an_empty_diff_produces_no_output', () => {
    // A file written with identical content is a real case — the model rewrites what was there.
    // git says nothing, and so does this.
    expect(turnDiff(git('   \n'), ['a.ts'])).toBeUndefined()
  })

  it('test_a_git_failure_is_reported_not_swallowed_and_not_thrown', () => {
    // The turn already succeeded; a diff that cannot be produced must not fail it, and must not
    // vanish either. Silence here would read as "nothing changed", which is the wrong direction.
    const out = turnDiff(git('not a git repository', false), ['a.ts'])
    expect(out).toContain('could not be shown')
  })

  it('test_the_body_is_the_diff_git_returned', () => {
    const out = turnDiff(git('diff --git a/a.ts b/a.ts\n+x\n'), ['a.ts'])
    expect(out).toContain('+x')
  })

  it('test_a_newly_created_file_is_shown_even_though_git_diff_ignores_it', () => {
    // The case that matters most for a coding agent and the one the first cut missed: `git diff`
    // says NOTHING about an untracked file. Measured on the real product — the agent created
    // `hello.py`, reported it, and the diff section printed nothing at all.
    //
    // "Created hello.py" followed by an empty diff reads as "nothing happened", which is the worst
    // possible direction for this section to be wrong in.
    //
    // `git add -N` would fix it and is refused: it mutates the operator's index for a read. The
    // untracked path is diffed against /dev/null instead, which has no side effect.
    const run = vi.fn((args: string[]) =>
      args[0] === 'status'
        ? { ok: true, stdout: '?? new.py\n' }
        : { ok: true, stdout: 'diff --git a/new.py b/new.py\n+def add():\n' },
    )
    const out = turnDiff(run, ['new.py'])

    expect(out, 'an untracked file the turn created was reported as no change').toContain('+def add()')
    const noIndex = run.mock.calls.find((c) => c[0].includes('--no-index'))
    expect(noIndex?.[0], 'the untracked file was not diffed against /dev/null').toContain('/dev/null')
  })

  it('test_the_index_is_never_written_to', () => {
    // The guard on the refusal above. `git add -N` is the obvious fix and would leave the
    // operator's repository in a state they did not ask for, after a command that only reads.
    const run = vi.fn((_args: string[]) => ({ ok: true, stdout: '?? a.ts\n' }))
    turnDiff(run, ['a.ts'])
    for (const [args] of run.mock.calls) {
      expect(args, 'the diff wrote to the index').not.toContain('add')
    }
  })
})
