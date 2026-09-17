import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, onTestFinished } from 'vitest'

import { readableSkills } from '../../src/context/readable-skills.js'

/**
 * #826 — a skill shipped inside a plugin bundle must be readable, like one in `skills/`.
 *
 * `.claude/plugins/<bundle>/skills/<name>/SKILL.md` is a path this product's own source names twice
 * and calls deliberate: `skills-on-disk.ts` walks it to stop calling such a skill "declared with no
 * SKILL.md", and `foreign-surfaces-on-disk.ts` cites that walk as the reason `plugins` needs no row of
 * its own. Neither of those makes the skill READABLE — `readableSkills` built three roots and none of
 * them was a bundle, so `skill_read` could not load one.
 *
 * Measured on the built binary 2026-09-17, once the permission regression stopped masking it:
 * `skill_read("bundled")` answered `Skill "bundled" not found. Available skills: greet.` for a skill
 * sitting on disk beside `greet`, which loaded.
 *
 * The control is in the test: `greet` and `bundled` are written into the same workspace, and only
 * their location differs. A fix that broke the ordinary root would fail the first expectation.
 */
describe('a skill inside a plugin bundle', () => {
  it('test_it_is_readable_like_one_directly_under_skills', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'bundled-skill-'))
    onTestFinished(() => rmSync(cwd, { recursive: true, force: true }))
    write(join(cwd, '.claude', 'skills', 'greet'), 'greet', 'PLAIN-OK')
    write(join(cwd, '.claude', 'plugins', 'sample', 'skills', 'bundled'), 'bundled', 'BUNDLED-OK')

    const names = (await readableSkills(cwd, join(cwd, 'nowhere'))).map((s) => s.name)

    expect(names, 'the control: an ordinary skill must keep loading').toContain('greet')
    expect(names, 'the bundled skill is on disk and must be readable').toContain('bundled')
  })
})

function write(dir: string, name: string, canary: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A skill for the bundle test.\n---\nReply with ${canary}.\n`,
  )
}
