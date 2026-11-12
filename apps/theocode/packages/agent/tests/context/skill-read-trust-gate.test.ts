// #1904 — `skill_read` serves exactly what the `<skills>` block lists: the repository's roots only
// when the directory is trusted, and the operator's skills from the CONFIGURED home.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Wraps the real `skillReadTool` so `buildChatAgent` still gets the real tool, and the test can read
// what `chat.ts` handed it.
const spy = vi.hoisted(() => ({ calls: [] as unknown[][], results: [] as Promise<unknown>[] }))
vi.mock('../../src/context/readable-skills.js', async (orig) => {
  const actual = await orig<typeof import('../../src/context/readable-skills.js')>()
  return {
    ...actual,
    skillReadTool: (...args: Parameters<typeof actual.skillReadTool>) => {
      spy.calls.push(args)
      const r = actual.skillReadTool(...args)
      spy.results.push(r)
      return r
    },
  }
})

import { skillReadTool } from '../../src/context/readable-skills.js'

const made: string[] = []
const realHome = process.env.HOME
const realState = process.env.THEOKIT_HOME
beforeEach(() => {
  delete process.env.THEOKIT_HOME
  spy.calls.length = 0
  spy.results.length = 0
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  if (realState !== undefined) process.env.THEOKIT_HOME = realState
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

  it('buildChatAgent wires the posture and the configured home into skill_read', async () => {
    const { buildChatAgent } = await import('../../src/chat/chat.js')
    const home = temp()
    const realHomeDir = temp()
    process.env.HOME = realHomeDir
    skillAt(home, '.theokit/skills', 'mine')
    skillAt(realHomeDir, '.theokit/skills', 'ambient')
    const build = async (skills: boolean, cwd: string) => {
      spy.results.length = 0
      await buildChatAgent({
        cwd,
        home,
        posture: { level: skills ? 'trusted' : 'untrusted', allows: { skills } },
      } as never)
      return read((await spy.results[0]) as never, 'x')
    }

    const untrustedCwd = temp()
    skillAt(untrustedCwd, '.claude/skills', 'x')
    const refused = await build(false, untrustedCwd)
    expect(refused).toMatch(/Available skills: mine\./)
    expect(refused).not.toContain('BODY OF x')

    const trustedCwd = temp()
    skillAt(trustedCwd, '.claude/skills', 'x')
    expect(await build(true, trustedCwd)).toContain('BODY OF x')

    // The configured home is read; the process's own home is not.
    expect(spy.calls.at(-1)?.[1]).toBe(home)
    const [tool] = (await spy.results[0]) as Awaited<ReturnType<typeof skillReadTool>>
    expect(String(await tool?.handler({ name: 'ambient' }, undefined as never))).toContain('not found')
  })
})
