import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { afterEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { resolveExternalTools } from '../src/tools/external-tools.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { enforced, notEnforced, startForTools, stop, tempCwd } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

const VARIABLE = 'THEOCLAW_EXTERNAL_TOOLS'

const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  for (const start of started.splice(0)) await stop(start)
  for (const cleanup of cleanups.splice(0)) cleanup()
})

async function start(...args: Parameters<typeof startForTools>): Promise<ToolStart> {
  const result = await startForTools(...args)
  started.push(result)
  return result
}

/** Write `content` as the external tools file in a fresh directory and return its path. */
function toolsFile(content: unknown): string {
  const dir = tempCwd(cleanups)
  const path = join(dir, 'external-tools.json')
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
  return path
}

/** The refusal `resolveExternalTools` throws for `content`, or a failure when it accepts it. */
function refusalOf(content: unknown): TheoClawConfigError {
  const path = toolsFile(content)
  try {
    resolveExternalTools({ [VARIABLE]: path })
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    expect((error as TheoClawConfigError).variable).toBe(VARIABLE)
    expect((error as Error).message).toContain(path)
    return error as TheoClawConfigError
  }
  throw new Error(`the file was accepted: ${JSON.stringify(content)}`)
}

const STDIO = { command: '/usr/bin/env', args: ['node'] }
const AGENT = { name: 'coder', description: 'a coding agent', command: '/usr/bin/env' }

describe('the external tools file at start', () => {
  it('behaves as today when THEOCLAW_EXTERNAL_TOOLS is unset', () => {
    const cwd = tempCwd(cleanups)
    const without = resolveToolSettings({}, cwd, { detect: notEnforced, warn: () => undefined })
    expect(without.external.mcpServers).toEqual({})
    expect(without.external.acpAgents).toEqual([])
    expect(without.external.startLine).toBeUndefined()
    expect(without.secrets).toEqual([])
  })

  it('refuses a missing file before any runner starts', async () => {
    const path = join(tempCwd(cleanups), 'absent.json')
    const result = await start({ [VARIABLE]: path }, tempCwd(cleanups), { detect: notEnforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toContain(path)
    expect((result.error as TheoClawConfigError).variable).toBe(VARIABLE)
    expect(result.builds()).toBe(0)
  })

  it('refuses a file that is not JSON, naming the path', () => {
    expect(refusalOf('{').message).toContain('is not JSON')
  })

  it('refuses a file that is not JSON without quoting its text, which may hold a header value', () => {
    const error = refusalOf('{"mcpServers":{"a":{"url":"https://x.example","headers":{"Authorization":Bearer sk-leak-0123456789}}}}')
    expect(error.message).not.toContain('sk-leak')
  })

  it('refuses an HTTP server that carries auth, naming the server and the gap item', () => {
    const error = refusalOf({ mcpServers: { docs: { url: 'https://x.example/mcp', auth: { CLIENT_ID: 'c' } } } })
    expect(error.message).toContain('mcpServers.docs.auth')
    expect(error.message).toContain('B-680')
  })

  it('refuses envPolicy all', () => {
    const error = refusalOf({ mcpServers: { docs: { ...STDIO, envPolicy: 'all' } } })
    expect(error.message).toContain('mcpServers.docs.envPolicy')
  })

  it('refuses an ACP tool named read_file', () => {
    const error = refusalOf({ acpAgents: [{ ...AGENT, name: 'read_file' }] })
    expect(error.message).toContain('read_file')
  })

  it('refuses an ACP tool named mcp_x, the prefix the SDK gives MCP tools', () => {
    const error = refusalOf({ acpAgents: [{ ...AGENT, name: 'mcp_x' }] })
    expect(error.message).toContain('mcp_x')
  })

  it('refuses an ACP tool named memory_search, a name the SDK reserves', () => {
    expect(refusalOf({ acpAgents: [{ ...AGENT, name: 'memory_search' }] }).message).toContain('memory_search')
  })

  it('refuses an ACP tool named after a tool only the /control agent holds', () => {
    for (const name of ['run_code', 'delegate_all', 'digest']) {
      expect(refusalOf({ acpAgents: [{ ...AGENT, name }] }).message).toContain(`acpAgents: ${name}`)
    }
  })

  it('refuses a server named browser, the name of the THEOCLAW_BROWSER server', () => {
    expect(refusalOf({ mcpServers: { browser: STDIO } }).message).toContain('mcpServers.browser')
  })

  it('refuses two ACP tools with one name', () => {
    expect(refusalOf({ acpAgents: [AGENT, AGENT] }).message).toContain('coder')
  })

  it('refuses a non-positive timeoutMs', () => {
    const error = refusalOf({ acpAgents: [{ ...AGENT, timeoutMs: 0 }] })
    expect(error.message).toContain('acpAgents.0.timeoutMs')
  })

  it('refuses an ACP timeoutMs past the 32-bit timer limit, which Node would fire after 1 ms', () => {
    const error = refusalOf({ acpAgents: [{ ...AGENT, timeoutMs: 2_147_483_648 }] })
    expect(error.message).toContain('acpAgents.0.timeoutMs')
  })

  it('refuses a fractional ACP timeoutMs', () => {
    const error = refusalOf({ acpAgents: [{ ...AGENT, timeoutMs: 0.5 }] })
    expect(error.message).toContain('acpAgents.0.timeoutMs')
  })

  it('refuses an MCP requestTimeoutMs past the 32-bit timer limit', () => {
    const error = refusalOf({ mcpServers: { docs: { ...STDIO, requestTimeoutMs: 2_147_483_648 } } })
    expect(error.message).toContain('mcpServers.docs.requestTimeoutMs')
  })

  it('accepts a timeoutMs of exactly 2147483647, the largest delay a timer holds', () => {
    const external = resolveExternalTools({ [VARIABLE]: toolsFile({ acpAgents: [{ ...AGENT, timeoutMs: 2_147_483_647 }] }) })
    expect(external.acpAgents[0]?.timeoutMs).toBe(2_147_483_647)
  })

  it('refuses a relative MCP working directory, which would resolve against the start directory', () => {
    const error = refusalOf({ mcpServers: { docs: { ...STDIO, cwd: 'files' } } })
    expect(error.message).toContain('mcpServers.docs.cwd')
  })

  it('refuses an MCP server URL that is not http or https', () => {
    const error = refusalOf({ mcpServers: { docs: { url: 'file:///etc/passwd' } } })
    expect(error.message).toContain('mcpServers.docs.url')
  })

  it('refuses a relative ACP command', () => {
    const error = refusalOf({ acpAgents: [{ ...AGENT, command: './agent.sh' }] })
    expect(error.message).toContain('acpAgents.0.command')
  })

  it('refuses a relative MCP command', () => {
    const error = refusalOf({ mcpServers: { files: { command: 'bin/server' } } })
    expect(error.message).toContain('mcpServers.files.command')
  })

  it('refuses a server name sanitize would change', () => {
    expect(refusalOf({ mcpServers: { 'docs.v1': STDIO } }).message).toContain('docs.v1')
  })

  it('refuses a server name ending in a hyphen', () => {
    expect(refusalOf({ mcpServers: { 'docs-': STDIO } }).message).toContain('docs-')
  })

  it('refuses an unknown key, naming it', () => {
    expect(refusalOf({ mcpServer: {} }).message).toContain('mcpServer')
  })

  it('refuses an external tools file inside the tool root when host tools are on', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    mkdirSync(join(workspace.path, 'files'), { mode: 0o700 })
    const path = join(workspace.path, 'files', 'external-tools.json')
    writeFileSync(path, JSON.stringify({ mcpServers: { docs: STDIO } }))
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', [VARIABLE]: path }, workspace.path, { detect: enforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect((result.error as TheoClawConfigError).variable).toBe(VARIABLE)
    expect(result.error?.message).toContain(path)
    expect(result.builds()).toBe(0)
  })

  it('refuses ACP agents when host tools are on, since the shell can write the directory they run in', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const path = toolsFile({ acpAgents: [AGENT] })
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', [VARIABLE]: path }, workspace.path, { detect: enforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect((result.error as TheoClawConfigError).variable).toBe(VARIABLE)
    expect(result.error?.message).toContain('ACP agents')
    expect(result.builds()).toBe(0)
  })

  it('refuses an MCP command inside the tool root when host tools are on', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const command = join(workspace.path, 'files', 'server')
    // Beside the workspace, not under /tmp, so only the command can be what is refused.
    const path = join(workspace.path, 'external-tools.json')
    writeFileSync(path, JSON.stringify({ mcpServers: { files: { command } } }))
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', [VARIABLE]: path }, workspace.path, { detect: enforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect((result.error as TheoClawConfigError).variable).toBe(VARIABLE)
    expect(result.error?.message).toContain(command)
    expect(result.builds()).toBe(0)
  })

  it('refuses an MCP working directory inside the tool root when host tools are on', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const cwd = join(workspace.path, 'files')
    const path = join(workspace.path, 'external-tools.json')
    writeFileSync(path, JSON.stringify({ mcpServers: { files: { command: '/usr/bin/env', cwd } } }))
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', [VARIABLE]: path }, workspace.path, { detect: enforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect((result.error as TheoClawConfigError).variable).toBe(VARIABLE)
    expect(result.error?.message).toContain(cwd)
    expect(result.builds()).toBe(0)
  })

  it('an empty file behaves as unset and prints no start line', async () => {
    const path = toolsFile({})
    const external = resolveExternalTools({ [VARIABLE]: path })
    expect(external).toEqual({ mcpServers: {}, acpAgents: [], secrets: [], startLine: undefined })
    const result = await start({ [VARIABLE]: path }, tempCwd(cleanups), { detect: notEnforced })
    expect(result.error).toBeUndefined()
    expect(result.output()).not.toContain('tools: external')
  })

  it('prints one line naming the servers and agents, and no header value', async () => {
    const header = 'Bearer start-line-secret-0123'
    const path = toolsFile({
      mcpServers: { docs: { url: 'https://x.example/mcp', headers: { Authorization: header } }, files: STDIO },
      acpAgents: [AGENT],
    })
    const result = await start({ [VARIABLE]: path }, tempCwd(cleanups), { detect: notEnforced })
    expect(result.error).toBeUndefined()
    const lines = result.output().split('\n').filter((line) => line.startsWith('tools: external:'))
    expect(lines).toEqual(['tools: external: 2 MCP servers (docs, files), 1 ACP agent (coder)'])
    expect(result.output()).not.toContain(header)
  })

  it('masks every header and env value', async () => {
    const header = 'Bearer header-secret-0123456789'
    const envValue = 'env-secret-abcdefghij'
    const path = toolsFile({
      mcpServers: {
        remote: { url: 'https://x.example/mcp', headers: { Authorization: header } },
        local: { ...STDIO, env: { TOKEN: envValue } },
      },
    })
    const result = await start({ [VARIABLE]: path }, tempCwd(cleanups), { detect: notEnforced })
    expect(result.error).toBeUndefined()
    result.writeThrough(`leak ${header} and ${envValue}\n`)
    expect(result.output()).toContain('leak')
    expect(result.output()).not.toContain(header)
    expect(result.output()).not.toContain(envValue)
  })

  it('leaves a value under 8 characters out of the mask, so it cannot blank unrelated output', () => {
    const path = toolsFile({ mcpServers: { local: { ...STDIO, env: { DEBUG: '1', TOKEN: 'long-enough-secret' } } } })
    expect(resolveExternalTools({ [VARIABLE]: path }).secrets).toEqual(['long-enough-secret'])
  })

  it('validates 10 servers and 10 agents in under 50 ms at p95 over 100 runs', () => {
    const mcpServers = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`server-${String(i)}`, STDIO]))
    const acpAgents = Array.from({ length: 10 }, (_, i) => ({ ...AGENT, name: `agent_${String(i)}` }))
    const text = JSON.stringify({ mcpServers, acpAgents })
    const durations: number[] = []
    for (let run = 0; run < 100; run += 1) {
      const begin = performance.now()
      resolveExternalTools({ [VARIABLE]: '/configured.json' }, () => text)
      durations.push(performance.now() - begin)
    }
    durations.sort((a, b) => a - b)
    expect(durations[94]).toBeLessThan(50)
  })
})
