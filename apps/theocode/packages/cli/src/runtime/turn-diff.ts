/**
 * #105 — what a turn changed, asked of git, scoped to the files the turn wrote.
 *
 * Codex ends a turn by printing the working tree's diff, and the idea is right: the agent's prose
 * says *"Created hello.py"*, and only the tree says what is actually there. This repository spent a
 * day on the difference between an assertion and the artifact it describes; this is that
 * distinction at the surface a person reads.
 *
 * Two departures from Codex, both deliberate:
 *
 * **Scoped to the paths the turn wrote** (`changed-paths.ts`), not the whole tree. In a repository
 * that was already dirty the unscoped form prints the operator's own uncommitted work beside the
 * agent's with nothing separating them, and stops answering the question it exists for.
 *
 * **Silent when nothing changed.** Most turns write nothing. A section that prints on every turn is
 * a section people stop reading, and then the one time it matters nobody looks — the same reasoning
 * the `/status` rules row already carries for its own complete case.
 */
type GitRun = (args: string[]) => { ok: boolean; stdout: string }

export function turnDiff(git: GitRun, paths: readonly string[]): string | undefined {
  // No paths, no question to ask. Asking anyway would print an empty section on every read-only
  // turn, which is the failure mode this guard exists to avoid rather than an optimisation.
  if (paths.length === 0) return undefined

  const status = git(['status', '--porcelain', '--', ...paths])
  if (!status.ok) return unavailable(paths, status.stdout)
  const untracked = new Set(
    status.stdout
      .split('\n')
      .filter((l) => l.startsWith('??'))
      .map((l) => l.slice(3).trim())
      .filter((p) => p.length > 0),
  )
  const tracked = paths.filter((p) => !untracked.has(p))

  const parts: string[] = []
  if (tracked.length > 0) {
    const res = git(['diff', '--', ...tracked])
    if (!res.ok) return unavailable(paths, res.stdout)
    parts.push(res.stdout.trim())
  }
  // A file the turn CREATED is invisible to `git diff` — it is untracked, and that is the most
  // common thing a coding agent does. `git add -N` would make it visible and is refused: it writes
  // to the operator's index for what is only a read. `--no-index` against /dev/null shows the same
  // content with no side effect, and its non-zero exit on a difference is expected, not a failure.
  for (const p of untracked) {
    const res = git(['diff', '--no-index', '--', '/dev/null', p])
    const body = res.stdout.trim()
    if (body.length > 0) parts.push(body)
  }

  const body = parts.filter((p) => p.length > 0).join('\n')
  return body.length === 0 ? undefined : body
}

/**
 * The turn already succeeded, so a diff that cannot be produced must not fail it — and must not
 * vanish either: silence reads as "nothing changed", which is the wrong direction to be wrong in.
 */
function unavailable(paths: readonly string[], detail: string): string {
  return `[diff] the changes to ${String(paths.length)} file(s) could not be shown: ${detail.trim()}`
}
