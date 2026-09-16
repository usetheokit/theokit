/**
 * B-072 — which subagents exist here, answerable before invoking one.
 *
 * Delegation is real: `delegation/roles.ts` builds role agents and `config-commands.ts` routes a
 * custom command to a named subagent from `.theokit/agents/<name>.md`. The only feedback the set
 * ever produced was a FAILURE toast — `subagent "<name>" not found` — so the way to learn which
 * subagents exist was to name one that does not.
 *
 * Resolved through the SAME path the router uses (`.theokit/agents/<name>.md` under the working
 * directory), so this listing cannot claim a subagent the router would then fail to find. That is
 * the bullet the item calls out: a listing derived independently is a second source of truth, and
 * the two drift.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where subagents live, in the order they are searched.
 *
 * Two directories since #72, because the SDK already discovers both — its filebase returns
 * `[join(cwd, THEOKIT_DIR_LITERAL), join(cwd, CLAUDE_DIR_NAME)]`, and a skill declared only under
 * `.claude/` was measured working end to end. So a subagent there could already be delegated to
 * while this listing said it did not exist.
 *
 * Shared with `config-commands.ts` so the two cannot diverge. That sharing is the whole point of the
 * function and it is why BOTH sides had to widen together: B-072's own words are that "a listing
 * derived independently is a second source of truth, and the two drift" — widening the listing alone
 * would have recreated exactly that, pointing at the other directory.
 */
export function subagentDirs(cwd: string): readonly string[] {
  return [join(cwd, '.theokit', 'agents'), join(cwd, '.claude', 'agents')]
}

/**
 * The file that defines `name`, or `undefined` when nothing does.
 *
 * The resolver the router uses, so a listed subagent is by construction one the router can follow.
 * First match wins: a repository that keeps the same file in both places has ONE subagent.
 */
export function subagentPath(cwd: string, name: string): string | undefined {
  return subagentDirs(cwd)
    .map((dir) => join(dir, `${name}.md`))
    .find((p) => existsSync(p))
}

/**
 * The subagent names available in `cwd`, sorted.
 *
 * An unreadable or absent directory yields an empty list rather than throwing: "this project
 * defines no subagents" is the normal case, not an error to raise at someone opening a listing.
 */
export function listSubagents(cwd: string): string[] {
  const names = new Set<string>()
  for (const dir of subagentDirs(cwd)) {
    if (!existsSync(dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      const name = entry.slice(0, -'.md'.length)
      // A Set rather than a list: the same name in both directories is ONE subagent, and the router
      // resolves it to one file. Listing it twice would promise a choice that does not exist.
      if (name.length > 0) names.add(name)
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}
