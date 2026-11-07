import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BUNDLED_SKILLS, parseSkillMarkdown, SkillRegistry } from '../src/skills/registry.js'

const skillFile = (name: string, body: string, requires = '') =>
  `---\nname: ${name}\ndescription: ${name} skill\n${requires === '' ? '' : `requires: ${requires}\n`}---\n${body}\n`

function workspaceWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'skills-'))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name))
    writeFileSync(join(dir, name, 'SKILL.md'), text)
  }
  return dir
}

describe('skill registry (OC-70..72, OC-74)', () => {
  it('parses frontmatter and rejects a file without one', () => {
    const entry = parseSkillMarkdown(skillFile('a', 'body', 'git, jq'), 'workspace')
    expect(entry).toMatchObject({ name: 'a', instructions: 'body', requiresBins: ['git', 'jq'] })
    expect(parseSkillMarkdown('no frontmatter', 'workspace')).toBeUndefined()
  })

  it('lets a workspace skill override a bundled one of the same name', () => {
    const dir = workspaceWith({ 'summarize-text': skillFile('summarize-text', 'workspace version') })
    const registry = new SkillRegistry({ workspaceDir: dir, path: '' })
    expect(registry.resolve('summarize-text')?.source).toBe('workspace')
    expect(registry.offered().find((s) => s.name === 'summarize-text')?.instructions).toBe('workspace version')
    expect(BUNDLED_SKILLS.find((s) => s.name === 'summarize-text')?.instructions).not.toBe('workspace version')
  })

  it('does not offer a skill whose required binary is absent, and offers it once present', () => {
    const empty = mkdtempSync(join(tmpdir(), 'bin-'))
    const dir = workspaceWith({ needy: skillFile('needy', 'x', 'theoclaw-fake-bin') })
    const absent = new SkillRegistry({ workspaceDir: dir, path: empty })
    expect(absent.offered().map((s) => s.name)).not.toContain('needy')
    expect(absent.offered().map((s) => s.name)).not.toContain('git-helper')
    expect(absent.offered().map((s) => s.name)).toContain('summarize-text')

    writeFileSync(join(empty, 'theoclaw-fake-bin'), '#!/bin/sh\n')
    chmodSync(join(empty, 'theoclaw-fake-bin'), 0o755)
    expect(new SkillRegistry({ workspaceDir: dir, path: empty }).offered().map((s) => s.name)).toContain('needy')
  })

  it('exposes offered skills as SDK inline skills', () => {
    expect(new SkillRegistry({ path: '' }).inlineSkills().map((s) => s.name)).toEqual(['summarize-text'])
  })
})
