import 'reflect-metadata'
import {
  AgentConfigCapability,
  ContextWindowCapability,
  ProjectContextCapability,
  SkillsOptionsCapability,
} from '../../src/capability/agent-capabilities.js'
import { applyCapabilities } from '../../src/capability/capability.js'
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

import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'
import { createSdkAgentStream } from '../../src/bridge/sdk-adapter.js'
import { streamAgentUIMessages } from '../../src/bridge/agent-endpoint.js'
import { AgentBuilder } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'
import type { SettingSourceCapability } from '../../src/bridge/setting-sources-gate.js'
import type { TrustPosture } from '../../src/index.js'

async function drain(compiled: CompiledAgentOptions) {
  const factory = createSdkAgentStream(compiled, [], 'test-key', { model: 'openai/gpt-4o-mini' })
  for await (const _ of factory('hello', 'session-1')) {
    // drain — triggers Agent.create()
  }
  return createSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

/**
 * A posture that grants `projectSettings`.
 *
 * M68 — `.settingSources()` takes a selection with evidence, not a string array: `project` reads
 * `<cwd>/.theokit/`, including shell-executing `hooks.json`. These tests exercise the `project`
 * source, so they have to state the trust decision the same way a caller would.
 *
 * A LITERAL here, unlike the gate's own tests which build it through `resolveTrustPosture`: this
 * file mocks `@theokit/sdk`, so the real resolver is unreachable by construction. The provenance
 * that makes a posture meaningful is proven in `setting-sources-gate.test.ts`, against the real
 * SDK; what this fixture supplies is a granted decision, because the subject here is cwd threading,
 * not trust.
 */
const PROJECT_GRANTED = {
  project: {
    trustedBy: {
      level: 'trusted',
      source: 'default',
      allows: { projectSettings: true },
    } as TrustPosture<SettingSourceCapability>,
  },
}

describe('M8 adapter wiring — compiled decorators reach Agent.create() (T4.1)', () => {
  beforeEach(() => createSpy.mockClear())
  afterEach(() => vi.restoreAllMocks())

  it('test_adapter_passes_skills_to_create', async () => {
    const opts = await drain(applyCapabilities([new SkillsOptionsCapability({ include: ['x'] })]))
    expect(opts.skills).toEqual({ enabled: ['x'], autoInject: true })
    // EC-1 used to read "skills need a settings source for the SDK to discover SKILL.md files", and
    // asserted `settingSources` CONTAINED 'project'. The concern was real; the remedy was too broad.
    //
    // `project` is one root, not a menu: it enables SKILL.md discovery AND `hooks.json`, which
    // executes shell. The SDK's own capability grant is all-or-nothing (ADR 0065), so there is no
    // way to buy the first without the second. Turning it on because an agent declared skills meant
    // every such agent silently ran whatever the working directory's hooks said.
    //
    // Since M68 the tradeoff is the caller's to make, explicitly: declare `project` with a posture
    // to discover skills from disk, and accept the hooks that come with it. Skills declared in code
    // — this case — need no disk at all.
    expect(
      (opts.local as { settingSources?: string[] } | undefined)?.settingSources ?? [],
    ).not.toContain('project')
  })

  it('test_adapter_passes_context_to_create', async () => {
    const opts = await drain(
      applyCapabilities([new ContextWindowCapability({ maxTokens: 42_000 })]),
    )
    expect((opts.context as { maxTokens?: number }).maxTokens).toBe(42_000)
  })

  it('test_adapter_passes_project_resolver', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'm8-wire-'))
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'fx' }))
    try {
      const pcAgent = applyCapabilities([
        new AgentConfigCapability({ systemPrompt: 'BASE' }),
        new ProjectContextCapability({}),
      ])
      const opts = await drain(pcAgent)
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
    const plainAgent = applyCapabilities([
      new AgentConfigCapability({ systemPrompt: 'PLAIN_PROMPT' }),
    ])
    const opts = await drain(plainAgent)
    expect(opts.skills).toBeUndefined()
    expect(opts.context).toBeUndefined()
    expect(opts.local).toBeUndefined()
    expect(opts.systemPrompt).toBe('PLAIN_PROMPT')
  })

  it('test_adapter_absent_no_systemprompt_omits_key', async () => {
    // Agent with neither M8 decorators nor a systemPrompt: no systemPrompt key.
    const bareAgent = applyCapabilities([])
    const opts = await drain(bareAgent)
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
    const compiled = compileAgentDefinition(
      AgentBuilder.create().model('m').settingSources(PROJECT_GRANTED).build(),
    )
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
    await drain(applyCapabilities([new SkillsOptionsCapability({ include: ['y'] })]))
    const hits = debug.mock.calls.filter((c) =>
      String(c[0]).includes('THEO_AGENT_M8_RUNTIME_APPLIED'),
    )
    expect(hits.length).toBeGreaterThanOrEqual(1)
    delete process.env.THEOKIT_DEBUG
  })
})
