// The skills a `skill_read` tool can actually open.
//
// `instructions.ts` tells the model to "call `skill_read` with its name to load the steps".
// `@theokit/sdk` will not add that tool by itself, and #1925 moved the wiring to the framework:
// `.skills(…, { read: 'advertised' })` serves exactly what the `<skills>` block lists. These cases
// are the ones the product's own `readableSkills` used to answer, now asked of the framework path.
//
// Roots follow the decision `user-skills.ts` recorded, which this must not quietly widen: a
// repository's `.claude/` IS read, because it "is what the operator has in front of them"; the
// operator's `~/.claude/skills/` is NOT, because on a machine running Claude Code that directory is
// another kit's corpus.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildThroughRuntime, readSkill, TRUSTED } from '../helpers/advertised-skill-read.js'
import { tempRoot } from '../helpers/temp-root.js'

function tree(spec: Record<string, readonly string[]>): string {
  const root = tempRoot('readable-skills-')
  for (const [rel, names] of Object.entries(spec)) {
    for (const name of names) {
      const dir = join(root, rel, name)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: the ${name} skill\n---\nBODY OF ${name}\n`,
      )
    }
  }
  return root
}

describe('readableSkills', () => {
  it('carries the BODY, which is the whole point — a name and a description are already in the prompt', async () => {
    const cwd = tree({ '.theokit/skills': ['alpha'] })
    const chat = await buildThroughRuntime(cwd, join(cwd, 'nohome'), TRUSTED, ['alpha'])
    const answer = await readSkill(chat, 'alpha')
    expect(answer).toContain('BODY OF alpha')
    expect(answer).not.toContain('not found')
  })

  it("reads the repository's .claude/skills — the root that holds them in practice", async () => {
    const cwd = tree({ '.claude/skills': ['beta'] })
    const chat = await buildThroughRuntime(cwd, join(cwd, 'nohome'), TRUSTED, ['beta'])
    const answer = await readSkill(chat, 'beta')
    expect(answer).toContain('BODY OF beta')
    expect(answer).not.toContain('not found')
  })

  it('reads the operator\'s own ~/.theokit/skills', async () => {
    const home = tree({ '.theokit/skills': ['mine'] })
    const chat = await buildThroughRuntime(tree({}), home, TRUSTED)
    const answer = await readSkill(chat, 'mine')
    expect(answer).toContain('BODY OF mine')
    expect(answer).not.toContain('not found')
  })

  it('does NOT read ~/.claude/skills — another kit\'s corpus, per user-skills.ts', async () => {
    const home = tree({ '.claude/skills': ['foreign-corpus'] })
    const chat = await buildThroughRuntime(tree({}), home, TRUSTED, ['foreign-corpus'])
    const answer = await readSkill(chat, 'foreign-corpus')
    expect(answer).not.toContain('BODY OF foreign-corpus')
    expect(answer).toContain('not found')
  })

  it('returns [] for a project with no skills anywhere, rather than throwing', async () => {
    const cwd = tree({})
    const chat = await buildThroughRuntime(cwd, join(cwd, 'nohome'), TRUSTED)
    const answer = await readSkill(chat, 'anything')
    expect(answer).toContain('not found')
    expect(answer).toContain('Available skills: (none)')
  })

  it('keeps one entry per name when two roots declare it, project first', async () => {
    const home = tree({ '.theokit/skills': ['dup'] })
    const cwd = tree({ '.theokit/skills': ['dup'] })
    const chat = await buildThroughRuntime(cwd, home, TRUSTED, ['dup'])
    const answer = await readSkill(chat, 'dup')
    expect(answer).toContain('BODY OF dup')
    expect(answer.match(/BODY OF dup/g)).toHaveLength(1)
  })
})
