/**
 * #1866 — `onWired` reports what was handed to `Agent.create`, read from those options.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import type { CompiledWiring } from '../../src/bridge/index.js'

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  // session id -> the cwd it is persisted under; a resume only finds it from that cwd.
  known: new Map<string, string | undefined>(),
  resumeCwds: [] as (string | undefined)[],
}))

const cwdOf = (o: Record<string, unknown>) => (o.local as { cwd?: string } | undefined)?.cwd
const USER_ROOT = join(tmpdir(), 'wired-user-skills')

// Resolves like the SDK: an enabled name is found only under a root a granted source reads and
// whose SKILL.md exists (and has a name); inline skills always resolve.
const fakeAgent = (opts: Record<string, unknown>) => ({
  agentId: 'a1',
  send: () => Promise.resolve({ wait: () => Promise.resolve({ result: 'ok' }) }),
  dispose: () => Promise.resolve(),
  skills: {
    list: () => {
      const sources = ((opts.local as { settingSources?: string[] } | undefined)?.settingSources ??
        []) as string[]
      const sk = (opts.skills ?? {}) as { enabled?: string[]; inline?: { name: string }[] }
      const roots = [
        ...(sources.includes('project') ? [join(cwdOf(opts) ?? '', '.theokit', 'skills')] : []),
        ...(sources.includes('user') ? [USER_ROOT] : []),
      ]
      const found = (sk.enabled ?? []).filter((n) =>
        roots.some((r) => {
          try {
            return /^name: /m.test(readFileSync(join(r, n, 'SKILL.md'), 'utf8'))
          } catch {
            return false
          }
        }),
      )
      return Promise.resolve(
        [...found, ...(sk.inline ?? []).map((i) => i.name)].map((name) => ({ name })),
      )
    },
  },
})

const live = new Map<string, unknown>()
const building = new Map<string, Promise<unknown>>()

vi.mock('@theokit/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Agent: {
    registry: { get: (id: string) => live.get(id) },
    get: (id: string, opts: { cwd?: string } = {}) =>
      h.known.has(id) && h.known.get(id) === opts.cwd
        ? Promise.resolve({})
        : Promise.reject(Object.assign(new Error('unknown'), { name: 'UnknownAgentError' })),
    // The SDK's own shape: cache, then in-flight, then resume, then create.
    getOrCreate: (id: string, opts: Record<string, unknown>) => {
      if (live.has(id)) return Promise.resolve(live.get(id))
      const running = building.get(id)
      if (running) return running
      const p = (async () => {
        await Promise.resolve()
        if (h.known.has(id) && h.known.get(id) === cwdOf(opts)) {
          h.resumeCwds.push(cwdOf(opts))
        } else {
          h.known.set(id, cwdOf(opts))
          h.created.push(opts)
        }
        const agent = fakeAgent(opts)
        live.set(id, agent)
        return agent
      })().finally(() => building.delete(id))
      building.set(id, p)
      return p
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
  h.resumeCwds.length = 0
  live.clear()
  building.clear()
  rmSync(USER_ROOT, { recursive: true, force: true })
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
    // `disk-skill` exists nowhere, so the agent never resolved it and it is not reported.
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

  it('a project skill withheld by settingSources is absent from skills.listed and skills.readable', async () => {
    // Real skills on disk: one under the project root, one under the user root, one invalid.
    const cwd = mkdtempSync(join(tmpdir(), 'wired-'))
    const put = (root: string, name: string, body: string) => {
      mkdirSync(join(root, name), { recursive: true })
      writeFileSync(join(root, name, 'SKILL.md'), body)
    }
    try {
      put(join(cwd, '.theokit', 'skills'), 'project-skill', '---\nname: project-skill\n---\nb\n')
      put(USER_ROOT, 'user-skill', '---\nname: user-skill\n---\nb\n')
      put(join(cwd, '.theokit', 'skills'), 'broken', 'no front matter')
      let n = 0
      const run = async (selection: never) => {
        const seen: Wiring[] = []
        const def = base()
          .skills([
            'project-skill',
            'user-skill',
            'broken',
            'missing',
            skill('inline-one') as never,
          ])
          .settingSources(selection)
          .onWired((w) => seen.push(w))
          .build()
        await toAgentFactory(def as never, {
          apiKey: 'k',
          approvals: POSTURE,
          overrides: { cwd },
        })(`sk${n++}`)
        return seen[0]!
      }
      // No source: only the inline skill resolves; the disk skills are withheld.
      let w = await run({} as never)
      expect(w.skills.listed).toEqual(['inline-one'])
      expect(w.skills.readable).toEqual(['inline-one'])
      const local = h.created[0]?.local as { settingSources?: string[]; cwd?: string }
      expect(local.cwd).toBe(cwd)
      expect(local.settingSources ?? []).not.toContain('project')

      // User only: the user skill resolves, the project one stays unread.
      w = await run({ user: true } as never)
      expect(w.skills.listed).toEqual(['user-skill', 'inline-one'])

      // Project only: the project skill resolves; the invalid and missing names never appear.
      w = await run({ project: { trustedBy: TRUSTED } } as never)
      expect(w.skills.listed).toEqual(['project-skill', 'inline-one'])

      w = await run({ user: true, project: { trustedBy: TRUSTED } } as never)
      expect(w.settingSources).toEqual({ project: true, user: true })
      expect(w.skills.listed).toEqual(['project-skill', 'user-skill', 'inline-one'])
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

  it('reports once when two calls race to create the same fresh session, and not for a cached one', async () => {
    const { Agent } = await import('@theokit/sdk')
    const seen: Wiring[] = []
    const options = { tools: [{ name: 'lookup' }] }
    const [a, b] = await Promise.all([
      getOrCreateReporting(Agent, 'same', options, (w) => seen.push(w)),
      getOrCreateReporting(Agent, 'same', options, (w) => seen.push(w)),
    ])
    expect(a).toBe(b)
    expect(seen).toHaveLength(1)
    expect(h.created).toHaveLength(1)
    // A later call is served from the SDK's live cache: same handle, nothing reported.
    expect(await getOrCreateReporting(Agent, 'same', options, (w) => seen.push(w))).toBe(a)
    expect(seen).toHaveLength(1)
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
