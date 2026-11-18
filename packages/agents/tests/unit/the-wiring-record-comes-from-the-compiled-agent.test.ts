/**
 * #1866 — `onWired` reports what was handed to `Agent.create`, read from those options.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { CompiledWiring } from '../../src/bridge/index.js'

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  // session id -> the cwd it is persisted under; a resume only finds it from that cwd.
  known: new Map<string, string | undefined>(),
  resumeCwds: [] as (string | undefined)[],
  // The SDK's live-agent cache (`Agent.registry`): a faithful stand-in, so a cached agent is reused.
  live: new Map<string, unknown>(),
  resumes: 0,
}))

const fakeAgent = () => ({
  agentId: 'a1',
  send: () => Promise.resolve({ wait: () => Promise.resolve({ result: 'ok' }) }),
  dispose: () => Promise.resolve(),
})
const cwdOf = (o: Record<string, unknown>) => (o.local as { cwd?: string } | undefined)?.cwd

vi.mock('@theokit/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Agent: {
    registry: {
      get: (id: string) => h.live.get(id),
      set: (id: string, agent: unknown) => {
        h.live.set(id, agent)
      },
    },
    getOrCreate: (_id: string, opts: Record<string, unknown>) => {
      h.created.push(opts)
      return Promise.resolve(fakeAgent())
    },
    resume: (id: string, opts: Record<string, unknown>) => {
      h.resumes++
      h.resumeCwds.push(cwdOf(opts))
      if (h.known.has(id) && h.known.get(id) === cwdOf(opts)) return Promise.resolve(fakeAgent())
      return Promise.reject(Object.assign(new Error('unknown'), { name: 'UnknownAgentError' }))
    },
    create: async (opts: Record<string, unknown>) => {
      await Promise.resolve()
      const id = opts.agentId as string
      if (h.known.has(id)) {
        throw Object.assign(new Error('exists'), { code: 'agent_id_already_exists' })
      }
      h.known.set(id, cwdOf(opts))
      h.created.push(opts)
      return fakeAgent()
    },
  },
  Tool: { create: (spec: unknown) => spec },
  SkillReadTool: { create: () => ({ name: 'skill_read' }) },
}))

const { AgentBuilder } = await import('../../src/bridge/agent-builder.js')
const { getOrCreateReporting } = await import('../../src/bridge/compiled-wiring.js')
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
  h.resumes = 0
  h.resumeCwds.length = 0
  vi.restoreAllMocks()
})

describe('onWired', () => {
  it('reports the tools, skills, MCP servers, hooks and subagents handed to Agent.create', async () => {
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
    // The fake SDK agent lists no skills of its own, so only the inline one is known from options.
    expect(w.skills.listed).toEqual(['inline-one'])
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

  it('reports nothing for a resumed session, found from a non-default cwd', async () => {
    const cwd = '/somewhere/else'
    h.known.set('known', cwd)
    const seen: Wiring[] = []
    const def = base()
      .onWired((w) => seen.push(w))
      .build()
    const make = toAgentFactory(def as never, {
      apiKey: 'k',
      approvals: POSTURE,
      overrides: { cwd },
    })
    await make('known')
    expect(h.resumeCwds).toEqual([cwd])
    expect(seen).toHaveLength(0)
    await make('fresh')
    expect(seen).toHaveLength(1)
  })

  it('a reused session keeps its first wiring and ignores changed options', async () => {
    const first: Wiring[] = []
    const second: Wiring[] = []
    const make = (tools: string[], seen: Wiring[]) =>
      toAgentFactory(
        tools
          .reduce((b, t) => b.tool(tool(t) as never), base())
          .onWired((w) => seen.push(w))
          .build() as never,
        { apiKey: 'k', approvals: POSTURE },
      )
    await make(['lookup'], first)('reuse')
    expect(first).toHaveLength(1)
    expect(first[0]?.tools).toEqual(['lookup'])
    // Same persisted session, different options: the live agent is reused untouched (no resume
    // that would merge the new options into a second handle), so nothing is reported.
    const resumesBefore = h.resumes
    await make(['lookup', 'other'], second)('reuse')
    expect(h.resumes).toBe(resumesBefore)
    expect(second).toHaveLength(0)
    expect(first).toHaveLength(1)
    expect(first[0]?.tools).toEqual(['lookup'])
    // A new session with the changed options is a creation and reports its own options.
    await make(['lookup', 'other'], second)('reuse-2')
    expect(second.map((w) => w.tools)).toEqual([['lookup', 'other']])
  })

  it('reports once when two calls race to create the same fresh session', async () => {
    const { Agent } = await import('@theokit/sdk')
    const seen: Wiring[] = []
    const options = { tools: [{ name: 'lookup' }] }
    await Promise.all([
      getOrCreateReporting(Agent, 'same', options, (w) => seen.push(w)),
      getOrCreateReporting(Agent, 'same', options, (w) => seen.push(w)),
    ])
    expect(seen).toHaveLength(1)
    expect(h.created).toHaveLength(1)
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
