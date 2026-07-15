import 'reflect-metadata'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Capture the options handed to Agent.create() by the adapter.
const createSpy = vi.fn()
vi.mock('@theokit/sdk', () => ({
  Agent: {
    getOrCreate: (_id: string, opts: Record<string, unknown>) => {
      createSpy(opts)
      return Promise.resolve({
        send: async () => ({ stream: async function* () {}, wait: async () => ({}) }),
        dispose: async () => {},
      })
    },
  },
  Tool: { create: (spec: unknown) => spec },
}))

import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Skills } from '../../src/decorators/skills.js'
import { ContextWindow } from '../../src/decorators/context-window.js'
import { ProjectContext } from '../../src/decorators/project-context.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { createSdkAgentStream } from '../../src/bridge/sdk-adapter.js'
import { streamAgentUIMessages } from '../../src/bridge/agent-endpoint.js'
import { agent } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'

async function drain(AgentClass: Function) {
  const compiled = compileAgent(walkAgentMetadata(AgentClass))
  const factory = createSdkAgentStream(compiled, [], 'test-key', { model: 'openai/gpt-4o-mini' })
  for await (const _ of factory('hello', 'session-1')) {
    // drain — triggers Agent.create()
  }
  return createSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

describe('M8 adapter wiring — compiled decorators reach Agent.create() (T4.1)', () => {
  beforeEach(() => createSpy.mockClear())
  afterEach(() => vi.restoreAllMocks())

  it('test_adapter_passes_skills_to_create', async () => {
    @Agent({ name: 'sk', route: '/sk' })
    @Skills(['x'])
    class SkAgent {
      @MainLoop()
      async run() {}
    }
    const opts = await drain(SkAgent)
    expect(opts.skills).toEqual({ enabled: ['x'], autoInject: true })
    // EC-1: skills need a settings source for the SDK to discover SKILL.md files.
    expect((opts.local as { settingSources?: string[] }).settingSources).toContain('project')
  })

  it('test_adapter_passes_context_to_create', async () => {
    @Agent({ name: 'cw', route: '/cw' })
    @ContextWindow({ maxTokens: 42_000 })
    class CwAgent {
      @MainLoop()
      async run() {}
    }
    const opts = await drain(CwAgent)
    expect((opts.context as { maxTokens?: number }).maxTokens).toBe(42_000)
  })

  it('test_adapter_passes_project_resolver', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'm8-wire-'))
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx' }))
    try {
      @Agent({ name: 'pc', route: '/pc', systemPrompt: 'BASE' })
      @ProjectContext({})
      class PcAgent {
        @MainLoop()
        async run() {}
      }
      const opts = await drain(PcAgent)
      expect(typeof opts.systemPrompt).toBe('function')
      const resolver = opts.systemPrompt as (ctx: { cwd: string }) => Promise<string>
      const prompt = await resolver({ cwd: repo })
      expect(prompt).toContain('BASE')
      expect(prompt).toContain('package.json')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('test_adapter_no_m8_fields_when_absent', async () => {
    @Agent({ name: 'plain', route: '/plain', systemPrompt: 'PLAIN_PROMPT' })
    class PlainAgent {
      @MainLoop()
      async run() {}
    }
    const opts = await drain(PlainAgent)
    expect(opts.skills).toBeUndefined()
    expect(opts.context).toBeUndefined()
    expect(opts.local).toBeUndefined()
    expect(opts.systemPrompt).toBe('PLAIN_PROMPT')
  })

  it('test_adapter_absent_no_systemprompt_omits_key', async () => {
    // Agent with neither M8 decorators nor a systemPrompt: no systemPrompt key.
    @Agent({ name: 'bare', route: '/bare' })
    class BareAgent {
      @MainLoop()
      async run() {}
    }
    const opts = await drain(BareAgent)
    expect(opts.skills).toBeUndefined()
    expect(opts.context).toBeUndefined()
    expect(opts.local).toBeUndefined()
    expect('systemPrompt' in opts).toBe(false)
  })

  it('test_settingSources_cwd_is_config_root_not_process_cwd (EC-1/T2.2)', async () => {
    // The framework threads its resolved projectRoot (≠ process.cwd()) as local.cwd so `.theokit/`
    // discovery points at the app root — proven by a fakeRoot that is NOT the process cwd.
    const fakeRoot = '/fake/app/root'
    expect(fakeRoot).not.toBe(process.cwd())
    const compiled = compileAgentDefinition(agent().model('m').settingSources(['project']).build())
    const gen = streamAgentUIMessages(compiled, 'test-key', {
      message: 'hi',
      sessionId: 's',
      cwd: fakeRoot,
    })
    for await (const _ of gen) {
      // drain — triggers Agent.getOrCreate()
    }
    const opts = createSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(opts.local).toEqual({ settingSources: ['project'], cwd: fakeRoot })
  })

  it('test_adapter_emits_runtime_applied_log', async () => {
    process.env.THEOKIT_DEBUG = '1' // the wiring metric is now opt-in (silent by default — TUI/pipe hygiene)
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    @Agent({ name: 'sk2', route: '/sk2' })
    @Skills(['y'])
    class Sk2 {
      @MainLoop()
      async run() {}
    }
    await drain(Sk2)
    const hits = debug.mock.calls.filter((c) =>
      String(c[0]).includes('THEO_AGENT_M8_RUNTIME_APPLIED'),
    )
    expect(hits.length).toBeGreaterThanOrEqual(1)
    delete process.env.THEOKIT_DEBUG
  })
})
