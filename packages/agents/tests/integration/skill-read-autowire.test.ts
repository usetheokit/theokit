/**
 * Auto-wiring `skill_read` for inline skills.
 *
 * BDD: Given `defineAgent({ skills: [inlineSkill] })`, When the agent runs, Then the SDK agent is created
 * with a `skill_read` tool — so one `.skills([...])` call both registers the skill into the `<skills>`
 * block (name + description) AND makes its body readable. Without the tool an inline skill's `instructions`
 * are unreachable to the model, so registering an inline skill implies wanting it readable.
 *
 * The auto-wire lives at the RUNTIME layer (`createSdkAgentStream`), where `@theokit/sdk` is dynamically
 * loaded — the pure compile module (`compileAgentDefinition`) keeps its type-only SDK dependency. This test
 * mocks `@theokit/sdk` so `getOrCreate` can capture the tools it receives and `SkillReadTool.create` is a
 * real factory. Dedup + graceful-degrade (older SDK without the factory) are covered too.
 */
import 'reflect-metadata'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type * as SdkModule from '@theokit/sdk'
import { z } from 'zod'
import { describe, expect, it, beforeEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** Names of the tools `Agent.getOrCreate` was called with. */
  toolNames: [] as string[],
  /** Toggle: when false, the mocked SDK omits `SkillReadTool` (older-peer simulation). */
  provideReadTool: true,
  /** The source the last `SkillReadTool.create` call was given (a list, or a lazy function). */
  readSource: [] as unknown,
  /** When true, `getOrCreate` builds a REAL SDK agent so `agent.skills` is the SDK's own listing. */
  realAgent: false,
  /** The last real SDK agent `getOrCreate` built (its `skillsManager` is what a refresh re-reads). */
  /** The options the last `getOrCreate` received. */
  lastOpts: undefined as unknown,
  /** When true, the fake agent hides the SDK's skills manager (an older/newer peer). */
  hideManager: false,
  lastAgent: undefined as undefined | { skillsManager?: { refresh: () => Promise<void> } },
}))

vi.mock('@theokit/sdk', () => ({
  // SE36 (SDK v3.0) — factories are `X.create()`.
  Tool: { create: (spec: { name: string }) => ({ name: spec.name }) },
  Skill: {
    create: (spec: { name: string; description: string; instructions: string }) => ({
      ...spec,
      source: `inline://${spec.name}`,
    }),
  },
  // Present only when the toggle is on — mirrors an SDK old enough to lack SE23.
  get SkillReadTool() {
    return h.provideReadTool
      ? {
          create: (skills: ReadonlyArray<{ name: string }> | (() => unknown)) => {
            h.readSource = skills
            return {
              name: 'skill_read',
              covers: typeof skills === 'function' ? -1 : skills.length,
            }
          },
        }
      : undefined
  },
  Agent: {
    getOrCreate: vi.fn(async (_id: string, opts: { tools?: Array<{ name?: string }> }) => {
      h.toolNames = (opts.tools ?? []).map((t) => t?.name ?? '<anon>')
      const real = h.realAgent
        ? await (
            await vi.importActual<typeof SdkModule>('@theokit/sdk')
          ).Agent.create({
            ...opts,
            tools: [],
          } as never)
        : undefined
      h.lastAgent = real as never
      h.lastOpts = opts
      return {
        skills: real?.skills,
        skillsManager: h.hideManager
          ? undefined
          : (real as { skillsManager?: unknown } | undefined)?.skillsManager,
        send: async () => ({
          stream: async function* () {
            yield { type: 'status', status: 'FINISHED' }
          },
          wait: async () => ({}),
        }),
        dispose: async () => {},
      }
    }),
  },
}))

const { createSdkAgentStream, toAgentFactory } = await import('../../src/bridge/sdk-adapter.js')
const { compileAgentDefinition, defineAgent } = await import('../../src/bridge/define-agent.js')
const { AgentBuilder } = await import('../../src/bridge/agent-builder.js')
const { Skill } = await import('@theokit/sdk')

const briefing = Skill.create({
  name: 'daily-briefing',
  description: 'A morning briefing',
  instructions: 'steps...',
})

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) {
    // consume
  }
}

describe('skill_read is auto-wired for inline skills at runtime', () => {
  beforeEach(() => {
    h.toolNames = []
    h.provideReadTool = true
  })

  it('adds a skill_read tool when the agent declares an inline skill', async () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: [briefing] }))
    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-1'))
    expect(h.toolNames).toContain('skill_read')
  })

  it('does NOT add skill_read for a pure filesystem-name selection', async () => {
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: ['fs-only'] }))
    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-2'))
    expect(h.toolNames).not.toContain('skill_read')
  })

  it('does NOT double-wire when the app already declared a skill_read tool (dedup)', async () => {
    const manual = { name: 'skill_read', description: 'mine', inputSchema: {}, handler: () => 'ok' }
    const compiled = compileAgentDefinition(
      defineAgent({ model: 'm', skills: [briefing], tools: [manual] }),
    )
    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-3'))
    expect(h.toolNames.filter((n) => n === 'skill_read')).toHaveLength(1)
  })

  it('degrades gracefully when the SDK lacks SkillReadTool (no crash, no tool)', async () => {
    h.provideReadTool = false
    const compiled = compileAgentDefinition(defineAgent({ model: 'm', skills: [briefing] }))
    const factory = createSdkAgentStream(compiled, compiled.tools, 'test-key')
    await drain(factory('go', 'sess-4'))
    expect(h.toolNames).not.toContain('skill_read')
  })
})

describe('read advertised — skill_read serves what the <skills> block lists', () => {
  const trusted = {
    level: 'trusted',
    source: 'default',
    allows: { projectSettings: true },
  } as never

  function writeSkill(root: string, name: string, body: string, extra = ''): string {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: d ${name}\n${extra}---\n${body}\n`,
    )
    return join(dir, 'SKILL.md')
  }

  /** What the model gets back from `skill_read`, through the SDK's real tool over the wired source. */
  async function read(name: string): Promise<string> {
    const real = await vi.importActual<typeof SdkModule>('@theokit/sdk')
    const tool = real.SkillReadTool.create(h.readSource as never) as unknown as {
      handler: (args: { name: string }, ctx?: unknown) => unknown
    }
    return String(await tool.handler({ name }, {}))
  }

  /** Runs one turn against a REAL SDK agent, so the listing is the SDK's own resolution. */
  async function run(
    def: Parameters<typeof defineAgent>[0],
    cwd: string,
    overrides: Record<string, unknown> = {},
  ): Promise<void> {
    h.readSource = []
    h.realAgent = true
    const compiled = compileAgentDefinition(defineAgent(def))
    await drain(
      createSdkAgentStream(compiled, compiled.tools, 'test-key', { cwd, ...overrides })('go', 's'),
    )
  }

  /** The names the SDK itself lists for the same agent: `read` must agree with this, never exceed it. */
  async function listed(cwd: string, opts: Record<string, unknown>): Promise<string[]> {
    const real = await vi.importActual<typeof SdkModule>('@theokit/sdk')
    const agent = await real.Agent.create({
      apiKey: 'test-key',
      model: 'm',
      local: { cwd, ...(opts.local as object) },
      skills: opts.skills,
    } as never)
    return ((await agent.skills?.list()) ?? []).map((x) => x.name)
  }

  beforeEach(() => {
    h.toolNames = []
    h.readSource = []
    h.realAgent = false
    h.hideManager = false
    h.provideReadTool = true
  })

  const project = { settingSources: { project: { trustedBy: trusted } } }

  it('read advertised makes a skill enabled by name readable through skill_read', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    writeSkill(join(cwd, '.theokit', 'skills'), 'fs-only', 'FS BODY')
    await run({ model: 'm', skills: ['fs-only'], skillsRead: 'advertised', ...project }, cwd)
    expect(h.toolNames).toContain('skill_read')
    expect(await read('fs-only')).toContain('FS BODY')
  })

  it('read advertised does not make a project skill readable when the project root is withheld by trust', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    writeSkill(join(cwd, '.theokit', 'skills'), 'secret', 'SECRET BODY')
    await run({ model: 'm', skills: ['secret'], skillsRead: 'advertised' }, cwd)
    const answer = await read('secret')
    expect(answer).toBe('Skill "secret" not found. Available skills: (none).')
  })

  it('read advertised serves the same body the listing describes when two roots define one name', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    const winner = writeSkill(join(cwd, '.theokit', 'skills'), 'dup', 'PROJECT BODY')
    writeSkill(join(cwd, '.claude', 'skills'), 'dup', 'COMPAT BODY')
    const settingSources = { project: { trustedBy: trusted }, claudeCode: { trustedBy: trusted } }
    await run({ model: 'm', skills: ['dup'], skillsRead: 'advertised', settingSources }, cwd)
    // The listing's own winner, by path, from the SDK agent the bridge built.
    const real = await vi.importActual<typeof SdkModule>('@theokit/sdk')
    const probe = await real.Agent.create({
      apiKey: 'test-key',
      model: 'm',
      local: { cwd, settingSources: ['project'], compatSources: ['claude-code'] },
      skills: { enabled: ['dup'] },
    } as never)
    const sources = ((await probe.skills?.list()) ?? []).map((x) => x.source)
    expect(sources).toEqual([winner])
    const answer = await read('dup')
    expect(answer).toContain('PROJECT BODY')
    expect(answer).not.toContain('COMPAT BODY')
  })

  it('read advertised serves nothing the selection did not enable (an empty selection lists none)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    writeSkill(join(cwd, '.theokit', 'skills'), 'other', 'OTHER BODY')
    await run({ model: 'm', skills: [], skillsRead: 'advertised', ...project }, cwd)
    expect(await read('other')).toContain('not found')
  })

  it('read advertised does not serve a skill the listing hides from the model', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    const root = join(cwd, '.theokit', 'skills')
    writeSkill(root, 'hidden', 'HIDDEN BODY', 'disable-model-invocation: true\n')
    writeSkill(root, 'needs-bin', 'BIN BODY', 'requires-bins: definitely-not-a-binary-xyz\n')
    writeSkill(root, 'shown', 'SHOWN BODY')
    await run(
      {
        model: 'm',
        skills: ['hidden', 'needs-bin', 'shown'],
        skillsRead: 'advertised',
        ...project,
      },
      cwd,
    )
    expect(await read('hidden')).toContain('not found')
    expect(await read('needs-bin')).toContain('not found')
    expect(await read('shown')).toContain('SHOWN BODY')
  })

  it('read advertised keeps a skill hidden when its SKILL.md is edited after the SDK built its snapshot', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    const root = join(cwd, '.theokit', 'skills')
    writeSkill(root, 'later', 'LATER BODY', 'disable-model-invocation: true\n')
    await run({ model: 'm', skills: ['later'], skillsRead: 'advertised', ...project }, cwd)
    writeSkill(root, 'later', 'LATER BODY', 'disable-model-invocation: false\n')
    expect(await read('later')).toContain('not found')
  })

  it('read advertised follows the SDK manager when it refreshes: new skills readable, hidden ones not', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    const root = join(cwd, '.theokit', 'skills')
    writeSkill(root, 'old', 'OLD BODY')
    writeSkill(root, 'fresh', 'FRESH BODY', 'disable-model-invocation: true\n')
    await run({ model: 'm', skills: ['old', 'fresh'], skillsRead: 'advertised', ...project }, cwd)
    expect(await read('old')).toContain('OLD BODY')
    expect(await read('fresh')).toContain('not found')
    writeSkill(root, 'old', 'OLD BODY', 'disable-model-invocation: true\n')
    writeSkill(root, 'fresh', 'FRESH BODY 2')
    // Still the snapshot until the SDK itself refreshes.
    expect(await read('old')).toContain('OLD BODY')
    await h.lastAgent?.skillsManager?.refresh()
    expect(await read('old')).toContain('not found')
    expect(await read('fresh')).toContain('FRESH BODY 2')
  })

  it('read advertised carries through AgentBuilder.skills(..., { read }) and toAgentFactory', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    writeSkill(join(cwd, '.theokit', 'skills'), 'viabuilder', 'BUILDER BODY')
    const def = AgentBuilder.create()
      .input(z.object({ m: z.string() }))
      .model('m')
      .settingSources(project.settingSources as never)
      .skills(['viabuilder'], { read: 'advertised' })
      .build()
    h.readSource = []
    h.realAgent = true
    await toAgentFactory(def as never, {
      apiKey: 'test-key',
      approvals: {
        kind: 'auto-approve',
        confinedBy: { mode: 'workspace-write', enforced: true, detail: 't' },
        reason: 't',
      } as never,
      overrides: { cwd } as never,
    })('s-builder')
    expect(h.toolNames).toContain('skill_read')
    expect(await read('viabuilder')).toContain('BUILDER BODY')
  })

  it('AgentBuilder.skills without read stays inline-only on the factory path', async () => {
    const def = AgentBuilder.create()
      .input(z.object({ m: z.string() }))
      .model('m')
      .skills(['x'])
      .build()
    h.realAgent = false
    await toAgentFactory(def as never, {
      apiKey: 'test-key',
      approvals: {
        kind: 'auto-approve',
        confinedBy: { mode: 'workspace-write', enforced: true, detail: 't' },
        reason: 't',
      } as never,
    })('s-inline')
    expect(h.toolNames).not.toContain('skill_read')
  })

  it('keeps an app-declared skill_read on the factory path in advertised mode', async () => {
    const mine = { name: 'skill_read', description: 'mine', inputSchema: {}, handler: () => 'ok' }
    const def = defineAgent({ model: 'm', skills: ['x'], skillsRead: 'advertised', tools: [mine] })
    await toAgentFactory(def as never, {
      apiKey: 'test-key',
      approvals: {
        kind: 'auto-approve',
        confinedBy: { mode: 'workspace-write', enforced: true, detail: 't' },
        reason: 't',
      } as never,
    })('s-explicit')
    expect(h.toolNames.filter((n) => n === 'skill_read')).toHaveLength(1)
  })

  it('read advertised serves nothing when the SDK does not expose its skills manager (fails closed)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    const root = join(cwd, '.theokit', 'skills')
    writeSkill(root, 'hidden', 'HIDDEN BODY', 'disable-model-invocation: true\n')
    writeSkill(root, 'shown', 'SHOWN BODY')
    h.hideManager = true
    await run(
      { model: 'm', skills: ['hidden', 'shown'], skillsRead: 'advertised', ...project },
      cwd,
    )
    expect(await read('hidden')).toContain('not found')
    expect(await read('hidden')).not.toContain('HIDDEN BODY')
    expect(await read('shown')).toContain('not found')
  })

  it('read advertised never hands the SDK a function-valued skills setting (reader and listing share one manager)', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    writeSkill(join(cwd, '.theokit', 'skills'), 'dyn', 'DYN BODY')
    await run({ model: 'm', skills: () => ['dyn'], skillsRead: 'advertised', ...project }, cwd)
    expect(typeof (h.lastOpts as { skills?: unknown }).skills).not.toBe('function')
  })

  it('read advertised keeps a withheld project root unreadable after the SDK reloads', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    writeSkill(join(cwd, '.theokit', 'skills'), 'secret', 'SECRET BODY')
    await run({ model: 'm', skills: ['secret'], skillsRead: 'advertised' }, cwd)
    expect(await read('secret')).toContain('not found')
    // The SDK's own reload path: refresh() discovers project roots whatever the trust gate said.
    await h.lastAgent?.skillsManager?.refresh()
    expect(await read('secret')).toBe('Skill "secret" not found. Available skills: (none).')
  })

  it('read advertised serves a skill added under a granted root once the SDK refreshes', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    const root = join(cwd, '.theokit', 'skills')
    writeSkill(root, 'first', 'FIRST BODY')
    await run({ model: 'm', skillsRead: 'advertised', ...project }, cwd)
    writeSkill(root, 'added', 'ADDED BODY')
    expect(await read('added')).toContain('not found')
    await h.lastAgent?.skillsManager?.refresh()
    expect(await read('added')).toContain('ADDED BODY')
  })

  it('read advertised on the factory path resolves a function selection to its names', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    const root = join(cwd, '.theokit', 'skills')
    writeSkill(root, 'picked', 'PICKED BODY')
    writeSkill(root, 'unpicked', 'UNPICKED BODY')
    const def = defineAgent({
      model: 'm',
      skills: () => ['picked'],
      skillsRead: 'advertised',
      ...project,
    })
    h.readSource = []
    h.realAgent = true
    await toAgentFactory(def as never, {
      apiKey: 'test-key',
      approvals: {
        kind: 'auto-approve',
        confinedBy: { mode: 'workspace-write', enforced: true, detail: 't' },
        reason: 't',
      } as never,
      overrides: { cwd } as never,
    })('s-fn')
    expect((h.lastOpts as { skills?: { enabled?: string[] } }).skills?.enabled).toEqual(['picked'])
    expect(await read('picked')).toContain('PICKED BODY')
    expect(await read('unpicked')).toContain('not found')
  })

  it('read advertised does not read the compat root when only the project root is granted', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    writeSkill(join(cwd, '.claude', 'skills'), 'foreign', 'FOREIGN BODY')
    await run({ model: 'm', skills: ['foreign'], skillsRead: 'advertised', ...project }, cwd)
    expect(await read('foreign')).toContain('not found')
    expect(
      await listed(cwd, {
        local: { settingSources: ['project'] },
        skills: { enabled: ['foreign'] },
      }),
    ).toEqual([])
  })

  it('does not add a second skill_read when a per-run sdkTool already carries one', async () => {
    const compiled = compileAgentDefinition(
      defineAgent({ model: 'm', skills: [briefing], skillsRead: 'advertised' }),
    )
    const mine = { name: 'skill_read', description: 'x', inputSchema: {}, handler: () => 'ok' }
    await drain(
      createSdkAgentStream(compiled, compiled.tools, 'test-key', { sdkTools: [mine] } as never)(
        'go',
        's',
      ),
    )
    expect(h.toolNames.filter((n) => n === 'skill_read')).toHaveLength(1)
  })

  it('keeps the default mode inline-only even when a root holds the skill', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'adv-'))
    writeSkill(join(cwd, '.theokit', 'skills'), 'fs-only', 'FS BODY')
    await run({ model: 'm', skills: ['fs-only'], ...project }, cwd)
    expect(h.toolNames).not.toContain('skill_read')
  })
})
