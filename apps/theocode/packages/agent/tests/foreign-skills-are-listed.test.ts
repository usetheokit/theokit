// A listing must not answer "none" while the model is carrying forty skills.
//
// Skills reach this agent by two paths. `.skills([...cfg.skills, ...operatorSkills])` is the
// declared path, and `WiredCapabilities` observes it. `.claude/skills/` reaches the model through
// `settingSources` + `import: ['skills', ...]` — the foreign dialect, which loads WITHOUT being
// declared and which the wiring record never sees.
//
// Measured 2026-09-15 in one running session: `doctor` printed `skills: none`, `/skills` printed
// "no skills are enabled for this directory", and in the same turn the model reported seeing 40
// skills and correctly named `probe-skill` — a skill created minutes earlier under
// `.claude/skills/`, which it could only know from the loaded list. 76 were on disk there. An
// operator asking which skills are active was told none, twice, by the two surfaces built to
// answer exactly that.
//
// `wired-capabilities.ts` states the contract this breaks: the listing comes from what was
// actually wired, "those two can disagree, and the disagreement is the bug worth catching".
//
// What this test does NOT claim: which of the foreign skills reached the model. The SDK exposes
// the loaded set only through a system-prompt RESOLVER, and this product passes a static string
// (`.system(composed.text)`), so the number cannot be known here. Reporting the disk count as
// "active" would trade a false "none" for a false "40". The row says what it knows and names what
// it does not.

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { skillsOnDisk } from '../src/skills-on-disk.js'

// Every temporary directory is removed. `no-leaked-temp-dirs.test.ts` enforces it across the repo
// and caught this file on its first run — a fixture that leaks is a fixture that fills a disk on CI.
const made: string[] = []
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function projectWith(foreign: readonly string[]): string {
  const cwd = mkdtempSync(join(tmpdir(), 'foreign-skills-'))
  made.push(cwd)
  for (const name of foreign) {
    const dir = join(cwd, '.claude', 'skills', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\nbody`)
  }
  return cwd
}

describe('skillsOnDisk — the foreign root is reported, not silently dropped', () => {
  it('names the skills that live under .claude/skills and load without a config line', () => {
    const cwd = projectWith(['alpha', 'beta'])
    const found = skillsOnDisk(cwd, [], join(cwd, 'nohome'))
    expect(found.foreignRootSkills).toEqual(['alpha', 'beta'])
  })

  it('is empty when the foreign root holds nothing, so the row stays quiet', () => {
    const cwd = projectWith([])
    expect(skillsOnDisk(cwd, [], join(cwd, 'nohome')).foreignRootSkills).toEqual([])
  })

  it('does not offer them the "declare it" remedy — another tool owns that inventory', () => {
    const cwd = projectWith(['gamma'])
    const found = skillsOnDisk(cwd, [], join(cwd, 'nohome'))
    expect(found.presentButUndeclared).not.toContain('gamma')
  })
})
