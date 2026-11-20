import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildThroughRuntime, readSkill, TRUSTED, UNTRUSTED } from '../helpers/advertised-skill-read.js'
import { tempRoot } from '../helpers/temp-root.js'

/**
 * #1904 — `skill_read` serves exactly what the `<skills>` block lists: the repository's skills only
 * in a trusted directory, and the operator's own from the CONFIGURED home.
 *
 * These go through `buildChatAgent` and the framework runtime, so the `chat.ts` → `.skills(…, { read:
 * 'advertised' })` and `disk-entities.ts` → `discoverRoles` wiring is what is under test.
 */
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

const build = buildThroughRuntime
const skillRead = readSkill

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

    const answer = await skillRead(await build(cwd, home, UNTRUSTED, ['x']), 'x')

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

    expect(await skillRead(await build(cwd, home, TRUSTED, ['x']), 'x')).toContain('PROJECT-X')
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

describe('skill_read serves exactly the skills the <skills> block lists (#1925)', () => {
  it('does not serve a skill on disk that the configuration did not enable', async () => {
    const cwd = tempRoot('skill-adv-cwd-')
    const home = tempRoot('skill-adv-home-')
    write(join(cwd, '.claude', 'skills'), 'listed', 'LISTED-BODY')
    write(join(cwd, '.claude', 'skills'), 'unlisted', 'UNLISTED-BODY')

    const agent = await build(cwd, home, TRUSTED, ['listed'])

    expect(await skillRead(agent, 'listed')).toContain('LISTED-BODY')
    const answer = await skillRead(agent, 'unlisted')
    expect(answer).not.toContain('UNLISTED-BODY')
    expect(answer).toContain('not found')
  })

  it('serves a skill shipped in a plugin bundle once it is enabled', async () => {
    const cwd = tempRoot('skill-adv-cwd-')
    const home = tempRoot('skill-adv-home-')
    write(join(cwd, '.claude', 'plugins', 'sample', 'skills'), 'bundled', 'BUNDLED-BODY')

    const agent = await build(cwd, home, TRUSTED, ['bundled'])

    expect(await skillRead(agent, 'bundled')).toContain('BUNDLED-BODY')
  })
})
