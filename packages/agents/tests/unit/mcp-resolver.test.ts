import { describe, expect, it } from 'vitest'

import { resolveMcpServers, mcpRegistry, mcpToolApprovals } from '../../src/bridge/mcp-resolver.js'
import type { McpServerConfig, McpStdioServerConfig } from '../../src/types.js'

/**
 * M24 (ADR-0041) — MCP follow-ups, framework-side layer over the `@MCP` config:
 *  - per-request resolver (multi-tenant creds), mirroring the M13 skills resolver;
 *  - a registry helper (Composio / mcp.run) that builds a server config;
 *  - `requireToolApproval` → M14 HITL approval entries for gated MCP tools.
 */

/**
 * Narrow an entry to the STDIO variant of `McpServerConfig`.
 *
 * `McpServerConfig` became a union (stdio | http) when M112 stopped narrowing what the SDK accepts,
 * and `command`/`args`/`env` live only on the stdio arm. These assertions read them directly, so
 * from that point on `tsc --noEmit -p tsconfig.test.json` reported 8 errors here — a gate CLAUDE.md
 * lists as mandatory-at-zero, red on a clean tree and therefore protecting nothing.
 *
 * A cast would have silenced it. This throws instead: every case below is ABOUT a stdio server, so
 * an entry that turned out to be remote is a real failure of the thing under test, not a typing
 * inconvenience to paper over.
 */
function stdio(entry: McpServerConfig | undefined, name: string): McpStdioServerConfig {
  if (entry === undefined) throw new Error(`no MCP entry named "${name}"`)
  if (!('command' in entry)) {
    throw new Error(`MCP entry "${name}" is a remote server; this assertion is about a stdio one`)
  }
  return entry
}

describe('M24 — resolveMcpServers (per-request resolver)', () => {
  it('returns a static map unchanged', async () => {
    const map = { github: { command: 'npx', args: ['-y', 'server-github'] } }
    expect(await resolveMcpServers(map, {})).toEqual(map)
  })

  it('resolves a function per request — two callers get different configs (multi-tenant)', async () => {
    const selection = (ctx: Record<string, unknown>) => ({
      github: { command: 'npx', args: ['-y', 'server-github'], env: { TOKEN: String(ctx.token) } },
    })
    const a = await resolveMcpServers(selection, { token: 'aaa' })
    const b = await resolveMcpServers(selection, { token: 'bbb' })
    expect(stdio(a?.github, 'github').env?.TOKEN).toBe('aaa')
    expect(stdio(b?.github, 'github').env?.TOKEN).toBe('bbb')
  })

  it('returns undefined when no selection is given', async () => {
    expect(await resolveMcpServers(undefined, {})).toBeUndefined()
  })

  it('fails fast when a resolver returns a non-object', async () => {
    await expect(resolveMcpServers((() => null) as never, {})).rejects.toThrow(/resolver/i)
  })
})

describe('M24 — mcpRegistry (known registry helper)', () => {
  it('builds a Composio MCP server config from an app list + api key', () => {
    const servers = mcpRegistry({
      registry: 'composio',
      apiKey: 'ck_123',
      apps: ['github', 'slack'],
    })
    const composio = stdio(servers.composio, 'composio')
    expect(composio.command).toBe('npx')
    expect(composio.args).toEqual(expect.arrayContaining(['@composio/mcp']))
    expect(composio.env?.COMPOSIO_API_KEY).toBe('ck_123')
    // The requested apps are encoded in the args.
    expect(composio.args?.join(' ')).toContain('github')
    expect(composio.args?.join(' ')).toContain('slack')
  })

  it('builds an mcp.run config', () => {
    const servers = mcpRegistry({ registry: 'mcp.run', apiKey: 'mk_9', profile: 'default' })
    expect(stdio(servers['mcp.run'], 'mcp.run').env?.MCP_RUN_API_KEY).toBe('mk_9')
  })

  it('fails fast on an unknown registry', () => {
    expect(() => mcpRegistry({ registry: 'nope' as never, apiKey: 'x' })).toThrow(/registry/i)
  })
})

describe('M24 — mcpToolApprovals (requireToolApproval → M14 HITL)', () => {
  it('produces approval entries the M14 `approvals` config accepts', () => {
    const approvals = mcpToolApprovals({
      github_create_issue: { question: 'Create a GitHub issue?' },
      github_delete_repo: { question: 'DELETE a repository?', timeout: 60_000 },
    })
    expect(approvals.github_create_issue.question).toBe('Create a GitHub issue?')
    expect(approvals.github_delete_repo.timeout).toBe(60_000)
    // Shape is the HumanInTheLoopOptions the M14 approvals map consumes → composes directly.
    expect(Object.keys(approvals)).toEqual(['github_create_issue', 'github_delete_repo'])
  })

  it('accepts a bare string question shorthand', () => {
    const approvals = mcpToolApprovals({ dangerous_tool: 'Are you sure?' })
    expect(approvals.dangerous_tool.question).toBe('Are you sure?')
  })
})
