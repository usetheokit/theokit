/**
 * M16 (theokit-ai-first) — MCP server manifest generation.
 *
 * ADR-0040 § D2: exposing a TheoKit agent's tools to external MCP clients over the app's HTTP
 * routes is a HOME concern (the app advertising itself). `buildMcpToolDescriptors` is a pure data
 * transform from the framework's `AgentManifestEntry` tools to MCP `tools/list` descriptors.
 * No LLM, no runtime, no stdio transport (that stays SDK-side).
 *
 * TDD RED-first.
 */
import { describe, expect, it } from 'vitest'

import type { AgentManifestEntry } from '../../src/manifest/agent-manifest.js'
import { buildMcpToolDescriptors, mcpServerInfo } from '../../src/a2a/mcp-server-manifest.js'

const entry: AgentManifestEntry = {
  name: 'ops-agent',
  route: '/api/agents/ops-agent',
  stream: true,
  mainLoop: { method: 'run', strategy: 'simple-chat' },
  guards: [],
  interceptors: [],
  tools: [
    { name: 'deploy', description: 'Deploy the app', approval: true, trace: true, audit: true },
    { name: 'status', description: 'Report status', approval: false, trace: true, audit: false },
  ],
  subAgents: [],
}

describe('buildMcpToolDescriptors', () => {
  it('maps each agent tool to an MCP tool descriptor (name, description, inputSchema)', () => {
    const tools = buildMcpToolDescriptors(entry)
    expect(tools).toHaveLength(2)
    expect(tools[0]).toMatchObject({
      name: 'deploy',
      description: 'Deploy the app',
      inputSchema: { type: 'object' },
    })
    expect(tools.map((t) => t.name)).toEqual(['deploy', 'status'])
  })

  it('produces an inputSchema that is a valid empty-object JSON schema by default', () => {
    const [tool] = buildMcpToolDescriptors(entry)
    expect(tool.inputSchema.type).toBe('object')
    expect(tool.inputSchema.properties).toEqual({})
  })

  it('mcpServerInfo advertises the agent name + protocol version', () => {
    const info = mcpServerInfo(entry)
    expect(info.name).toBe('ops-agent')
    expect(info.version).toBe('1.0')
    expect(typeof info.protocolVersion).toBe('string')
  })

  it('returns an empty list for an agent with no tools', () => {
    expect(buildMcpToolDescriptors({ ...entry, tools: [] })).toEqual([])
  })
})
