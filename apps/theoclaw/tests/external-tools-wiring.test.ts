import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AcpToolConfig } from 'theokit/server/agent'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import type { TheoClawAgentOptions } from '../src/agent/create-agent.js'
import { createAgentFactory, createChannelAgentFactory } from '../src/control-plane/agent-factory.js'
import type { TurnAgent } from '../src/control-plane/turn.js'
import { agentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'
import { notEnforced, runControlTurn, startForTools, stop, tempCwd } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

// Every config `createACPTool` is called with, read through the published entry point itself.
const acpConfigs = vi.hoisted(() => [] as AcpToolConfig[])
vi.mock('theokit/server/agent', async (importOriginal) => {
  const original = await importOriginal<typeof import('theokit/server/agent')>()
  return {
    ...original,
    createACPTool: (config: AcpToolConfig) => {
      acpConfigs.push(config)
      return original.createACPTool(config)
    },
  }
})

const VARIABLE = 'THEOCLAW_EXTERNAL_TOOLS'
const MODEL_ENV = { THEOCLAW_MODEL: 'openrouter/m', OPENROUTER_API_KEY: 'router-key-0123456789' }
const SERVERS = {
  docs: { url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer docs-token-0123' } },
  files: { command: '/usr/bin/env', args: ['node', 'server.mjs'], env: { ROOT: '/srv/files' } },
}
const AGENTS = [
  { name: 'coder', description: 'a coding agent', command: '/usr/bin/env', args: ['coder'] },
  { name: 'reviewer', description: 'a reviewing agent', command: 'reviewer', timeoutMs: 1000 },
]

const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  acpConfigs.splice(0)
  for (const start of started.splice(0)) await stop(start)
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function settingsWith(content: unknown): ToolSettings {
  const cwd = tempCwd(cleanups)
  const path = join(cwd, 'external-tools.json')
  writeFileSync(path, JSON.stringify(content))
  return resolveToolSettings({ [VARIABLE]: path }, cwd, { detect: notEnforced, warn: () => undefined })
}

function recordingCreate(): { create: (options: TheoClawAgentOptions) => Promise<TurnAgent>; options: TheoClawAgentOptions[] } {
  const options: TheoClawAgentOptions[] = []
  return {
    options,
    create: async (passed) => {
      options.push(passed)
      return { send: () => Promise.reject(new Error('not used')) }
    },
  }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : entry.name.endsWith('.ts') ? [join(dir, entry.name)] : [],
  )
}

describe('the external tools reach the /control agent only', () => {
  it('the control agent gets the mcpServers map unchanged', async () => {
    const settings = settingsWith({ mcpServers: SERVERS })
    const { create, options } = recordingCreate()
    await createAgentFactory(MODEL_ENV, create)(agentToolOptions(settings))
    expect(options[0]?.mcpServers).toEqual(SERVERS)
    expect(options[0]?.mcpServers).not.toBe(settings.external.mcpServers)
  })

  it('the control agent gets one ACP tool per configured agent, with its cwd in the tool root', () => {
    const settings = settingsWith({ acpAgents: AGENTS })
    const built = agentToolOptions(settings)
    const names = built.tools.map((tool) => tool.name)
    expect(names).toContain('coder')
    expect(names).toContain('reviewer')
    expect(acpConfigs.map((config) => [config.name, config.cwd, config.command])).toEqual([
      ['coder', settings.toolRoot, '/usr/bin/env'],
      ['reviewer', settings.toolRoot, 'reviewer'],
    ])
    expect(acpConfigs[1]?.timeoutMs).toBe(1000)
  })

  it('a start without THEOCLAW_EXTERNAL_TOOLS passes no mcpServers key to Agent.create', async () => {
    const result = await startForTools({}, tempCwd(cleanups), { detect: notEnforced })
    started.push(result)
    const toolOptions = await runControlTurn(result)
    expect('mcpServers' in toolOptions).toBe(false)
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'k', toolOptions })
    expect('mcpServers' in options).toBe(false)
  })

  it('20 chat-reply agents hold no tool and no mcpServers, while the control agent holds 2 of each more', async () => {
    const settings = settingsWith({ mcpServers: SERVERS, acpAgents: AGENTS })
    const { create, options } = recordingCreate()
    const chat = createChannelAgentFactory(MODEL_ENV, create)
    for (let i = 0; i < 20; i += 1) await chat()
    expect(options).toHaveLength(20)
    for (const option of options) {
      expect(option.tools).toBeUndefined()
      expect(option.plugins).toBeUndefined()
      expect(option.mcpServers).toBeUndefined()
    }
    const without = agentToolOptions(settingsWith({}))
    const control = recordingCreate()
    await createAgentFactory(MODEL_ENV, control.create)(agentToolOptions(settings))
    expect(Object.keys(control.options[0]?.mcpServers ?? {})).toHaveLength(2)
    expect(control.options[0]?.tools).toHaveLength(without.tools.length + 2)
  })

  it('every ACP tool comes from theokit/server/agent', () => {
    const sources = sourceFiles(join(import.meta.dirname, '..', 'src')).map((path) => readFileSync(path, 'utf8'))
    expect(sources.filter((text) => text.includes('AcpClient'))).toEqual([])
    expect(sources.filter((text) => text.includes("'initialize'") || text.includes('"initialize"'))).toEqual([])
    expect(sources.some((text) => text.includes("from 'theokit/server/agent'"))).toBe(true)
  })
})
