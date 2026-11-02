import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import WebSocket from 'ws'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentImport, TheoClawAgentOptions } from '../src/agent/create-agent.js'
import { createAgentFactory } from '../src/control-plane/agent-factory.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { importedMcpPaths, importedMcpSecrets } from '../src/migration/import-start.js'
import type { ImportedSetup } from '../src/migration/import-store.js'
import { FakeAgent } from './fakes.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { CONTROL_TOKEN, enforced, notEnforced, startForTools, stop, tempCwd } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

const ENV = { THEOCLAW_MODEL: 'openrouter/m', OPENROUTER_API_KEY: 'router-key' }
const VARIABLE = 'THEOCLAW_IMPORTED_MCP'

const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  for (const start of started.splice(0)) await stop(start)
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function setupWith(mcpServers: ImportedSetup['mcpServers']): ImportedSetup {
  return {
    kind: 'claude-code',
    instructions: 'Imported instruction: the project is called Lighthouse.',
    memory: '',
    mcpServers,
    skills: [],
    counts: { instructions: 1, memories: 0, skills: 0, mcpServers: Object.keys(mcpServers).length },
  }
}

async function start(...args: Parameters<typeof startForTools>): Promise<ToolStart> {
  const result = await startForTools(...args)
  started.push(result)
  return result
}

/** Send one `/control` chat frame and wait until `built` says the turn's agent exists. */
async function controlTurn(result: ToolStart, built: () => boolean): Promise<void> {
  const app = result.app
  if (app === undefined) throw new Error(`the start refused: ${result.error?.message ?? 'unknown'}`)
  const { host, port } = app.address()
  const socket = new WebSocket(`ws://${host}:${port}/control`, { headers: { Authorization: `Bearer ${CONTROL_TOKEN}` } })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve())
    socket.once('error', reject)
  })
  socket.send(JSON.stringify({ type: 'chat', message: 'hello' }))
  const deadline = Date.now() + 5_000
  while (!built()) {
    if (Date.now() > deadline) throw new Error('no /control agent was built within 5 s')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  socket.close()
}

/** F-dom-1 (review round 1): an imported stdio server is a host process, protected like the external tools file. */
describe('the processes an import starts, under host tools', () => {
  it('names every absolute stdio command and cwd of an import with THEOCLAW_IMPORTED_MCP=on', () => {
    const setup = setupWith({
      db: { command: '/opt/db/server', args: ['--port', '1'], cwd: '/srv/project' },
      search: { command: 'npx', args: ['search-server'] },
      remote: { type: 'http', url: 'https://mcp.example.com' },
    })
    expect(importedMcpPaths({ setup, mcp: true })).toEqual([
      { path: '/opt/db/server', variable: VARIABLE },
      { path: '/srv/project', variable: VARIABLE },
    ])
  })

  it('names nothing when THEOCLAW_IMPORTED_MCP is off or there is no import', () => {
    const setup = setupWith({ db: { command: '/opt/db/server', cwd: '/srv/project' } })
    expect(importedMcpPaths({ setup, mcp: false })).toEqual([])
    expect(importedMcpPaths(undefined)).toEqual([])
  })

  it('resolves a relative stdio cwd against the process directory and a relative command against that cwd, as the SDK spawns them', () => {
    const setup = setupWith({ db: { command: 'bin/server', cwd: 'project' } })

    expect(importedMcpPaths({ setup, mcp: true }, '/srv')).toEqual([
      { path: '/srv/project/bin/server', variable: VARIABLE },
      { path: '/srv/project', variable: VARIABLE },
    ])
  })

  it.each([
    ['an absolute script', ['/opt/mcp/server.js'], '/opt/mcp/server.js'],
    ['a relative script with a slash', ['-u', 'tools/server.py'], '/srv/tools/server.py'],
    ['the path of a --flag=value', ['--root=/data/root'], '/data/root'],
  ])('names %s an interpreter is given in args', (_shape, args, path) => {
    const setup = setupWith({ db: { command: 'node', args } })

    expect(importedMcpPaths({ setup, mcp: true }, '/srv')).toEqual([{ path, variable: VARIABLE }])
  })

  it('names a bare script argument that is a file in the server cwd', () => {
    const cwd = tempCwd(cleanups)
    writeFileSync(join(cwd, 'server.js'), '')
    const setup = setupWith({ db: { command: 'node', args: ['server.js', '--port', '1'], cwd } })

    expect(importedMcpPaths({ setup, mcp: true })).toEqual([
      { path: cwd, variable: VARIABLE },
      { path: join(cwd, 'server.js'), variable: VARIABLE },
    ])
  })

  it('names no flag, url or bare word of args', () => {
    const setup = setupWith({ db: { command: 'npx', args: ['-y', '--port', '1', 'search-server', 'https://mcp.example.com/a'] } })

    expect(importedMcpPaths({ setup, mcp: true }, '/srv')).toEqual([])
  })

  it('refuses THEOCLAW_HOST_TOOLS=on when an imported interpreter runs a script inside the tool root (LCR0135)', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const script = join(workspace.path, 'files', 'server.js')
    const imported: AgentImport = { setup: setupWith({ db: { command: process.execPath, args: [script] } }), mcp: true }

    const result = await start({ THEOCLAW_HOST_TOOLS: 'on' }, workspace.path, { detect: enforced }, {
      importedPaths: importedMcpPaths(imported),
    })

    expect((result.error as TheoClawConfigError).variable).toBe(VARIABLE)
    expect(result.error?.message).toContain(`refuses ${VARIABLE} ${script}`)
    expect(result.builds()).toBe(0)
  })

  it('starts with THEOCLAW_HOST_TOOLS=on when every process of an import lies outside the writable roots', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const imported: AgentImport = { setup: setupWith({ db: { command: '/opt/db/server', args: ['/opt/db/main.js'], cwd: '/opt/db' } }), mcp: true }

    const result = await start({ THEOCLAW_HOST_TOOLS: 'on' }, workspace.path, { detect: enforced }, {
      importedPaths: importedMcpPaths(imported),
    })

    expect(result.error).toBeUndefined()
    expect(result.builds()).toBeGreaterThan(0)
  })

  it('refuses THEOCLAW_HOST_TOOLS=on when an imported stdio command lies inside the tool root', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const command = join(workspace.path, 'files', 'server.js')
    const imported: AgentImport = { setup: setupWith({ db: { command } }), mcp: true }

    const result = await start({ THEOCLAW_HOST_TOOLS: 'on' }, workspace.path, { detect: enforced }, {
      importedPaths: importedMcpPaths(imported),
    })

    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect((result.error as TheoClawConfigError).variable).toBe(VARIABLE)
    expect(result.error?.message).toContain(`refuses ${VARIABLE} ${command}`)
    expect(result.builds()).toBe(0)
  })
})

/** F-wire-1 (review round 1): `run_code` and `delegate_all` workers stay read-only, with nothing from an import. */
describe('the workers of a /control agent that carries an import', () => {
  it('builds each delegate_all worker from the import-free factory, without the prompt or the servers', async () => {
    const built: TheoClawAgentOptions[] = []
    const create = async (options: TheoClawAgentOptions) => {
      built.push(options)
      return new FakeAgent({ frames: [] })
    }
    const imported: AgentImport = { setup: setupWith({ db: { command: '/opt/db/server' } }), mcp: true }
    const result = await start(ENV, tempCwd(cleanups), { detect: notEnforced }, {
      agentFactory: createAgentFactory(ENV, create, imported),
      importFreeAgentFactory: createAgentFactory(ENV, create),
    })

    await controlTurn(result, () => built.length > 0)
    const control = built[0]!
    expect(control.systemPrompt).toContain('Lighthouse')
    expect(Object.keys(control.mcpServers ?? {})).toEqual(['db'])
    const delegate = control.tools?.find((tool) => tool.name === 'delegate_all')
    await delegate?.handler({ tasks: [{ agent: 'worker', task: 'one' }] })

    expect(built).toHaveLength(2)
    const worker = built[1]!
    expect(worker).not.toHaveProperty('systemPrompt')
    expect(worker).not.toHaveProperty('skills')
    expect(worker).not.toHaveProperty('mcpServers')
    expect(worker.tools?.map((tool) => tool.name)).not.toContain('delegate_all')
  })
})

/** CWE-532 (review round 2): an import's env and header values are secrets, as THEOCLAW_EXTERNAL_TOOLS' are. */
describe('the values an import carries, in the process output', () => {
  const ENV_VALUE = 'sk-import-env-sentinel-0123'
  const HEADER_VALUE = 'Bearer import-header-sentinel-4567'
  const imported: AgentImport = {
    setup: setupWith({
      db: { command: '/opt/db/server', env: { DB_TOKEN: ENV_VALUE, SHORT: 'abc' } },
      remote: { type: 'http', url: 'https://mcp.example.com', headers: { Authorization: HEADER_VALUE } },
    }),
    mcp: true,
  }

  it('names every env and header value of at least 8 characters, and nothing without an import', () => {
    expect(importedMcpSecrets(imported)).toEqual([ENV_VALUE, HEADER_VALUE])
    expect(importedMcpSecrets(undefined)).toEqual([])
  })

  it('masks an imported env or header value written to the process output', async () => {
    const result = await start(ENV, tempCwd(cleanups), { detect: notEnforced }, { importedSecrets: importedMcpSecrets(imported) })

    result.writeThrough(`server said ${ENV_VALUE} and ${HEADER_VALUE}\n`)

    expect(result.output()).toContain('server said [redacted] and [redacted]\n')
    expect(result.output()).not.toContain('sentinel')
  })
})
