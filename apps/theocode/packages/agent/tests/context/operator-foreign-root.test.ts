/**
 * B-156 — one stated rule for what the operator's `~/.claude/` means, and all four surfaces on it.
 *
 * v0.7.0 added the operator's skills and the project's foreign agents and commands, and in doing so
 * made an asymmetry visible that nothing stated: at the USER level `~/.claude/rules/` is read and
 * `~/.claude/{skills,agents,commands}/` are not. Four decisions, taken separately, that happened to
 * land in the same place.
 *
 * ## The rule
 *
 * A foreign root under the operator's home may contribute text that CONSTRAINS the agent. It may
 * not contribute artifacts that ADD INVOKABLE SURFACE.
 *
 * The line is about the worst case of being wrong. A rule from another kit is instructions the
 * model may find confusing; a skill, subagent or command from another kit is behaviour this product
 * never declared — a name in the popup, a role with tools, a body that becomes a prompt. Measured on
 * a machine that also runs Claude Code: `~/.claude/skills/` holds 6 entries and `~/.claude/agents/`
 * holds that kit's roles. None of them were written for this product.
 *
 * A repository's `.claude/` is different and is read for all four: it is the directory the operator
 * has in front of them, and it is already behind the trust gate.
 *
 * ## Why this file exists rather than a paragraph
 *
 * The asymmetry was invisible until someone went looking, and the next person to notice it will
 * reasonably try to "fix" it — in either direction. These arms make the decision fail loudly rather
 * than be re-litigated from scratch.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { loadUserRules } from '../../src/context/rules.js'
import { userSkills } from '../../src/context/user-skills.js'
import { discoverRoles } from '../../src/delegation/role-discovery.js'
import { tempRoot } from '../helpers/temp-root.js'

let HOME: string

const put = (dialect: string, kind: string, name: string, body: string): void => {
  const dir = join(HOME, dialect, kind, ...(kind === 'skills' ? [name] : []))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, kind === 'skills' ? 'SKILL.md' : `${name}.md`), body)
}

beforeAll(() => {
  HOME = tempRoot('foreign-root-')
  put('.claude', 'rules', 'house-style', '# house style\n\nAnswer tersely.\n')
  put('.claude', 'skills', 'foreign-skill', '---\nname: foreign-skill\ndescription: another kit\n---\n\nBody.\n')
  put('.claude', 'agents', 'foreign-role', '---\nname: foreign-role\ndescription: another kit\ntools: [read_file]\n---\n\nBody.\n')
})

describe('B-156 — text that constrains is read; surface that invokes is not', () => {
  it('test_rules_are_read_because_they_only_constrain', () => {
    // The one surface on the permissive side, and the reason: a rule can make the agent answer
    // differently. It cannot make it able to do something new.
    expect(loadUserRules(HOME).text).toContain('Answer tersely')
  })

  it('test_skills_are_not_read_because_they_add_an_invokable_name', async () => {
    expect(
      (await userSkills(HOME)).map((s) => s.name),
      "another kit's skill corpus was offered as this product's",
    ).not.toContain('foreign-skill')
  })

  it('test_subagents_are_not_read_because_they_add_a_role_with_tools', async () => {
    const found = await discoverRoles({ cwd: HOME, home: HOME, projectAllowed: false })
    expect(Object.keys(found), "another kit's roles became this product's team").not.toContain(
      'foreign-role',
    )
  })
})
