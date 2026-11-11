import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { cleanScratch, harness, scratchDir } from './support/cli-harness.js'

afterEach(cleanScratch)

function workspaceWithSession(): string {
  const workspace = scratchDir()
  const dir = join(workspace, '.theoclaw', 'projects', workspace.replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const id = 'web-last'
  const lines = [
    { type: 'user', sessionId: id, message: { content: [{ type: 'text', text: 'hello there' }] } },
    { type: 'assistant', sessionId: id, message: { content: [{ type: 'text', text: 'hi owner' }] } },
  ]
  writeFileSync(join(dir, 'abc.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return workspace
}

describe('theoclaw attach and resume', () => {
  it('prints a session-bound MCP config whose server answers tools/list, then refuses once expired', async () => {
    const workspace = workspaceWithSession()
    const h = harness()
    const env = { ...h.io.env, THEOCLAW_WORKSPACE: workspace }
    expect(await runCli(['attach', '--print-config'], { ...h.io, env })).toBe(0)
    const grant = JSON.parse(h.stdout()) as { sessionKey: string; configPath: string }
    expect(grant.sessionKey).toBe('web-last')
    const config = JSON.parse(readFileSync(grant.configPath, 'utf8')) as { mcpServers: { theoclaw: { env: Record<string, string> } } }
    const serverEnv = config.mcpServers.theoclaw.env
    expect(serverEnv.THEOCLAW_ATTACH_SESSION).toBe('web-last')

    const live = harness()
    ;(live.io.stdin as PassThrough).end(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`)
    expect(await runCli(['mcp'], { ...live.io, env: { ...live.io.env, ...serverEnv } })).toBe(0)
    expect(JSON.parse(live.stdout().trim()).result.tools.length).toBeGreaterThan(0)

    const expired = harness()
    const past = { ...expired.io.env, THEOCLAW_ATTACH_EXPIRES_AT: new Date(Date.now() - 1000).toISOString() }
    await expect(runCli(['mcp'], { ...expired.io, env: past })).rejects.toThrow(/expired/)
    expect(existsSync(grant.configPath)).toBe(true)
  })

  it('resume shows the last session messages', async () => {
    const h = harness()
    expect(await runCli(['resume'], { ...h.io, env: { ...h.io.env, THEOCLAW_WORKSPACE: workspaceWithSession() } })).toBe(0)
    expect(h.stdout()).toBe('session: web-last\nuser: hello there\nassistant: hi owner\n')
  })
})
