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
import { getOrCreateReporting } from '../../src/bridge/compiled-wiring.js'
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

  describe('listener and direct SDK creation racing on one session', () => {
    const opts = () => ({
      apiKey: API_KEY,
      model: { id: 'openai/gpt-4o-mini' },
      local: { cwd },
    })
    const check = async (
      session: string,
      calls: Promise<unknown>[],
      seen: CompiledWiring[],
      reports: number,
    ) => {
      const [a, b] = (await Promise.all(calls)) as { dispose(): Promise<void> }[]
      expect(a).toBe(b)
      expect(Agent.registry.get(session)).toBe(a)
      expect(seen).toHaveLength(reports)
      // The real registry still resolves to the one live handle after the race settled.
      await new Promise((r) => setTimeout(r, 20))
      expect(Agent.registry.get(session)).toBe(a)
      expect(await Agent.getOrCreate(session, opts() as never)).toBe(a)
    }

    it('listener call first, direct SDK call second', async () => {
      const seen: CompiledWiring[] = []
      const session = id('race-a')
      await check(
        session,
        [
          getOrCreateReporting(Agent, session, opts(), (w) => seen.push(w)),
          Agent.getOrCreate(session, opts() as never),
        ],
        seen,
        1,
      )
    })

    it('direct SDK call first, listener call second', async () => {
      const seen: CompiledWiring[] = []
      const session = id('race-b')
      await check(
        session,
        [
          Agent.getOrCreate(session, opts() as never),
          getOrCreateReporting(Agent, session, opts(), (w) => seen.push(w)),
        ],
        seen,
        0,
      )
    })

    it('reports the options of the call that created, not of one that joined the creation', async () => {
      const mine: CompiledWiring[] = []
      const session = id('race-c')
      const direct = { ...opts(), withheldBuiltinTools: ['bash'] }
      // Direct SDK call starts creating first; the listener call joins it with different options.
      await Promise.all([
        Agent.getOrCreate(session, direct as never),
        getOrCreateReporting(Agent, session, opts(), (w) => mine.push(w)),
      ])
      expect(mine).toHaveLength(0)
      // Listener call first, direct call joins: the listener's own options are what is reported.
      const session2 = id('race-d')
      const own = { ...opts(), withheldBuiltinTools: ['write'] }
      await Promise.all([
        getOrCreateReporting(Agent, session2, own, (w) => mine.push(w)),
        Agent.getOrCreate(session2, direct as never),
      ])
      expect(mine.map((w) => w.withheldBuiltinTools)).toEqual([['write']])
    })

    it('does not hand a disposed handle to a later listener call while reporting is pending', async () => {
      const seen: CompiledWiring[] = []
      const session = id('race-dispose')
      // Hold the first call's wiring report open (agent.skills.list pending) so the window is deterministic.
      let release!: () => void
      const gate = new Promise<void>((r) => (release = r))
      const statics = Agent as unknown as { create: (o: never) => Promise<any> }
      const realCreate = statics.create
      statics.create = async function (this: unknown, o: never) {
        const ag = await realCreate.call(this, o)
        Object.defineProperty(ag, 'skills', {
          configurable: true,
          value: { list: async () => (await gate, []) },
        })
        return ag
      }
      const first = getOrCreateReporting(Agent, session, opts(), (w) => seen.push(w))
      while (Agent.registry.get(session) === undefined) await new Promise((r) => setTimeout(r, 0))
      const doomed = Agent.registry.get(session) as unknown as { dispose(): Promise<void> }
      await doomed.dispose()
      statics.create = realCreate
      const next = (await getOrCreateReporting(Agent, session, opts(), (w) => seen.push(w))) as {
        dispose(): Promise<void>
      }
      expect(next).not.toBe(doomed)
      expect(Agent.registry.get(session)).toBe(next)
      const direct = await Agent.getOrCreate(session, opts() as never)
      expect(direct).toBe(next)
      release()
      await first
      expect(Agent.registry.get(session)).toBe(next)
      await next.dispose()
    })
  })
})
