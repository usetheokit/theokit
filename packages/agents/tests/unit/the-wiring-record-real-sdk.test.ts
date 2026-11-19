/**
 * #1866 — `onWired` against the REAL SDK: skills come from what the created agent resolved.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { AgentBuilder } from '../../src/bridge/agent-builder.js'
import type { CompiledWiring } from '../../src/bridge/index.js'
import { toAgentFactory } from '../../src/bridge/sdk-adapter.js'

const POSTURE = {
  kind: 'auto-approve' as const,
  confinedBy: { mode: 'workspace-write' as const, enforced: true, detail: 'test double' },
  reason: 'test surface',
}
const TRUSTED = { level: 'trusted', source: 'default', allows: { projectSettings: true } } as never

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function diskSkill(root: string, name: string) {
  const dir = join(root, '.theokit', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} d\n---\nbody\n`)
}

async function wire(selection: never, names: string[], inline: boolean) {
  const cwd = mkdtempSync(join(tmpdir(), 'wired-real-'))
  const home = mkdtempSync(join(tmpdir(), 'wired-home-'))
  dirs.push(cwd, home)
  diskSkill(cwd, 'project-skill')
  diskSkill(home, 'user-skill')
  const prevHome = process.env.HOME
  process.env.HOME = home
  try {
    const seen: CompiledWiring[] = []
    const def = AgentBuilder.create()
      .input(z.object({ m: z.string() }))
      .model('test/model')
      .skills([
        ...names,
        ...(inline
          ? [
              {
                name: 'inline-one',
                description: 'i',
                instructions: 'i',
                source: 'inline://inline-one',
              },
            ]
          : []),
      ] as never)
      .settingSources(selection)
      .onWired((w) => seen.push(w))
      .build()
    const agent = await toAgentFactory(def as never, {
      apiKey: 'test-key-1234',
      approvals: POSTURE,
      overrides: { cwd },
    })(`real-${Math.random().toString(36).slice(2)}`)
    await (agent as { dispose?: () => Promise<void> }).dispose?.()
    return seen
  } finally {
    process.env.HOME = prevHome
  }
}

describe('onWired with the real SDK', () => {
  it('a project skill withheld by settingSources is absent from skills.listed and skills.readable', async () => {
    const [none] = await wire({} as never, ['project-skill'], false)
    expect(none?.settingSources).toEqual({ project: false, user: false })
    expect(none?.skills.listed).toEqual([])
    expect(none?.skills.readable).toEqual([])
    const [granted] = await wire(
      { project: { trustedBy: TRUSTED } } as never,
      ['project-skill'],
      false,
    )
    expect(granted?.skills.listed).toEqual(['project-skill'])
  })

  it('omits a listed name that does not exist', async () => {
    const [w] = await wire(
      { project: { trustedBy: TRUSTED } } as never,
      ['project-skill', 'missing'],
      false,
    )
    expect(w?.skills.listed).toEqual(['project-skill'])
  })

  it('reports what the SDK resolves on the user-only path: no user skills are discovered', async () => {
    const [w] = await wire({ user: true } as never, ['project-skill', 'user-skill'], false)
    expect(w?.settingSources).toEqual({ project: false, user: true })
    expect(w?.skills.listed).toEqual([])
  })

  it('reports an inline skill as readable even though the SDK does not list it', async () => {
    const [w] = await wire({} as never, [], true)
    expect(w?.skills.readable).toEqual(['inline-one'])
    expect(w?.skills.listed).toEqual([])
  })
})
