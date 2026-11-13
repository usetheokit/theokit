import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { readableSkills, skillReadTool } from '../../src/context/readable-skills.js'

const discoverRoles = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('../../src/delegation/role-discovery.js', () => ({ discoverRoles }))

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'skill-trust-'))
  onTestFinished(() => rmSync(d, { recursive: true, force: true }))
  return d
}
function write(root: string, name: string, canary: string): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A skill.\n---\nReply with ${canary}.\n`,
  )
}

describe('skill_read follows the trust gate (#1904)', () => {
  it('refuses a project skill in an untrusted directory and does not name it', async () => {
    const cwd = tmp()
    const home = tmp()
    write(join(cwd, '.claude', 'skills'), 'x', 'PROJECT-X')
    write(join(home, '.theokit', 'skills'), 'mine', 'MINE')
    const names = (await readableSkills(cwd, home, false)).map((s) => s.name)
    expect(names).not.toContain('x')
    expect(names).toEqual(['mine'])
    const tools = await skillReadTool(cwd, join(cwd, 'nowhere'), false)
    expect(tools).toEqual([])
  })

  it('returns the body in a trusted directory', async () => {
    const cwd = tmp()
    write(join(cwd, '.claude', 'skills'), 'x', 'PROJECT-X')
    const skills = await readableSkills(cwd, join(cwd, 'nowhere'), true)
    expect(skills.find((s) => s.name === 'x')?.instructions).toContain('PROJECT-X')
    expect(await skillReadTool(cwd, join(cwd, 'nowhere'), true)).toHaveLength(1)
  })

  it('reads the configured home, not the real one', async () => {
    const cwd = tmp()
    const home = tmp()
    write(join(home, '.theokit', 'skills'), 'fromhome', 'HOME')
    const names = (await readableSkills(cwd, home, false)).map((s) => s.name)
    expect(names).toEqual(['fromhome'])
  })
})

describe('named subagents use the configured home (#1904)', () => {
  it('passes home to discoverRoles', async () => {
    const { namedSubagentDefinitions } = await import('../../src/delegation/named-subagents.js')
    await namedSubagentDefinitions('/some/cwd', false, '/some/home')
    expect(discoverRoles).toHaveBeenCalledWith({
      cwd: '/some/cwd',
      projectAllowed: false,
      home: '/some/home',
    })
  })
})
