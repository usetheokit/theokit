// #1904 — `skill_read` serves exactly what the `<skills>` block lists: the repository's roots only
// when the directory is trusted, and the operator's skills from the CONFIGURED home.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { skillReadTool } from '../../src/context/readable-skills.js'

const made: string[] = []
afterEach(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true })
})

function skillAt(base: string, rel: string, name: string): void {
  const dir = join(base, rel, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: the ${name} skill\n---\nBODY OF ${name}\n`,
  )
}

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'skill-read-gate-'))
  made.push(d)
  return d
}

async function read(tools: Awaited<ReturnType<typeof skillReadTool>>, name: string): Promise<string> {
  const [tool] = tools
  if (tool === undefined) throw new Error('no skill_read tool')
  return String(await tool.handler({ name }, undefined as never))
}

describe('skill_read trust gate', () => {
  it('refuses a repository skill in an untrusted directory without naming it', async () => {
    const cwd = temp()
    const home = temp()
    skillAt(cwd, '.claude/skills', 'x')
    skillAt(home, '.theokit/skills', 'mine')
    const answer = await read(await skillReadTool(cwd, home, false), 'x')
    expect(answer).not.toContain('BODY OF x')
    expect(answer).toContain('not found')
    expect(answer).toMatch(/Available skills: mine\./)
    expect(answer).toContain('mine')
  })

  it('offers no tool at all when untrusted and the operator has no skills', async () => {
    const cwd = temp()
    skillAt(cwd, '.claude/skills', 'x')
    expect(await skillReadTool(cwd, temp(), false)).toEqual([])
  })

  it('returns the body in a trusted directory', async () => {
    const cwd = temp()
    skillAt(cwd, '.claude/skills', 'x')
    expect(await read(await skillReadTool(cwd, temp(), true), 'x')).toContain('BODY OF x')
  })

  it('reads the configured home and not the real one', async () => {
    const cwd = temp()
    const home = temp()
    skillAt(home, '.theokit/skills', 'configured')
    const tools = await skillReadTool(cwd, home, true)
    expect(await read(tools, 'configured')).toContain('BODY OF configured')
    // A skill that exists only under some other home is not served.
    const other = temp()
    skillAt(other, '.theokit/skills', 'elsewhere')
    expect(await read(tools, 'elsewhere')).toContain('not found')
  })
})
