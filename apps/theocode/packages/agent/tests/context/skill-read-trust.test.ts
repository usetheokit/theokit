import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { tempRoot } from '../helpers/temp-root.js'

/**
 * #1904 — `skill_read` serves exactly what the `<skills>` block lists: the repository's skills only
 * in a trusted directory, and the operator's own from the CONFIGURED home.
 *
 * These go through `buildChatAgent`, so the `chat.ts` → `skillReadTool` and `disk-entities.ts` →
 * `discoverRoles` wiring is what is under test, not only the helpers.
 */
const allows = (on: boolean) => ({
  projectConfig: on,
  agentsMd: on,
  hooks: on,
  memory: on,
  mcp: on,
  skills: on,
  subagents: on,
  customCommands: on,
})
const TRUSTED = { level: 'trusted', allows: allows(true) }
const UNTRUSTED = { level: 'untrusted', source: 'store', allows: allows(false) }

const config = {
  sandbox_mode: 'read-only',
  approval_policy: 'on-request',
  model: 'gpt-5.4',
  reasoning_effort: 'medium',
  hooks: [],
  skills: [],
  memory: false,
  declaredWindow: undefined,
  contextWindow: { window: 1000 },
  sandboxPosture: { enforced: true, detail: 'test', mode: 'read-only' },
}

const discoverRoles = vi.hoisted(() => vi.fn())

vi.mock('../../src/delegation/role-discovery.js', async (orig) => {
  const actual = await orig<typeof import('../../src/delegation/role-discovery.js')>()
  discoverRoles.mockImplementation(actual.discoverRoles)
  return { ...actual, discoverRoles }
})

function write(root: string, name: string, canary: string): void {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A skill.\n---\nReply with ${canary}.\n`,
  )
}

interface Compiled {
  tools: { name: string; handler: (input: Record<string, unknown>) => unknown }[]
}

async function build(cwd: string, home: string, posture: unknown): Promise<Compiled> {
  const { buildChatAgent } = await import('../../src/chat/chat.js')
  return (await buildChatAgent({
    surface: 'headless',
    cwd,
    home,
    posture,
    config,
  } as never)) as unknown as Compiled
}

async function skillRead(agent: Compiled, name: string): Promise<string> {
  const tool = agent.tools.find((t) => t.name === 'skill_read')
  expect(tool, 'skill_read is missing from the agent').toBeDefined()
  return String(await tool?.handler({ name }))
}

describe('skill_read through buildChatAgent (#1904)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses a repository skill in an untrusted directory and does not name it', async () => {
    const cwd = tempRoot('skill-trust-cwd-')
    const home = tempRoot('skill-trust-home-')
    write(join(cwd, '.claude', 'skills'), 'x', 'PROJECT-X')
    // One operator skill, so the tool exists and its not-found answer lists names.
    write(join(home, '.theokit', 'skills'), 'mine', 'MINE')

    const answer = await skillRead(await build(cwd, home, UNTRUSTED), 'x')

    expect(answer).not.toContain('PROJECT-X')
    expect(answer).toContain('not found')
    expect(answer).toContain('mine')
    // The answer echoes the requested name; what it must not do is LIST it.
    expect(answer.split('Available skills:')[1]).not.toMatch(/\bx\b/)
  })

  it('returns the body of a repository skill in a trusted directory', async () => {
    const cwd = tempRoot('skill-trust-cwd-')
    const home = tempRoot('skill-trust-home-')
    write(join(cwd, '.claude', 'skills'), 'x', 'PROJECT-X')

    expect(await skillRead(await build(cwd, home, TRUSTED), 'x')).toContain('PROJECT-X')
  })

  it('reads the configured home and not the real one', async () => {
    const cwd = tempRoot('skill-trust-cwd-')
    const home = tempRoot('skill-trust-home-')
    write(join(home, '.theokit', 'skills'), 'fromhome', 'HOME-BODY')

    const agent = await build(cwd, home, UNTRUSTED)

    expect(await skillRead(agent, 'fromhome')).toContain('HOME-BODY')
    // The real home is never consulted: its skills are absent from the not-found list.
    const { homedir } = await import('node:os')
    const { discoverSkills } = await import('@theokit/sdk/skills')
    const real = (await discoverSkills(join(homedir(), '.theokit', 'skills'))).map((s) => s.name)
    const listed = await skillRead(agent, 'no-such-skill')
    for (const name of real) if (name !== 'fromhome') expect(listed).not.toContain(name)
  })

  it('gives the configured home to role discovery', async () => {
    const cwd = tempRoot('skill-trust-cwd-')
    const home = tempRoot('skill-trust-home-')

    await build(cwd, home, TRUSTED)

    expect(discoverRoles).toHaveBeenCalledWith(expect.objectContaining({ cwd, home }))
  })
})
