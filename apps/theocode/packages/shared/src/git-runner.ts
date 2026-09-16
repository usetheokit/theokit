import { execFileSync } from 'node:child_process'

/**
 * The git seam `/review` runs on, in one place instead of two.
 *
 * Both surfaces need to ask git what changed before a review can be scoped, and both had the same
 * eight lines inline: `execFileSync('git', args, { encoding: 'utf8', timeout: 10_000 })` wrapped in
 * `catch { return { ok: false, stdout: '' } }`. Identical in `packages/cli/src/commands/review.ts`
 * and `packages/tui/src/commands/review.ts` — including the hard-coded bound and the swallow.
 *
 * Two properties are deliberate:
 *
 * `timeoutMs` is a parameter, not a constant. The duplicated literal was the finding; a shared
 * constant would have moved it rather than removed it.
 *
 * `onWarn` is REQUIRED. The old code discarded the reason a git call failed, and because
 * `buildReviewTarget` branches on `ok` to decide what it is reviewing, a swallowed failure did not
 * surface as an error — it silently changed the SCOPE of the review. `rules/error-handling.md` § 5
 * names the empty catch as an anti-pattern for exactly this shape. Making the callback mandatory
 * means a future caller cannot rebuild the silence by omitting an optional argument.
 *
 * What does NOT change is the return contract. Callers branch on `{ ok, stdout }` and must keep
 * working when git legitimately answers "no": a missing ref is an answer, not an exception.
 */
export interface GitRunnerOptions {
  /** Milliseconds before the git subprocess is killed. */
  readonly timeoutMs: number
  /** Where the reason for a failed call goes. Required — see the note above. */
  readonly onWarn: (message: string) => void
}

export type GitResult = { ok: boolean; stdout: string }

/**
 * What git actually said, preferred over the Error's own message.
 *
 * `execFileSync` throws an Error whose `message` is the generic "Command failed: git …"; the useful
 * half — `fatal: Needed a single revision` — lands on the captured `stderr` property. Reporting the
 * message alone would swap one uninformative string for another.
 */
function failureReason(err: unknown): string {
  const stderr = (err as { stderr?: unknown }).stderr
  const text = typeof stderr === 'string' ? stderr.trim() : ''
  if (text.length > 0) return text
  return err instanceof Error ? err.message : String(err)
}

/** `execFileSync` attaches what the process wrote before it failed; anything else means none. */
function capturedStdout(err: unknown): string {
  const out = (err as { stdout?: unknown }).stdout
  return typeof out === 'string' ? out : ''
}

export function createGitRunner(opts: GitRunnerOptions): (args: string[]) => GitResult {
  return (args) => {
    try {
      return {
        ok: true,
        stdout: execFileSync('git', args, {
          encoding: 'utf8',
          timeout: opts.timeoutMs,
          // stderr is CAPTURED rather than inherited. Left on the default it goes straight to the
          // terminal, so a `fatal: Needed a single revision` printed itself over the TUI while the
          // caller still learned nothing. Captured, the same text becomes the warning below.
          stdio: ['ignore', 'pipe', 'pipe'],
        }),
      }
    } catch (err) {
      // Named with the subcommand so the warning identifies WHICH call failed; a review runs several
      // and "git failed" would not say which scope decision was affected.
      opts.onWarn(`git ${args.join(' ')} failed: ${failureReason(err)}`)
      // #105 — what git printed BEFORE exiting non-zero, not discarded.
      //
      // For several subcommands a non-zero exit is the answer rather than a failure: `git diff`
      // exits 1 under `--no-index` or `--exit-code` when it finds the difference it was asked to
      // find, having already written the diff to stdout. Returning `''` told the caller the call
      // produced nothing, which is a different and false statement.
      //
      // Measured: the end-of-turn diff printed nothing for a file the agent had just created,
      // because a new file is untracked and `--no-index` is the only way to diff it.
      //
      // `ok` is unchanged, so no existing caller behaves differently — they all branch on it. What
      // changes is that a caller who knows the exit code is expected can now read the output.
      return { ok: false, stdout: capturedStdout(err) }
    }
  }
}
