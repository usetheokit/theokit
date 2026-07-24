import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { toolRuntimeName } from '../../src/bridge/agent-compiler.js'
import { applyCapabilities } from '../../src/capability/capability.js'
import { ConfigurationError } from '../../src/capability/capabilities.js'
import { ToolboxCapability, type ToolDeclaration } from '../../src/capability/toolbox.js'

/**
 * Regression for usetheodev/theokit#145 — a namespaced toolbox produced `ns.tool`, and the SDK
 * rejects the dot (`/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`). A DOCUMENTED path never worked against a real
 * provider, and nothing caught it because every other suite here **mocks** `@theokit/sdk`.
 *
 * This file deliberately does NOT mock the SDK. `Agent.create` validates tool names before it opens
 * any connection, so the real contract is exercised with a fake key and zero network.
 */
class OpsTools {
  static readonly tools: ToolDeclaration[] = [
    {
      name: 'deploy',
      description: 'Deploy the app',
      input: z.object({ env: z.string() }),
      method: 'deploy',
      hitl: { question: 'Confirm deploy?' },
    },
  ]
  async deploy(): Promise<string> {
    return 'ok'
  }
}

describe('tool name ↔ SDK contract (#145)', () => {
  it('a namespaced tool name is ACCEPTED by the real SDK validation', async () => {
    const { Agent } = await import('@theokit/sdk')
    const compiled = applyCapabilities([
      new ToolboxCapability(new OpsTools(), { namespace: 'ops' }),
    ])

    // The bug: this threw `tool_invalid_name` because the name was `ops.deploy`.
    await expect(
      Agent.create({
        apiKey: 'sk-fake-not-used-validation-runs-first',
        model: { id: 'openai/gpt-4o-mini' },
        tools: compiled.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          handler: t.handler,
        })),
        local: { cwd: process.cwd() },
      } as never),
    ).resolves.toBeDefined()
  })

  it('the generated name matches the SDK charset', () => {
    const SDK_TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/
    expect(toolRuntimeName('ops', 'deploy')).toMatch(SDK_TOOL_NAME)
    expect(toolRuntimeName('', 'deploy')).toMatch(SDK_TOOL_NAME)
  })

  it('the HITL gate map uses the SAME name as the compiled tool (they cannot disagree)', () => {
    const compiled = applyCapabilities([
      new ToolboxCapability(new OpsTools(), { namespace: 'ops' }),
    ])
    expect([...(compiled.hitl ?? new Map()).keys()]).toEqual(compiled.tools.map((t) => t.name))
  })

  it('a namespace that cannot produce a valid name fails at AUTHORING, not at runtime', () => {
    // Previously this produced a broken name that only exploded when the model called the tool.
    expect(() => new ToolboxCapability(new OpsTools(), { namespace: 'has space' })).toThrow(
      ConfigurationError,
    )
    expect(() => new ToolboxCapability(new OpsTools(), { namespace: '9leading-digit' })).toThrow(
      ConfigurationError,
    )
  })
})
