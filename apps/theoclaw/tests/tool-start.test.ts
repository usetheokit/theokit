import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'

import { effectiveToolNames } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { composeTheoClaw } from '../src/composition.js'
import { applyInstance, resolveInstance } from '../src/instance.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import type { AgentToolOptions } from '../src/tools/tool-registry.js'
import { fakeBuilders, signedLinePost, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { FakeAgent, waitFor } from './fakes.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import {
  enforced,
  notEnforced,
  runControlTurn,
  startForTools,
  stop,
  tempCwd,
} from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

const SHELL_READ_LINE =
  'tools: host tools are on; the shell can read every file the process user can read'

const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  for (const start of started.splice(0)) await stop(start)
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function hostWorkspace(): string {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  return workspace.path
}

async function start(...args: Parameters<typeof startForTools>): Promise<ToolStart> {
  const result = await startForTools(...args)
  started.push(result)
  return result
}

describe('the tool settings at start', () => {
  it('refuses a tool root that is a symlink before any runner starts', async () => {
    const cwd = tempCwd(cleanups)
    mkdirSync(join(cwd, 'elsewhere'))
    symlinkSync(join(cwd, 'elsewhere'), join(cwd, 'files'))
    const result = await start({}, cwd, { detect: notEnforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toContain('is a symlink')
    expect(result.builds()).toBe(0)
  })

  it('refuses THEOCLAW_HOST_TOOLS=on when the sandbox is not enforced', async () => {
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on' }, hostWorkspace(), {
      detect: notEnforced,
    })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toContain('THEOCLAW_HOST_TOOLS=on needs an enforced sandbox')
    expect(result.error?.message).toContain('bwrap not found on PATH')
    expect(result.builds()).toBe(0)
  })

  it('refuses THEOCLAW_HOST_TOOLS=on when the working directory is under /tmp', async () => {
    // A literal /tmp, not os.tmpdir(): TMPDIR may point elsewhere, and /tmp is the root the sandbox opens.
    const cwd = realpathSync(mkdtempSync('/tmp/theoclaw-start-'))
    cleanups.push(() => rmSync(cwd, { recursive: true, force: true }))
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on' }, cwd, { detect: enforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toContain(cwd)
    expect(result.error?.message).toContain('/tmp')
    expect(result.builds()).toBe(0)
  })

  it('refuses THEOCLAW_HOST_TOOLS=on when THEOCLAW_STATE_DIR is inside the tool root', async () => {
    const workspace = hostWorkspace()
    const stateDir = join(workspace, 'files', 'state')
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_STATE_DIR: stateDir }, workspace, { detect: enforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toContain('THEOCLAW_STATE_DIR')
    expect(result.error?.message).toContain(stateDir)
    expect((result.error as TheoClawConfigError).variable).toBe('THEOCLAW_STATE_DIR')
    expect(result.builds()).toBe(0)
  })

  it('refuses THEOCLAW_HOST_TOOLS=on when THEOCLAW_STATE_DIR is under /tmp', async () => {
    const stateDir = realpathSync(mkdtempSync('/tmp/theoclaw-state-'))
    cleanups.push(() => rmSync(stateDir, { recursive: true, force: true }))
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_STATE_DIR: stateDir }, hostWorkspace(), { detect: enforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toContain('THEOCLAW_STATE_DIR')
    expect(result.error?.message).toContain('/tmp')
    expect(result.builds()).toBe(0)
  })

  it('accepts THEOCLAW_HOST_TOOLS=on with THEOCLAW_STATE_DIR outside every root the shell can write', async () => {
    const workspace = hostWorkspace()
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_STATE_DIR: join(workspace, 'state') }, workspace, { detect: enforced })
    expect(result.error).toBeUndefined()
  })

  it('refuses THEOCLAW_HOST_TOOLS=yes before any runner starts', async () => {
    const result = await start({ THEOCLAW_HOST_TOOLS: 'yes' }, tempCwd(cleanups), {
      detect: notEnforced,
    })
    expect(result.error?.message).toContain('THEOCLAW_HOST_TOOLS must be "on" or unset')
    expect(result.builds()).toBe(0)
  })

  it('prints the shell read line only when host tools are on', async () => {
    const off = await start({}, tempCwd(cleanups), { detect: notEnforced })
    expect(off.error).toBeUndefined()
    expect(off.output()).not.toContain(SHELL_READ_LINE)
    const on = await start({ THEOCLAW_HOST_TOOLS: 'on' }, hostWorkspace(), { detect: enforced })
    expect(on.error).toBeUndefined()
    await waitFor(() => on.output().includes(SHELL_READ_LINE), 1000, 'the shell read line')
  })

  it('a start with an injected cwd creates files/ there and nothing in the process working directory', async () => {
    const cwd = tempCwd(cleanups)
    const before = existsSync(join(process.cwd(), 'files'))
    const result = await start({}, cwd, { detect: notEnforced })
    expect(result.error).toBeUndefined()
    expect(existsSync(join(cwd, 'files'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'files'))).toBe(before)
  })

  it('a profiled start with no injected cwd makes files/ in the profile workspace, where its agents work', async () => {
    const home = tempCwd(cleanups)
    const instance = resolveInstance({ THEOCLAW_PROFILE: 'tools' }, { homeDir: home })
    applyInstance(instance, {})
    const before = existsSync(join(process.cwd(), 'files'))
    const result = await start({}, undefined, { detect: notEnforced }, { instance })
    expect(result.error).toBeUndefined()
    expect(existsSync(join(home, '.theokit', 'profiles', 'tools', 'workspace', 'files'))).toBe(true)
    expect(existsSync(join(process.cwd(), 'files'))).toBe(before)
  })
})

describe('the tool options each agent receives', () => {
  it('the factory startTheoClaw calls receives the tool options with shell withheld', async () => {
    const result = await start({}, tempCwd(cleanups), { detect: notEnforced })
    const options = await runControlTurn(result)
    expect(options.withheldBuiltinTools).toEqual(['shell'])
    expect(options.tools.map((tool) => tool.name).sort()).toEqual([
      'list_dir',
      'read_file',
      'todolist',
      'view_image',
      'web_fetch',
    ])
    expect(options.plugins.map((plugin) => plugin.name)).toEqual(['theoclaw-path-veto'])
  })

  it('composeTheoClaw with no toolSettings still hands the factory shell withheld and no host tool', async () => {
    const received: AgentToolOptions[] = []
    const { builders } = fakeBuilders()
    const { loop, router } = composeTheoClaw({
      env: TELEGRAM_AND_LINE,
      agentFactory: (options: AgentToolOptions) => {
        received.push(options)
        return new FakeAgent({ frames: [] })
      },
      builders,
      write: () => undefined,
    })
    await loop.ready
    expect((await router(signedLinePost())).status).toBe(200)
    await waitFor(() => received.length === 1, 1000, 'the chat agent to be built')
    await loop.stopAll()
    expect(received[0]?.withheldBuiltinTools).toEqual(['shell'])
    expect(effectiveToolNames({ ...received[0] }).names).toEqual([])
  })
})
