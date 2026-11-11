import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { mintAttachGrant, writeAttachConfig } from '../src/mcp/attach.js'
import { serveMcpStdio } from '../src/mcp/serve-tools.js'
import { harness, scratchDir } from './support/cli-harness.js'
import { PassThrough } from 'node:stream'

describe('theoclaw attach', () => {
  it('--print-config prints a session-scoped, expiring config', async () => {
    const h = harness()
    expect(await runCli(['attach', '--print-config', '--session', 'work'], h.io)).toBe(0)
    const config = JSON.parse(h.stdout()) as {
      mcpServers: Record<string, { args: string[]; env: Record<string, string> }>
    }
    const server = config.mcpServers.theoclaw!
    expect(server.args.at(-1)).toBe('mcp')
    expect(server.env.THEOCLAW_SESSION).toBe('work')
    expect(Date.parse(server.env.THEOCLAW_MCP_EXPIRES_AT!)).toBeGreaterThan(Date.now())
  })

  it('rejects a bad session id', async () => {
    const h = harness()
    expect(await runCli(['attach', '--print-config', '--session', 'a b'], h.io)).toBe(2)
  })

  it('the server of the config answers tools/list, and refuses once expired', async () => {
    const grant = mintAttachGrant({ command: 'node', args: [] }, 'owner')
    const env: NodeJS.ProcessEnv = {
      ...grant.config.mcpServers.theoclaw!.env,
    }
    const h = harness()
    const stdin = h.io.stdin as PassThrough
    stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`,
    )
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
    stdin.end()
    expect(await runCli(['mcp'], { ...h.io, env: { ...h.io.env, ...env } })).toBe(0)
    const out = h.stdout()
    expect(JSON.parse(out.trim().split('\n')[1]!).result.tools.length).toBeGreaterThan(0)

    const expired = { ...env, THEOCLAW_MCP_EXPIRES_AT: new Date(Date.now() - 1000).toISOString() }
    const dir = scratchDir()
    await expect(
      serveMcpStdio({
        env: expired,
        homeDir: dir,
        cwd: dir,
        stdin: new PassThrough(),
        stdout: new PassThrough(),
      }),
    ).rejects.toThrow(/expired/)
  })

  it('writes the config to a temporary file and removes it', () => {
    const file = writeAttachConfig(mintAttachGrant({ command: 'node', args: [] }, 'owner'))
    expect(JSON.parse(readFileSync(file.path, 'utf8')).mcpServers.theoclaw).toBeDefined()
    file.remove()
    expect(existsSync(file.path)).toBe(false)
  })
})
