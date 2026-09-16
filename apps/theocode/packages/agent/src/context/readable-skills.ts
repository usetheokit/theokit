import { homedir } from 'node:os'
import { join } from 'node:path'

import { discoverSkills, loadSkillInstructions } from '@theokit/sdk/skills'
import { SkillReadTool } from '@theokit/sdk'
import type { CustomTool, InlineSkill } from '@theokit/sdk'

import { DEFAULT_HOME_DIR } from '../config/home-dir.js'

/**
 * Every skill whose BODY this run can hand to the model, for `skill_read`.
 *
 * `instructions.ts` tells the model to "call `skill_read` with its name to load the steps". The SDK
 * is explicit that it will not provide that tool for you — "The SDK NEVER auto-injects it —
 * bring-your-own-tools stays intact" — and names the outcome when nobody does: "the entire on-disk
 * surface was advertised to the model and unreadable by it: a `SKILL.md` listed by name and
 * description, with the instructions under the frontmatter unable to arrive."
 *
 * Measured 2026-09-15 beside Claude Code on the same project: asked to load a skill and report a
 * token written in its body, Claude Code returned it; this product answered that the required tool
 * was not available. 75 skills sat under `.claude/skills/`.
 *
 * ## Roots, and the one that is deliberately absent
 *
 * `user-skills.ts` already settled where a skill may come from, and this does not widen it:
 *
 *   - `<cwd>/.theokit/skills` — this product's own project root.
 *   - `<cwd>/.claude/skills`  — the repository's foreign root. Read, because "a repository's
 *     `.claude/` is what the operator has in front of them", and because it is where the skills
 *     actually are in every project measured.
 *   - `~/.theokit/skills`     — the operator's own, read regardless of directory trust for the
 *     reason recorded there: the gate asks about the repository, and nobody's home is the
 *     repository.
 *
 * `~/.claude/skills` is NOT read. On a machine that also runs Claude Code that directory is another
 * kit's corpus, and importing it would hand this product skills nobody declared for it — the same
 * decision `role-discovery.ts` makes for `~/.claude/agents` and `skills-on-disk.ts` for its
 * `presentButUndeclared` report.
 *
 * The project wins a name collision, being the more specific context. That is the precedence the
 * SDK's own resolution uses, so the body this returns is the body the model was told about.
 */
export async function readableSkills(
  cwd: string,
  home: string = homedir(),
): Promise<InlineSkill[]> {
  const roots = [
    join(cwd, DEFAULT_HOME_DIR, 'skills'),
    join(cwd, '.claude', 'skills'),
    join(home, DEFAULT_HOME_DIR, 'skills'),
  ]
  const byName = new Map<string, InlineSkill>()
  for (const root of roots) {
    // `discoverSkills` never throws — a missing or unreadable directory yields `[]`, which is the
    // ordinary case for a project that has only one of these roots.
    for (const skill of await discoverSkills(root)) {
      if (byName.has(skill.name)) continue
      byName.set(skill.name, { ...skill, instructions: await loadSkillInstructions(skill) })
    }
  }
  return [...byName.values()]
}

/**
 * The `skill_read` tool, or nothing when there is no skill to read.
 *
 * Extracted rather than inlined: the ternary took `buildChatAgent` to cognitive complexity 11
 * against a max of 10, and the gate is right that a build function is not where a conditional
 * belongs.
 *
 * Absent on an empty list so a project with no skills does not carry a tool whose every answer
 * would be "no such skill" — the same reason `mcpPanelBody` refuses to list servers it was not
 * given.
 */
export async function skillReadTool(cwd: string): Promise<CustomTool[]> {
  const skills = await readableSkills(cwd)
  return skills.length > 0 ? [SkillReadTool.create(skills)] : []
}
