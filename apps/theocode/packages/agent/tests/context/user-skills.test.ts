/**
 * #65 — the operator's `~/.theokit/skills/` reaches the agent, and their `~/.claude/skills/` does not.
 *
 * The positive control is the shape the issue asked for: the SAME file under the operator root and
 * under a foreign root, only the root differing. Without it, an empty result is ambiguous between
 * "the root is not read" and "the fixture is malformed", and the second is the likelier mistake when
 * a loader is strict about frontmatter.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { userSkills } from '../../src/context/user-skills.js'
import { tempRoot } from '../helpers/temp-root.js'

let HOME: string

const skill = (root: string, dialect: string, name: string, body: string): void => {
  const dir = join(root, dialect, 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: fixture for #65\n---\n\n${body}\n`,
  )
}

beforeAll(() => {
  HOME = tempRoot('user-skills-')
  skill(HOME, '.theokit', 'answer-in-portuguese', 'Reply in pt-BR.')
  skill(HOME, '.claude', 'foreign-kit-skill', 'Belongs to another kit.')
})

describe('#65 — user-level skills', () => {
  it('test_a_skill_in_the_operators_native_root_is_loaded', async () => {
    const loaded = await userSkills(HOME)
    expect(loaded.map((s) => s.name)).toContain('answer-in-portuguese')
  })

  it('test_the_body_arrives_with_the_frontmatter_stripped', async () => {
    // The whole reason `loadSkillInstructions` exists rather than a hand-rolled split. A body that
    // still carried `---\nname: …` would be a silent corruption: the skill would load, the agent
    // would read YAML as prose, and nothing would report it.
    const [only] = await userSkills(HOME)
    expect(only?.instructions).toBe('Reply in pt-BR.')
    expect(only?.instructions).not.toContain('---')
    expect(only?.instructions).not.toContain('description:')
  })

  it('test_negative_control_the_operators_foreign_root_is_not_read', async () => {
    // `~/.claude/skills/` on a machine that also runs Claude Code is that kit's corpus. Importing it
    // would give this product a skill set nobody declared for it.
    const loaded = await userSkills(HOME)
    expect(
      loaded.map((s) => s.name),
      'a home `.claude/skills/` was imported — that is another kit s corpus, not ours',
    ).not.toContain('foreign-kit-skill')
  })

  it('test_an_operator_with_no_skills_directory_gets_an_empty_list_not_a_throw', async () => {
    // The ordinary case. `discoverSkills` documents a never-throw contract and this asserts we did
    // not add a throw on top of it — an operator who never created the directory must still boot.
    const none = tempRoot('user-skills-empty-')
    await expect(userSkills(none)).resolves.toEqual([])
  })
})
