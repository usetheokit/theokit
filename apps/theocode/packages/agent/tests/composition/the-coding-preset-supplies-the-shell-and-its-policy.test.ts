/**
 * #2954 — the policy half of the coding agent comes from `codingAgentPreset`, not from links in
 * `chat.ts`. In `read-only` the shell is still held (the sandbox confines it, the card gates it),
 * with the product's own `Bash` steer, the builtin `shell` withheld and foreign hooks refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { tempRoot } from '../helpers/temp-root.js'
import { withCapabilities } from '../helpers/with-capabilities.js'

const posture = (allowed: boolean) => ({
  level: allowed ? 'trusted' : 'untrusted',
  source: 'store',
  allows: {
    projectConfig: allowed,
    agentsMd: allowed,
    hooks: allowed,
    memory: allowed,
    mcp: allowed,
    skills: allowed,
    subagents: allowed,
    customCommands: allowed,
  },
})

function config(sandbox_mode: string) {
  return {
    sandbox_mode,
    approval_policy: 'on-request',
    model: 'gpt-5.4',
    reasoning_effort: 'medium',
    hooks: [],
    skills: [],
    memory: false,
    declaredWindow: undefined,
    contextWindow: { window: 1000 },
    sandboxPosture: { enforced: true, detail: 'test', mode: sandbox_mode },
  }
}

const resolveTrustPosture = vi.fn(() => posture(true))
const resolveEffectiveConfig = vi.fn(() => config('read-only'))

vi.mock('../../src/config/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveTrustPosture,
  resolveEffectiveConfig,
}))

const presetSpy = vi.fn()
vi.mock('@theokit/agents/presets', async (orig) => {
  const real = await orig<typeof import('@theokit/agents/presets')>()
  return {
    ...real,
    codingAgentPreset: (options: Parameters<typeof real.codingAgentPreset>[0]) => {
      presetSpy(options)
      return real.codingAgentPreset(options)
    },
  }
})

const realHome = process.env.HOME
beforeEach(() => {
  process.env.HOME = tempRoot('preset-policy-home-')
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
})

async function compile() {
  const { buildChatAgent } = await import('../../src/chat/chat.js')
  return withCapabilities(
    await buildChatAgent({ surface: 'headless', cwd: tempRoot('preset-policy-cwd-') } as never),
  ) as {
    tools: { name: string; description?: string }[]
    withheldBuiltinTools?: string[]
    hookApproval?: unknown
    settingSources: string[]
  }
}

describe('the coding preset in read-only', () => {
  it('test_keeps_bash_with_the_product_steer_and_no_write_tool', async () => {
    const agent = await compile()
    const names = agent.tools.map((t) => t.name)

    expect(names).toEqual(expect.arrayContaining(['Bash', 'interactive_shell', 'write_stdin']))
    expect(names).not.toContain('ApplyPatch')
    expect(names).not.toContain('delegate_to_team')
    expect(agent.tools.find((t) => t.name === 'Bash')?.description).toContain(
      'interactive_shell + write_stdin',
    )
  })

  it('test_withholds_the_builtin_shell_and_refuses_foreign_hooks', async () => {
    const agent = await compile()

    expect(agent.withheldBuiltinTools).toEqual(['shell'])
    expect(agent.hookApproval).toBeDefined()
  })

  it('test_an_untrusted_directory_reads_only_the_operators_root', async () => {
    resolveTrustPosture.mockReturnValueOnce(posture(false))

    expect((await compile()).settingSources).toEqual(['user'])
  })

  it('test_hands_the_preset_the_posture_evidence_and_the_foreign_surfaces', async () => {
    await compile()
    const options = presetSpy.mock.calls.at(-1)?.[0]

    // The evidence `trustedBy` is built from: the level and source that authorized the root, and the
    // one capability the preset reads. A grant without `source` could not say where a refusal came from.
    expect(options.posture).toEqual({
      level: 'trusted',
      source: 'store',
      allows: { projectSettings: true },
    })
    expect(options.claudeCode).toEqual({
      import: ['skills', 'subagents', 'plugins', 'commands', 'context'],
    })
  })

  it('test_an_untrusted_posture_is_handed_over_denying_with_its_source', async () => {
    resolveTrustPosture.mockReturnValueOnce(posture(false))
    await compile()

    expect(presetSpy.mock.calls.at(-1)?.[0].posture).toEqual({
      level: 'untrusted',
      source: 'store',
      allows: { projectSettings: false },
    })
  })
})
