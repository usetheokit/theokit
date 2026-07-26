import { describe, expect, it } from 'vitest'

import { AgentBuilder } from '../../src/bridge/agent-builder.js'
import { compileAgentDefinition } from '../../src/bridge/define-agent.js'
import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'
import type { McpServersMap } from '../../src/types.js'

/**
 * #11 — the `.mcp({...})` builder value (builder-chain equivalent of the `@MCP` decorator) flows
 * through `AgentBuilder.create()…build()` → `compileAgentDefinition` → `assembleM8CreateOptions` → the SDK's
 * `Agent.create({ mcpServers })`. Mirrors agent-builder-setting-sources.test.ts.
 */
const SERVERS: McpServersMap = {
  filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/w'] },
}

describe('AgentBuilder.create().mcp()', () => {
  it('builder carries mcpServers onto the built definition', () => {
    const def = AgentBuilder.create().model('m').mcp(SERVERS).build()
    expect((def as { mcpServers?: McpServersMap }).mcpServers).toEqual(SERVERS)
  })

  it('unset ⇒ no mcpServers on the built definition', () => {
    const def = AgentBuilder.create().model('m').build()
    expect((def as { mcpServers?: McpServersMap }).mcpServers).toBeUndefined()
  })
})

describe('compile + SDK projection carries mcpServers', () => {
  it('compileAgentDefinition carries mcpServers', () => {
    const compiled = compileAgentDefinition(AgentBuilder.create().model('m').mcp(SERVERS).build())
    expect(compiled.mcpServers).toEqual(SERVERS)
  })

  it('unset ⇒ compiled.mcpServers absent', () => {
    const compiled = compileAgentDefinition(AgentBuilder.create().model('m').build())
    expect(compiled.mcpServers).toBeUndefined()
  })

  it('assembleM8CreateOptions forwards mcpServers to Agent.create options', () => {
    const compiled = compileAgentDefinition(AgentBuilder.create().model('m').mcp(SERVERS).build())
    const { options, applied } = assembleM8CreateOptions(compiled)
    expect(options.mcpServers).toEqual(SERVERS)
    expect(applied).toContain('mcpServers')
  })

  it('empty map ⇒ not forwarded to Agent.create options', () => {
    const compiled = compileAgentDefinition(AgentBuilder.create().model('m').mcp({}).build())
    const { options, applied } = assembleM8CreateOptions(compiled)
    expect(options.mcpServers).toBeUndefined()
    expect(applied).not.toContain('mcpServers')
  })
})
