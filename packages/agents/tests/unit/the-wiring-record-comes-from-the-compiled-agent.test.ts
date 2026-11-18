/**
 * #1866 — `onWired` reports what was handed to `Agent.create`, read from those options.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveTrustPosture } from '@theokit/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { CompiledWiring } from '../../src/bridge/index.js'

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  // session id -> the cwd it is persisted under; a resume only finds it from that cwd.
  known: new Map<string, string | undefined>(),
  resumeCwds: [] as (string | undefined)[],
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
    getOrCreate: (_id: string, opts: Record<string, unknown>) => {
      h.created.push(opts)
      return Promise.resolve(fakeAgent())
    },
    resume: (id: string, opts: Record<string, unknown>) => {
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

// A real posture from the SDK's own resolver, not a literal: the grant has provenance.
const TRUSTED = resolveTrustPosture<'projectSettings'>({
  capabilities: ['projectSettings'],
  isTrusted: () => true,
}) as never

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
    // A real project skill on disk, under the cwd the agent runs in.
    const cwd = mkdtempSync(join(tmpdir(), 'wired-'))
    try {
      const dir = join(cwd, '.theokit', 'skills', 'project-skill')
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'SKILL.md'),
        '---\nname: project-skill\ndescription: from the repo\n---\nbody\n',
      )
      const run = async (selection: never, id: string) => {
        const seen: Wiring[] = []
        const def = base()
          .skills(['project-skill', skill('inline-one') as never])
          .settingSources(selection)
          .onWired((w) => seen.push(w))
          .build()
        await toAgentFactory(def as never, {
          apiKey: 'k',
          approvals: POSTURE,
          overrides: { cwd },
        })(id)
        return seen[0]!
      }
      // Both no source and user-only leave the project root unread.
      for (const [selection, id] of [
        [{}, 's2'],
        [{ user: true }, 's2u'],
      ] as const) {
        const w = await run(selection as never, id)
        expect(w.settingSources.project).toBe(false)
        expect(w.skills.listed).toEqual(['inline-one'])
        expect(w.skills.readable).toEqual(['inline-one'])
      }
      const local = h.created[0]?.local as { settingSources?: string[]; cwd?: string }
      expect(local.cwd).toBe(cwd)
      expect(local.settingSources ?? []).not.toContain('project')

      // Same disk, with the grant: the project root is a source, so the contrast is the gate.
      const w = await run({ user: true, project: { trustedBy: TRUSTED } } as never, 's2b')
      expect(w.settingSources).toEqual({ project: true, user: true })
      expect(w.skills.listed).toEqual(['project-skill', 'inline-one'])
      expect(w.skills.readable).toEqual(['inline-one'])
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
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
    // Same persisted session, different options: the agent already exists, so nothing is reported
    // and the listener never sees a wiring the agent does not have.
    await make(['lookup', 'other'], second)('reuse')
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
