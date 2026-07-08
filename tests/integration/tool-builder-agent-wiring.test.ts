/**
 * M31 Phase 1 — WIRING: a `tool()`-built CustomTool flows through the REAL agent compile path.
 *
 * Proves the identity-shape thesis end-to-end inside theokit: `tool()…build()` → `agent().tool()`
 * → `.build()` → `compileAgentDefinition()` yields the tool in the compiled options exactly as a
 * legacy `defineAgentTool({...})` would. The SDK runtime consumes `CompiledAgentOptions` unchanged.
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { agent } from '../../packages/agents/src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../packages/agents/src/bridge/define-agent.js'
import { defineAgentTool } from '../../packages/theo/src/server/define/define-agent-tool.js'
import { tool } from '../../packages/theo/src/server/define/tool-builder.js'

describe('tool() → agent().tool() → compile (wiring)', () => {
  it('a tool()-built tool compiles into the agent exactly like defineAgentTool', () => {
    const schema = z.object({ path: z.string() })

    const builtTool = tool('read')
      .describe('Read a file')
      .input(schema)
      .execute(async ({ path }) => `read:${path}`)
      .build()
    const legacyTool = defineAgentTool({
      name: 'read',
      description: 'Read a file',
      inputSchema: schema,
      handler: async ({ path }) => `read:${path}`,
    })

    const builtAgent = agent().model('openrouter/openai/gpt-4o-mini').tool(builtTool).build()
    const legacyAgent = agent().model('openrouter/openai/gpt-4o-mini').tool(legacyTool).build()

    const builtCompiled = compileAgentDefinition(builtAgent)
    const legacyCompiled = compileAgentDefinition(legacyAgent)

    // The compiled tool surface is identical (name + JSON-schema input).
    expect(builtCompiled.tools).toHaveLength(1)
    expect(builtCompiled.tools[0].name).toBe('read')
    expect(builtCompiled.tools[0].name).toBe(legacyCompiled.tools[0].name)
    expect(builtCompiled.tools[0].inputSchema).toEqual(legacyCompiled.tools[0].inputSchema)
  })
})
