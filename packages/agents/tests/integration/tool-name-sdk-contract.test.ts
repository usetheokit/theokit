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

  it('the generated name is the composed one, and minting a valid pair never throws', () => {
    // This used to re-declare the charset regex here — a THIRD copy of the rule, which is the very
    // duplication M55 removes. The mint point validates now, so the behavioural assertion (it
    // returns the composed name and does not throw) is the honest one; the charset itself is
    // asserted where it lives, through the negative cases below and the real `Agent.create`.
    expect(toolRuntimeName('ops', 'deploy')).toBe('ops_deploy')
    expect(toolRuntimeName('', 'deploy')).toBe('deploy')
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

/**
 * M55 — the mint point validates. Every case below asserts the typed error AND the message
 * (`rules/testing.md` § 4.1: a negative test that only asserts "it throws" passes even when the
 * message blames the wrong field).
 *
 * The rule set mirrors `@theokit/sdk@4.1.0 › validateToolName`, which imposes THREE rules — not
 * one. The previous fix for #145 replicated only the charset, so `namespace: 'mcp'` still produced
 * an agent that `Agent.create` rejects. That defect is what `reserved` covers here.
 */
describe('tool name minting validates at the mint point (M55)', () => {
  describe('rules mirrored from the SDK', () => {
    it('rejects an empty composed name', () => {
      expect(() => toolRuntimeName('', '')).toThrow(ConfigurationError)
      expect(() => toolRuntimeName('', '')).toThrow(/vazio/)
    })

    it('rejects a name outside the charset, naming the OFFENDING composed name', () => {
      expect(() => toolRuntimeName('has space', 'deploy')).toThrow(ConfigurationError)
      // The message must show what was actually minted — not the parts, which look fine alone.
      expect(() => toolRuntimeName('has space', 'deploy')).toThrow(/has space_deploy/)
    })

    it('rejects a reserved name', () => {
      for (const reserved of ['shell', 'memory_search', 'memory_get']) {
        expect(() => toolRuntimeName('', reserved)).toThrow(ConfigurationError)
        expect(() => toolRuntimeName('', reserved)).toThrow(/reservad/)
      }
    })

    it('rejects the `mcp_` prefix — the defect the #145 fix left behind', () => {
      expect(() => toolRuntimeName('mcp', 'deploy')).toThrow(ConfigurationError)
      expect(() => toolRuntimeName('mcp', 'deploy')).toThrow(/mcp_/)
    })

    it('rejects a bare tool already carrying the reserved prefix (the rule is on the FINAL name)', () => {
      expect(() => toolRuntimeName('', 'mcp_foo')).toThrow(ConfigurationError)
    })
  })

  describe('boundaries — being STRICTER than the SDK is as wrong as being looser', () => {
    it('ACCEPTS `x_shell`: the SDK reserves exact matches, not substrings', () => {
      expect(toolRuntimeName('x', 'shell')).toBe('x_shell')
    })

    it('ACCEPTS `mcpx_deploy`: the prefix rule is `mcp_`, not `mcp`', () => {
      expect(toolRuntimeName('mcpx', 'deploy')).toBe('mcpx_deploy')
    })

    it('ACCEPTS a name of exactly 64 characters (the largest valid)', () => {
      expect(toolRuntimeName('', 'a'.repeat(64))).toHaveLength(64)
    })
  })

  describe('rules of OUR authoring layer (stricter than the SDK, deliberately)', () => {
    it('rejects an empty tool name even when a namespace makes it look valid', () => {
      // `ops` + `''` mints "ops_", which passes the charset and the SDK ACCEPTS it — a nonsense
      // tool reaches the LLM. The SDK cannot know a part was empty; we can.
      expect(() => toolRuntimeName('ops', '')).toThrow(ConfigurationError)
      expect(() => toolRuntimeName('ops', '')).toThrow(/vazio/)
    })

    it('says the COMPOSITION overflowed when length is the only rule broken', () => {
      const namespace = 'a'.repeat(60) // valid alone
      expect(() => toolRuntimeName(namespace, 'deploy')).toThrow(ConfigurationError)
      // A generic charset message would send the author hunting for an invalid character that
      // does not exist. The message must name the length.
      expect(() => toolRuntimeName(namespace, 'deploy')).toThrow(/67|comprimento|64/)
    })
  })

  describe('the mirror is real, not invented', () => {
    it('the SDK rejects every name we reject', async () => {
      const { Agent } = await import('@theokit/sdk')
      const invalid = [
        'has space_deploy',
        'shell',
        'mcp_deploy',
        'memory_get',
        `${'a'.repeat(60)}_deploy`,
      ]

      for (const name of invalid) {
        await expect(
          Agent.create({
            apiKey: 'sk-fake-not-used-validation-runs-first',
            model: { id: 'openai/gpt-4o-mini' },
            tools: [{ name, description: 'x', inputSchema: z.object({}), handler: () => 'ok' }],
            local: { cwd: process.cwd() },
          } as never),
        ).rejects.toThrow()
      }
    })

    it('the SDK accepts every boundary name we accept', async () => {
      const { Agent } = await import('@theokit/sdk')
      for (const name of ['x_shell', 'mcpx_deploy', 'ops_deploy']) {
        await expect(
          Agent.create({
            apiKey: 'sk-fake-not-used-validation-runs-first',
            model: { id: 'openai/gpt-4o-mini' },
            tools: [{ name, description: 'x', inputSchema: z.object({}), handler: () => 'ok' }],
            local: { cwd: process.cwd() },
          } as never),
        ).resolves.toBeDefined()
      }
    })
  })

  describe('no partial mutation when a toolbox carries one invalid tool', () => {
    class MixedTools {
      static readonly tools: ToolDeclaration[] = [
        { name: 'ok', description: 'fine', input: z.object({}), method: 'ok' },
        { name: 'bad name', description: 'broken', input: z.object({}), method: 'bad' },
      ]
      ok(): string {
        return 'ok'
      }
      bad(): string {
        return 'bad'
      }
    }

    it('fails in the CONSTRUCTOR, so no draft is ever half-populated', () => {
      expect(() => new ToolboxCapability(new MixedTools(), { namespace: 'ops' })).toThrow(
        ConfigurationError,
      )
      // The capability never exists, so `apply` can never have pushed the first (valid) tool.
      expect(() => new ToolboxCapability(new MixedTools(), { namespace: 'ops' })).toThrow(
        /bad name/,
      )
    })
  })
})
