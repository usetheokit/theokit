/**
 * Give a hook borrowed from `.claude/settings.json` the variable that file assumes exists.
 *
 * `@theokit/sdk` reads hook definitions from `.claude/` as well as `.theokit/` — a deliberate
 * compatibility with Claude Code, and a useful one. But the commands in that file are written for
 * Claude Code's runtime, and the documented way for one of them to reach a project file is
 * `$CLAUDE_PROJECT_DIR`:
 *
 *     "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard.sh\""
 *
 * Nothing outside Claude Code defines it. The shell expands the unset name to the empty string, so
 * the command runs as `bash "/.claude/hooks/guard.sh"`, the file is not there, and the hook runner
 * reads a missing file as a REFUSAL. Measured 2026-09-02: every turn denied, in a repository whose
 * only sin was also having Claude Code set up.
 *
 * The failure is doubly quiet. It fails closed, which is right for a security control and wrong for
 * one that was never meant to apply here; and the message names the script — which is present and
 * executable — rather than the variable, which is the thing that is missing. A reader goes looking
 * for a file that is right in front of them.
 *
 * Filed upstream as usetheokit/theokit-sdk#522. This is the consumer-side half: if this product is
 * going to execute a file written against another runtime's contract, it should supply the part of
 * that contract it can. It sets the variable only when it is UNSET — inside Claude Code the real
 * value is already there and must win, and an operator who exported their own has said something
 * deliberate.
 */
export function installClaudeProjectDir(
  env: Record<string, string | undefined>,
  projectDir: string,
): string | undefined {
  const existing = env.CLAUDE_PROJECT_DIR
  if (existing !== undefined && existing.trim().length > 0) return existing
  env.CLAUDE_PROJECT_DIR = projectDir
  return projectDir
}
