import { describe, expect, it } from 'vitest'

import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'
import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'

/**
 * #89 regression — `@MCP` was inert: `compiled.mcpServers` was set by the compiler but never
 * forwarded to `Agent.create`, so declared MCP servers never executed. This asserts the adapter's
 * M8 projection now carries `mcpServers` (the object handed to `Agent.getOrCreate`).
 */

function baseCompiled(over: Partial<CompiledAgentOptions> = {}): CompiledAgentOptions {
  return { tools: [], agents: {}, stream: false, ...over } as CompiledAgentOptions
}

describe('#89 — mcpServers reach Agent.create', () => {
  it('forwards compiled.mcpServers into the M8 create options', () => {
    const mcpServers = {
      github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    }
    const { options, applied } = assembleM8CreateOptions(baseCompiled({ mcpServers }))
    expect(options.mcpServers).toEqual(mcpServers)
    expect(applied).toContain('mcpServers')
  })

  it('omits mcpServers when the agent declares none (backward-compatible)', () => {
    const { options, applied } = assembleM8CreateOptions(baseCompiled())
    expect(options.mcpServers).toBeUndefined()
    expect(applied).not.toContain('mcpServers')
  })

  it('omits mcpServers for an empty map (no dead key)', () => {
    const { options } = assembleM8CreateOptions(baseCompiled({ mcpServers: {} }))
    expect(options.mcpServers).toBeUndefined()
  })
})
