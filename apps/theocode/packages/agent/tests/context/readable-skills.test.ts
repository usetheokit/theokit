// The skills a `skill_read` tool can actually open.
//
// `instructions.ts` tells the model to "call `skill_read` with its name to load the steps", and
// nothing in this product ever added that tool. `@theokit/sdk` is explicit that it will not do it
// for you — "The SDK NEVER auto-injects it — bring-your-own-tools stays intact" — and names the
// outcome in its own words: "the entire on-disk surface was advertised to the model and unreadable
// by it: a `SKILL.md` listed by name and description, with the instructions under the frontmatter
// unable to arrive."
//
// Measured 2026-09-15 against Claude Code on the same project: asked to load a skill and report a
// token written in its body, Claude Code returned it and TheoCode answered that the required
// `skill_read` tool was not available. 75 skills sat under `.claude/skills/`.
//
// Roots follow the decision `user-skills.ts` already recorded, which this must not quietly widen:
// a repository's `.claude/` IS read, because it "is what the operator has in front of them"; the
// operator's `~/.claude/skills/` is NOT, because on a machine running Claude Code that directory is
// another kit's corpus.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readableSkills } from '../../src/context/readable-skills.js'

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tree(spec: Record<string, readonly string[]>): string {
  const root = mkdtempSync(join(tmpdir(), 'readable-skills-'))
  made.push(root)
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
    const [skill] = await readableSkills(cwd, join(cwd, 'nohome'))
    expect(skill?.name).toBe('alpha')
    expect(skill?.instructions).toContain('BODY OF alpha')
  })

  it("reads the repository's .claude/skills — the root that holds them in practice", async () => {
    const cwd = tree({ '.claude/skills': ['beta'] })
    const names = (await readableSkills(cwd, join(cwd, 'nohome'))).map((s) => s.name)
    expect(names).toContain('beta')
  })

  it('reads the operator\'s own ~/.theokit/skills', async () => {
    const home = tree({ '.theokit/skills': ['mine'] })
    const cwd = tree({})
    const names = (await readableSkills(cwd, home)).map((s) => s.name)
    expect(names).toContain('mine')
  })

  it('does NOT read ~/.claude/skills — another kit\'s corpus, per user-skills.ts', async () => {
    const home = tree({ '.claude/skills': ['foreign-corpus'] })
    const cwd = tree({})
    const names = (await readableSkills(cwd, home)).map((s) => s.name)
    expect(names).not.toContain('foreign-corpus')
  })

  it('returns [] for a project with no skills anywhere, rather than throwing', async () => {
    const cwd = tree({})
    await expect(readableSkills(cwd, join(cwd, 'nohome'))).resolves.toEqual([])
  })

  it('keeps one entry per name when two roots declare it, project first', async () => {
    // The project is the more specific context — the same precedence `user-skills.ts` states.
    const home = tree({ '.theokit/skills': ['dup'] })
    const cwd = tree({ '.theokit/skills': ['dup'] })
    const found = (await readableSkills(cwd, home)).filter((s) => s.name === 'dup')
    expect(found).toHaveLength(1)
    expect(found[0]?.instructions).toContain('BODY OF dup')
  })
})
