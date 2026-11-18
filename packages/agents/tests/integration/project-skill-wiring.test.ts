/**
 * #2215 — `onWired` against the REAL SDK: a project skill is found on disk through the real
 * discovery and setting-source gate, and withheld when the project source is not granted.
 * Nothing here is mocked; the skill is never named in the builder.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent, resolveTrustPosture } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { AgentBuilder } from '../../src/bridge/agent-builder.js'
import type { CompiledWiring } from '../../src/bridge/index.js'
import { toAgentFactory } from '../../src/bridge/sdk-adapter.js'

const POSTURE = {
  kind: 'auto-approve' as const,
  confinedBy: { mode: 'workspace-write' as const, enforced: true, detail: 'test double' },
  reason: 'test surface',
}
const GRANT = {
  trustedBy: resolveTrustPosture<'projectSettings'>({
    capabilities: ['projectSettings'],
    isTrusted: () => true,
  }),
}
const API_KEY = 'sk-test-0123456789abcdef'

let cwd: string
let seq = 0
const ids: string[] = []
const id = (p: string) => {
  const v = `${p}-${process.pid}-${seq++}`
  ids.push(v)
  return v
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'wired-real-'))
  const dir = join(cwd, '.theokit', 'skills', 'project-skill')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    '---\nname: project-skill\ndescription: from the repo\n---\nbody\n',
  )
})

afterEach(async () => {
  await Promise.all(ids.splice(0).map((i) => Agent.registry.evict(i)))
  rmSync(cwd, { recursive: true, force: true })
})

function make(selection: never, seen: CompiledWiring[], skills?: never) {
  let b = AgentBuilder.create()
    .input(z.object({ m: z.string() }))
    .model('openai/gpt-4o-mini')
    .settingSources(selection)
    .onWired((w) => seen.push(w))
  if (skills !== undefined) b = b.skills(skills)
  return toAgentFactory(b.build() as never, {
    apiKey: API_KEY,
    approvals: POSTURE,
    overrides: { cwd },
  })
}

describe('onWired with the real SDK', () => {
  it('lists a project skill discovered on disk when the project source is granted', async () => {
    const seen: CompiledWiring[] = []
    await make({ project: GRANT } as never, seen)(id('granted'))
    expect(seen).toHaveLength(1)
    expect(seen[0]?.settingSources.project).toBe(true)
    expect(seen[0]?.skills.listed).toEqual(['project-skill'])
  })

  it('omits the project skill from both lists when the project source is withheld', async () => {
    for (const selection of [{}, { user: true }]) {
      const seen: CompiledWiring[] = []
      await make(selection as never, seen)(id('withheld'))
      expect(seen[0]?.settingSources.project).toBe(false)
      expect(seen[0]?.skills.listed).not.toContain('project-skill')
      expect(seen[0]?.skills.readable).not.toContain('project-skill')
    }
  })

  it('does not list an enabled name that was never discovered', async () => {
    const seen: CompiledWiring[] = []
    await make({ project: GRANT } as never, seen, ['project-skill', 'ghost'] as never)(id('ghost'))
    expect(seen[0]?.skills.listed).toEqual(['project-skill'])
  })

  it('reuses the live agent for a changed call and reports nothing for it', async () => {
    const first: CompiledWiring[] = []
    const second: CompiledWiring[] = []
    const session = id('reuse')
    const a = await make({ project: GRANT } as never, first)(session)
    const b = await make({} as never, second)(session)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)
    expect(first[0]?.skills.listed).toEqual(['project-skill'])
    expect(Agent.registry.get(session)).toBeDefined()
    expect(b).toBeDefined()
    expect(a).toBeDefined()
  })
})
