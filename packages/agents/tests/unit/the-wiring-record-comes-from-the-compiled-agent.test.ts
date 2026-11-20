/**
 * #1866 — `onWired` reports what was handed to `Agent.create`, read from those options.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { CompiledWiring } from '../../src/bridge/index.js'

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  // session id -> persisted (resumable) but not live
  known: new Set<string>(),
  live: new Map<string, unknown>(),
  inFlight: new Map<string, Promise<unknown>>(),
  resumed: [] as string[],
  // project skills on disk the fake SDK can resolve
  projectSkills: ['project-skill'] as string[],
}))

type Opts = Record<string, unknown> & {
  skills?: { enabled?: string[]; inline?: { name: string }[] }
  local?: { settingSources?: string[] }
}

/** Mirrors what the SDK resolves: a disk skill only when its source is granted AND it exists. */
function fakeAgent(opts: Opts) {
  const sources = opts.local?.settingSources ?? []
  const enabled = opts.skills?.enabled ?? []
  const list = [
    ...(sources.includes('project') ? h.projectSkills.filter((n) => enabled.includes(n)) : []),
    // The SDK discovers no user skills on the user-only path, and filters inline ones through `enabled`.
    ...(opts.skills?.inline ?? []).map((i) => i.name).filter((n) => enabled.includes(n)),
  ]
  return {
    agentId: 'a1',
    skills: { list: () => Promise.resolve(list.map((name) => ({ name, description: name }))) },
    send: () => Promise.resolve({ wait: () => Promise.resolve({ result: 'ok' }) }),
    dispose: () => Promise.resolve(),
  }
}

async function sdkCreate(opts: Opts & { agentId: string; onBeforeCreate?: () => unknown }) {
  await Promise.resolve()
  await opts.onBeforeCreate?.()
  h.created.push(opts)
  h.known.add(opts.agentId)
  return fakeAgent(opts)
}

vi.mock('@theokit/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Agent: {
    // The SDK's documented shape: live cache, then in-flight, then resume-or-create.
    getOrCreate: async (id: string, opts: Opts) => {
      const live = h.live.get(id)
      if (live !== undefined) return live
      const running = h.inFlight.get(id)
      if (running !== undefined) return running
      const build = (async () => {
        let agent: unknown
        if (h.known.has(id)) {
          h.resumed.push(id)
          agent = fakeAgent(opts)
        } else {
          agent = await sdkCreate({ ...opts, agentId: id } as never)
        }
        h.live.set(id, agent)
        return agent
      })()
      h.inFlight.set(id, build)
      try {
        return await build
      } finally {
        h.inFlight.delete(id)
      }
    },
  },
  Tool: { create: (spec: unknown) => spec },
  SkillReadTool: { create: () => ({ name: 'skill_read' }) },
}))

const { getOrCreateReporting, WIRED_LISTENER } = await import('../../src/bridge/compiled-wiring.js')
const { AgentBuilder } = await import('../../src/bridge/agent-builder.js')
const { toAgentFactory } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentTurnInProcess } = await import('../../src/in-process-turn.js')

type Wiring = CompiledWiring

const POSTURE = {
  kind: 'auto-approve' as const,
  confinedBy: { mode: 'workspace-write' as const, enforced: true, detail: 'test double' },
  reason: 'test surface',
}

const TRUSTED = {
  level: 'trusted',
  source: 'default',
  allows: { projectSettings: true },
} as never

const tool = (name: string) => ({
  name,
  description: name,
  inputSchema: z.object({}),
  handler: () => 'ok',
})
const skill = (name: string) => ({
  name,
  description: name,
  instructions: name,
  source: `inline://${name}`,
})

function base() {
  return AgentBuilder.create()
    .input(z.object({ m: z.string() }))
    .model('test/model')
}

afterEach(() => {
  h.created.length = 0
  h.known.clear()
  h.live.clear()
  h.inFlight.clear()
  h.resumed.length = 0
  h.projectSkills = ['project-skill']
  vi.restoreAllMocks()
})

describe('onWired', () => {
  it('reports the tools, skills, MCP servers, hooks and subagents handed to Agent.create', async () => {
    h.projectSkills = ['disk-skill']
    const seen: Wiring[] = []
    const def = base()
      .tool(tool('lookup') as never)
      .skills(['disk-skill', skill('inline-one') as never])
      .settingSources({ project: { trustedBy: TRUSTED } })
      .mcp({ docs: { command: 'x' } } as never)
      .hooks({ pre_tool_call: () => undefined })
      .subagents({ helper: { description: 'h', prompt: 'p' } } as never)
      .onWired((w) => seen.push(w))
      .build()
    await toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })('s1')

    expect(seen).toHaveLength(1)
    const w = seen[0]!
    const created = h.created[0]!
    expect(w.tools).toEqual((created.tools as { name: string }[]).map((t) => t.name))
    expect(w.tools).toEqual(expect.arrayContaining(['lookup', 'skill_read']))
    expect(w.skills.listed).toEqual(['disk-skill'])
    expect(w.skills.readable).toEqual(['inline-one'])
    expect(w.mcpServers).toEqual(['docs'])
    expect(w.hooks).toEqual([{ event: 'pre_tool_call' }])
    expect(w.subagents).toEqual(Object.keys(created.agents as object))
    expect(w.subagents).toEqual(['helper'])
  })

  it('also reports on the in-process stream path', async () => {
    const seen: Wiring[] = []
    const def = base()
      .tool(tool('lookup') as never)
      .onWired((w) => seen.push(w))
      .build()
    for await (const _ of streamAgentTurnInProcess({ default: def } as never, 'key', {
      message: 'hi',
    })) {
      // drain
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]?.tools).toContain('lookup')
  })

  it('reports nothing for a resumed session', async () => {
    h.known.add('known')
    const seen: Wiring[] = []
    const def = base()
      .onWired((w) => seen.push(w))
      .build()
    const make = toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })
    await make('known')
    expect(h.resumed).toEqual(['known'])
    expect(seen).toHaveLength(0)
    await make('fresh')
    expect(seen).toHaveLength(1)
  })

  it('reports nothing for a live-cache hit', async () => {
    const seen: Wiring[] = []
    const def = base()
      .onWired((w) => seen.push(w))
      .build()
    const make = toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })
    await make('twice')
    await make('twice')
    expect(h.created).toHaveLength(1)
    expect(seen).toHaveLength(1)
  })

  it('two concurrent creations for one session make one Agent.create and one onWired call', async () => {
    const { Agent } = await import('@theokit/sdk')
    const seen: Wiring[] = []
    const options = {
      tools: [{ name: 'lookup' }],
      plugins: [{ [WIRED_LISTENER]: (w: Wiring) => seen.push(w) }],
    }
    const [a, b] = await Promise.all([
      getOrCreateReporting(Agent, 'same', options),
      getOrCreateReporting(Agent, 'same', options),
    ])
    expect(a).toBe(b)
    expect(h.created).toHaveLength(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.tools).toEqual(['lookup'])
  })

  it('a builtin in withheldBuiltinTools is absent from tools', async () => {
    const seen: Wiring[] = []
    const def = base()
      .tool(tool('lookup') as never)
      .withholdBuiltinTools(['shell'])
      .onWired((w) => seen.push(w))
      .build()
    await toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })('s3')
    expect(seen[0]?.withheldBuiltinTools).toEqual(['shell'])
    expect(seen[0]?.tools).toEqual(['lookup'])
    expect(seen[0]?.tools).not.toContain('shell')
  })

  it('a caller tool that replaces a withheld builtin stays in tools', async () => {
    const seen: Wiring[] = []
    const def = base()
      .tool(tool('shell') as never)
      .withholdBuiltinTools(['shell'])
      .onWired((w) => seen.push(w))
      .build()
    await toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })('s3b')
    expect(seen[0]?.withheldBuiltinTools).toEqual(['shell'])
    expect(seen[0]?.tools).toEqual(['shell'])
  })

  it('a throwing onWired listener is reported and the agent still builds', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const def = base()
      .onWired(() => {
        throw new Error('boom')
      })
      .build()
    const handle = await toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })('s4')
    expect(handle).toBeDefined()
    expect(h.created).toHaveLength(1)
    expect(warn).toHaveBeenCalled()
  })
})
