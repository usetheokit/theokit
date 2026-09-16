import { homedir } from 'node:os'
import { join } from 'node:path'

import { discoverSkills, loadSkillInstructions } from '@theokit/sdk/skills'
import type { InlineSkill } from '@theokit/sdk'

import { DEFAULT_HOME_DIR } from '../config/home-dir.js'

/**
 * #65 — the operator's own skills, from `~/.theokit/skills/`.
 *
 * ## What was missing
 *
 * Five subsystems load from disk and one user layer reached two of them, by accident of both being
 * stored inside `config.toml`. Instructions, rules and subagents were given a user root in earlier
 * work; skills were the last surface with nowhere for a person — as opposed to a repository — to
 * put something. A skill encoding how *you* work had to be copied into every checkout.
 *
 * ## Why inline rather than a second discovery root
 *
 * `.skills([...names])` resolves each name against the PROJECT's `.theokit/skills/`, and the SDK
 * exposes no second root to add. `SkillsSelection` does accept `InlineSkill` alongside a name, so
 * the operator's skills arrive already-read instead of as names the resolver cannot find.
 *
 * `InlineSkill` requires `instructions`, and `discoverSkills` deliberately does not return the body
 * — its docblock states *"the skill BODY is never included"*, a contract worth preserving so a
 * catalog still fits in a prompt. `loadSkillInstructions` is the door upstream published for exactly
 * this (usetheokit/theokit-sdk, shipped in `@theokit/sdk@5.1.0`). Splitting frontmatter from body by
 * hand was the alternative and is a second reader of a convention this module has one parser for —
 * it would fail SILENTLY if the format moved, with the frontmatter landing inside the instructions
 * and nothing saying so.
 *
 * ## Trust
 *
 * Read regardless of whether the DIRECTORY is trusted, for the reason `context/rules.ts` and
 * `context/user-agents-md.ts` already apply to instructions: the gate asks whether the code in this
 * repository is trusted, and nobody's home directory is the repository. Gating it would refuse
 * someone their own configuration because of where they happened to `cd`.
 *
 * The project wins a name collision — it is the more specific context, and the SDK's own resolution
 * puts the discovered project skill ahead of an inline one of the same name.
 *
 * ## Why only the native root
 *
 * `~/.claude/skills/` is NOT read. On a machine that also runs Claude Code that directory is that
 * kit's corpus — measured here, 39 of them — and importing it would hand this product a skill set
 * nobody declared for it. Same decision, same reason, as `role-discovery.ts` for `~/.claude/agents/`
 * and `skills-on-disk.ts` for its `presentButUndeclared` report. A repository's `.claude/` is the one
 * the operator has in front of them; their home root is shared with every other tool that speaks the
 * dialect.
 */
export async function userSkills(home = homedir()): Promise<InlineSkill[]> {
  const dir = join(home, DEFAULT_HOME_DIR, 'skills')
  // `discoverSkills` never throws — a missing or unreadable directory yields `[]`, which is the
  // ordinary case for an operator who has not created one.
  const found = await discoverSkills(dir)
  return Promise.all(
    found.map(async (skill) => ({ ...skill, instructions: await loadSkillInstructions(skill) })),
  )
}
