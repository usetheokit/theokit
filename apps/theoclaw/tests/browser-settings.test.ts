import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent } from '@theokit/sdk'
import type { SDKAgent } from '@theokit/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../src/agent/create-agent.js'
import { agentOptionsFor, createChannelAgentFactory } from '../src/control-plane/agent-factory.js'
import type { TheoClawAgentOptions } from '../src/agent/create-agent.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { browserServer, readBrowser } from '../src/tools/browser-server.js'
import type { BrowserDeps } from '../src/tools/browser-server.js'
import type { ImportedSetup } from '../src/migration/import-store.js'
import type { TurnAgent } from '../src/agent-port.js'
import { agentToolOptions, controlAgentToolOptions, NO_TOOL_OPTIONS } from '../src/tools/tool-registry.js'
import type { AgentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { notEnforced, runControlTurn, startForTools, stop, tempCwd } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

const CLI = '/opt/fake/@playwright/mcp/cli.js'
/** The wrapper the server is started through: it filters the tool list and owns the file root. */
const PROXY = join(import.meta.dirname, '..', 'tools', 'browser-proxy.mjs')
const ON_LINE = 'tools: browser is on (headless chromium, isolated profile)'
const OFF_LINE = 'tools: browser is off (THEOCLAW_BROWSER unset)'
const MODEL_ENV = { THEOCLAW_MODEL: 'openrouter/m', OPENROUTER_API_KEY: 'router-key' }

const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  for (const start of started.splice(0)) await stop(start)
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.restoreAllMocks()
})

function tempDir(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => rmSync(path, { recursive: true, force: true }))
  return path
}

/** A browsers directory holding exactly the named entries, each a directory. */
function browsersDir(...entries: string[]): string {
  const dir = tempDir('theoclaw-browsers-')
  for (const entry of entries) mkdirSync(join(dir, entry))
  return dir
}

function installed(): BrowserDeps {
  return { resolveCli: () => CLI, browsersDir: browsersDir('chromium-1200') }
}

function settingsWith(env: Record<string, string | undefined>, browser: BrowserDeps = installed()) {
  return resolveToolSettings(env, tempDir('theoclaw-browser-ws-'), { detect: notEnforced, warn: () => undefined, browser })
}

function refusal(run: () => unknown): TheoClawConfigError {
  try {
    run()
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error('expected a TheoClawConfigError, and nothing was thrown')
}

describe('THEOCLAW_BROWSER', () => {
  it('refuses a THEOCLAW_BROWSER value other than on', () => {
    for (const value of ['yes', 'ON']) {
      const error = refusal(() => readBrowser({ THEOCLAW_BROWSER: value }, installed()))
      expect(error.variable).toBe('THEOCLAW_BROWSER')
      expect(error.message).toBe(`THEOCLAW_BROWSER must be "on" or unset, not "${value}"`)
    }
  })

  it('gives no browser server when THEOCLAW_BROWSER is unset', () => {
    for (const env of [{}, { THEOCLAW_BROWSER: '' }]) {
      const settings = settingsWith(env)
      expect(settings.browser).toBeUndefined()
      expect('mcpServers' in agentToolOptions(settings)).toBe(false)
      expect(settings.offLines).toContain(OFF_LINE)
      expect(settings.offLines).not.toContain(ON_LINE)
    }
  })

  it('gives the control agent one headless isolated browser server when on', () => {
    const settings = settingsWith({ THEOCLAW_BROWSER: 'on' })
    const servers = agentToolOptions(settings).mcpServers
    expect(Object.keys(servers ?? {})).toEqual(['browser'])
    expect(servers?.browser).toEqual({
      type: 'stdio',
      command: process.execPath,
      args: [PROXY, CLI, '--headless', '--isolated', '--browser', 'chromium'],
    })
    expect(settings.offLines).toContain(ON_LINE)
    expect(settings.offLines).not.toContain(OFF_LINE)
  })

  it('gives the control agent the browser beside run_code and delegate_all, and its workers none', async () => {
    const settings = settingsWith({ THEOCLAW_BROWSER: 'on' })
    const workerOptions: AgentToolOptions[] = []
    const worker: TurnAgent = {
      send: async () => ({
        stream: async function* () {
          yield { type: 'assistant' }
        },
        wait: async () => ({ status: 'finished', result: 'done' }),
        cancel: async () => {},
      }),
      [Symbol.asyncDispose]: async () => {},
    } as unknown as TurnAgent
    const control = controlAgentToolOptions(settings, async (options) => {
      workerOptions.push(options)
      return worker
    })

    expect(Object.keys(control.mcpServers ?? {})).toEqual(['browser'])
    const names = control.tools.map((tool) => tool.name)
    expect(names).toContain('run_code')
    expect(names).toContain('delegate_all')
    const delegate = control.tools.find((tool) => tool.name === 'delegate_all')
    await delegate?.handler({ tasks: [{ agent: 'worker', task: 'one' }] })
    expect(workerOptions).toHaveLength(1)
    expect('mcpServers' in (workerOptions[0] as object)).toBe(false)
    expect('mcpServers' in NO_TOOL_OPTIONS).toBe(false)
  })

  it('builds a chat agent with no mcp server even with the browser on', async () => {
    const options: TheoClawAgentOptions[] = []
    const create = async (passed: TheoClawAgentOptions) => {
      options.push(passed)
      return passed
    }
    // The browser on in the same environment the chat agent is built from.
    await createChannelAgentFactory({ ...MODEL_ENV, THEOCLAW_BROWSER: 'on' }, create)()
    expect(options).toHaveLength(1)
    expect('mcpServers' in (options[0] as object)).toBe(false)
    expect('mcpServers' in agentOptionsFor({ ...MODEL_ENV, THEOCLAW_BROWSER: 'on' })).toBe(false)
    expect('mcpServers' in theoClawAgentOptions({ model: 'm', apiKey: 'k' })).toBe(false)
  })

  it('refuses to start when no chromium build is installed', () => {
    const empty = browsersDir()
    const absent = join(tempDir('theoclaw-browsers-'), 'missing')
    const firefoxOnly = browsersDir('firefox-1')
    for (const dir of [empty, absent, firefoxOnly]) {
      const error = refusal(() => readBrowser({ THEOCLAW_BROWSER: 'on' }, { resolveCli: () => CLI, browsersDir: dir }))
      expect(error.variable).toBe('THEOCLAW_BROWSER')
      expect(error.message).toContain('browser:install')
      expect(error.message).toContain(dir)
    }
  })

  it('accepts a headless-shell-only install', () => {
    const settings = readBrowser(
      { THEOCLAW_BROWSER: 'on' },
      { resolveCli: () => CLI, browsersDir: browsersDir('chromium_headless_shell-1200') },
    )
    expect(settings).toEqual({ cliPath: CLI })
  })

  it('refuses PLAYWRIGHT_BROWSERS_PATH=0 naming the value', () => {
    const error = refusal(() => readBrowser({ THEOCLAW_BROWSER: 'on', PLAYWRIGHT_BROWSERS_PATH: '0' }, { resolveCli: () => CLI }))
    expect(error.variable).toBe('PLAYWRIGHT_BROWSERS_PATH')
    expect(error.message).toContain('PLAYWRIGHT_BROWSERS_PATH=0')
    expect(error.message).not.toContain('browsers directory 0 ')
  })

  it('refuses a browsers directory that is a file', () => {
    const file = join(tempDir('theoclaw-browsers-'), 'not-a-dir')
    writeFileSync(file, '')
    const error = refusal(() => readBrowser({ THEOCLAW_BROWSER: 'on' }, { resolveCli: () => CLI, browsersDir: file }))
    expect(error.message).toContain('browser:install')
  })

  it('does not count a dangling chromium-1200 symlink', () => {
    const dangling = browsersDir()
    symlinkSync(join(dangling, 'nowhere'), join(dangling, 'chromium-1200'))
    const error = refusal(() => readBrowser({ THEOCLAW_BROWSER: 'on' }, { resolveCli: () => CLI, browsersDir: dangling }))
    expect(error.message).toContain('browser:install')
  })

  it('refuses to start when the browser package does not resolve', () => {
    const resolveCli = (): string => {
      throw Object.assign(new Error("Cannot find module '@playwright/mcp/package.json'"), { code: 'MODULE_NOT_FOUND' })
    }
    const error = refusal(() => readBrowser({ THEOCLAW_BROWSER: 'on' }, { resolveCli, browsersDir: browsersDir('chromium-1200') }))
    expect(error.variable).toBe('THEOCLAW_BROWSER')
    expect(error.message).toContain('@playwright/mcp')
    expect(error.message).toContain('pnpm install')
  })

  it('prints the browser line on start', async () => {
    const result = await startForTools({ THEOCLAW_BROWSER: 'on' }, tempCwd(cleanups), { detect: notEnforced, browser: installed() })
    started.push(result)
    expect(result.error).toBeUndefined()
    expect(result.output()).toContain(ON_LINE)
  })

  it('gives a /control turn of the started process the browser server', async () => {
    // Review round 1 (F-tests-2, F-wire-1): through the composition, not one layer below it.
    const result = await startForTools({ THEOCLAW_BROWSER: 'on' }, tempCwd(cleanups), { detect: notEnforced, browser: installed() })
    started.push(result)
    const options = await runControlTurn(result)
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['browser'])
  })

  it('spawns the browser server with neither env nor envPolicy', () => {
    // Neither key present, so the SDK's `inherit-scrubbed` default applies (NFR-004).
    const server = browserServer({ cliPath: CLI })
    expect('env' in server).toBe(false)
    expect('envPolicy' in server).toBe(false)
  })

  it('passes mcpServers to Agent.create', async () => {
    const settings = settingsWith({ THEOCLAW_BROWSER: 'on' })
    const options = theoClawAgentOptions({ model: 'm', apiKey: 'k', toolOptions: agentToolOptions(settings) })
    expect(options.mcpServers).toEqual({ browser: browserServer({ cliPath: CLI }) })
    const create = vi.spyOn(Agent, 'create').mockResolvedValue({} as SDKAgent)
    await createTheoClawAgent(options)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0]).toMatchObject({ mcpServers: { browser: browserServer({ cliPath: CLI }) } })
  })

  it('keeps the browser server beside the servers of an import whose MCP is on', () => {
    const imported: ImportedSetup = {
      kind: 'claude-code',
      instructions: '',
      memory: '',
      mcpServers: { docs: { command: 'docs-mcp' }, browser: { command: 'imported-browser' } },
      skills: [],
      counts: { instructions: 0, memories: 0, skills: 0, mcpServers: 2 },
    }
    const settings = settingsWith({ THEOCLAW_BROWSER: 'on' })
    const options = theoClawAgentOptions({
      model: 'm',
      apiKey: 'k',
      toolOptions: agentToolOptions(settings),
      imported: { setup: imported, mcp: true },
    })
    // An imported server named `browser` does not replace the one THEOCLAW_BROWSER configured.
    expect(options.mcpServers).toEqual({ docs: { command: 'docs-mcp' }, browser: browserServer({ cliPath: CLI }) })
  })
})
