/**
 * #1866 — `onWired` reports what was handed to `Agent.create`, read from those options.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const h = vi.hoisted(() => ({ created: [] as Record<string, unknown>[] }))

vi.mock('@theokit/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Agent: {
    getOrCreate: (_id: string, opts: Record<string, unknown>) => {
      h.created.push(opts)
      return Promise.resolve({
        agentId: 'a1',
        send: () => Promise.resolve({ wait: () => Promise.resolve({ result: 'ok' }) }),
        dispose: () => Promise.resolve(),
      })
    },
  },
  Tool: { create: (spec: unknown) => spec },
  SkillReadTool: { create: () => ({ name: 'skill_read' }) },
}))

const { AgentBuilder } = await import('../../src/bridge/agent-builder.js')
const { toAgentFactory } = await import('../../src/bridge/sdk-adapter.js')
const { streamAgentTurnInProcess } = await import('../../src/in-process-turn.js')

type Wiring = import('../../src/bridge/index.js').CompiledWiring

const POSTURE = {
  kind: 'auto-approve' as const,
  confinedBy: { mode: 'workspace-write' as const, enforced: true, detail: 'test double' },
  reason: 'test surface',
}

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
  vi.restoreAllMocks()
})

describe('onWired', () => {
  it('reports the tools, skills, MCP servers, hooks and subagents handed to Agent.create', async () => {
    const seen: Wiring[] = []
    const def = base()
      .tool(tool('lookup') as never)
      .skills(['disk-skill', skill('inline-one') as never])
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
    expect(w.skills.listed).toEqual(['disk-skill', 'inline-one'])
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

  it('a project skill withheld by settingSources is absent from skills.listed and skills.readable', async () => {
    const seen: Wiring[] = []
    // No project grant: only `user` is requested, so `project` is not a source and its skills are
    // neither listed nor served.
    const def = base()
      .skills([skill('inline-one') as never])
      .settingSources({ user: true })
      .onWired((w) => seen.push(w))
      .build()
    await toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })('s2')
    const w = seen[0]!
    expect(w.settingSources.project).toBe(false)
    expect(w.skills.listed).not.toContain('project-skill')
    expect(w.skills.readable).not.toContain('project-skill')
    expect(w.skills.readable).toEqual(['inline-one'])
    const local = h.created[0]?.local as { settingSources?: string[] } | undefined
    expect(local?.settingSources ?? []).not.toContain('project')
  })

  it('a builtin in withheldBuiltinTools is absent from tools', async () => {
    const seen: Wiring[] = []
    const def = base()
      .tool(tool('shell') as never)
      .tool(tool('lookup') as never)
      .withholdBuiltinTools(['shell'])
      .onWired((w) => seen.push(w))
      .build()
    await toAgentFactory(def as never, { apiKey: 'k', approvals: POSTURE })('s3')
    expect(seen[0]?.withheldBuiltinTools).toEqual(['shell'])
    expect(seen[0]?.tools).toEqual(['lookup'])
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
