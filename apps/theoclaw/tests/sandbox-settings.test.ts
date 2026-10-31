import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { LinuxSandbox, LocalSandbox } from '@theokit/agents/sandbox'
import { afterEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { readSandboxMode } from '../src/sandbox/sandbox-mode.js'
import { agentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { enforced, notEnforced, startForTools, stop, tempCwd } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

const OFF_LINE = 'sandbox: off (danger-full-access), shell_exec runs unconfined'
const THREE_MODES = /read-only, workspace-write, danger-full-access/
const GIT_DIFF_OFF_LINE = 'tools: git_diff is off (sandbox not enforced: '
const FAKE_BROWSER_CLI = '/opt/fake/@playwright/mcp/cli.js'

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

function tmpWorkspace(): string {
  // A literal /tmp, not os.tmpdir(): /tmp is the root the workspace-write sandbox opens.
  const cwd = realpathSync(mkdtempSync('/tmp/theoclaw-sandbox-'))
  cleanups.push(() => rmSync(cwd, { recursive: true, force: true }))
  return cwd
}

async function start(...args: Parameters<typeof startForTools>): Promise<ToolStart> {
  const result = await startForTools(...args)
  started.push(result)
  return result
}

/** A browsers directory holding one Chromium build, so `THEOCLAW_BROWSER=on` resolves. */
function installedBrowser(): { readonly resolveCli: () => string; readonly browsersDir: string } {
  const dir = realpathSync(mkdtempSync('/tmp/theoclaw-sandbox-browsers-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'chromium-1200'))
  return { resolveCli: () => FAKE_BROWSER_CLI, browsersDir: dir }
}

/** The writable binds bubblewrap receives: what the backend actually lets the shell write. */
function writableBinds(sandbox: LinuxSandbox): string[] {
  const argv = sandbox.wrapCommand('true') ?? ''
  // A quoting change in the SDK must fail the read-only case too, not leave it matching nothing.
  expect(argv).toContain("'--ro-bind'")
  return [...argv.matchAll(/'--bind' '([^']+)' '[^']+'/g)].map((match) => match[1] as string)
}

describe('readSandboxMode', () => {
  it('defaults to workspace-write when THEOCLAW_SANDBOX is unset', () => {
    expect(readSandboxMode({})).toBe('workspace-write')
    expect(readSandboxMode({ THEOCLAW_SANDBOX: '' })).toBe('workspace-write')
  })

  it('reads read-only with surrounding spaces', () => {
    expect(readSandboxMode({ THEOCLAW_SANDBOX: ' read-only ' })).toBe('read-only')
  })

  it('reads workspace-write when it is set explicitly', () => {
    expect(readSandboxMode({ THEOCLAW_SANDBOX: 'workspace-write' })).toBe('workspace-write')
  })

  it('reads danger-full-access', () => {
    expect(readSandboxMode({ THEOCLAW_SANDBOX: 'danger-full-access' })).toBe('danger-full-access')
  })

  it('refuses docker with a TheoClawConfigError naming THEOCLAW_SANDBOX and the three modes', () => {
    let error: unknown
    try {
      readSandboxMode({ THEOCLAW_SANDBOX: 'docker' })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(TheoClawConfigError)
    expect((error as TheoClawConfigError).variable).toBe('THEOCLAW_SANDBOX')
    expect((error as Error).message).toMatch(THREE_MODES)
    expect((error as Error).message).toContain('"docker"')
  })
})

describe('THEOCLAW_SANDBOX at start', () => {
  it('refuses docker before any runner starts', async () => {
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'docker' }, hostWorkspace(), { detect: enforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toMatch(THREE_MODES)
    expect(result.builds()).toBe(0)
  })

  it('refuses docker with host tools off: the value is checked whatever THEOCLAW_HOST_TOOLS says', async () => {
    const result = await start({ THEOCLAW_SANDBOX: 'docker' }, tempCwd(cleanups), { detect: notEnforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect((result.error as TheoClawConfigError).variable).toBe('THEOCLAW_SANDBOX')
    expect(result.builds()).toBe(0)
  })

  for (const mode of ['read-only', 'workspace-write'] as const) {
    it(`refuses a start whose backend is not enforced under ${mode}, naming THEOCLAW_SANDBOX and the detail`, async () => {
      const workspace = hostWorkspace()
      const env = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: mode }
      // The backend the tools would receive is itself the fallback: the check reads it, not a probe.
      expect(resolveToolSettings(env, workspace, { detect: notEnforced, warn: () => undefined }).sandbox).toBeInstanceOf(LocalSandbox)
      const result = await start(env, workspace, { detect: notEnforced })
      expect(result.error).toBeInstanceOf(TheoClawConfigError)
      expect((result.error as TheoClawConfigError).variable).toBe('THEOCLAW_SANDBOX')
      expect(result.error?.message).toContain('THEOCLAW_HOST_TOOLS=on needs an enforced sandbox')
      expect(result.error?.message).toContain(`THEOCLAW_SANDBOX=${mode}`)
      expect(result.error?.message).toContain('bwrap not found on PATH')
      expect(result.builds()).toBe(0)
    })

    it(`names installing bubblewrap as the fix for an unenforced sandbox under ${mode}, before the opt-out`, async () => {
      const result = await start({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: mode }, hostWorkspace(), { detect: notEnforced })
      const message = result.error?.message ?? ''
      const fix = message.indexOf('install bubblewrap')
      expect(fix).toBeGreaterThan(-1)
      expect(message).toContain('unprivileged user namespaces')
      expect(fix).toBeLessThan(message.indexOf('THEOCLAW_SANDBOX=danger-full-access'))
    })
  }

  // The writable binds are pinned as literals, not read back from `writableRootsFor`: a change in
  // the SDK's policy must fail here (plan, Drawbacks: `/tmp` stays writable under workspace-write).
  const expectedBinds = { 'read-only': () => [], 'workspace-write': (toolRoot: string) => [toolRoot, '/tmp'] }
  for (const mode of ['read-only', 'workspace-write'] as const) {
    it(`builds the start-time backend in the configured mode: ${mode}`, () => {
      const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: mode }, hostWorkspace(), {
        detect: enforced,
        warn: () => undefined,
      })
      expect(settings.sandboxMode).toBe(mode)
      expect(settings.mode).toBe(mode)
      expect(settings.sandbox).toBeInstanceOf(LinuxSandbox)
      expect(writableBinds(settings.sandbox as LinuxSandbox)).toEqual(expectedBinds[mode](settings.toolRoot))
    })
  }

  it('writes one sandbox off line under danger-full-access, and the runners start', async () => {
    const warnings: string[] = []
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access' }, hostWorkspace(), {
      detect: notEnforced,
      warn: (message) => warnings.push(message),
    })
    expect(result.error).toBeUndefined()
    expect(result.output().split('\n').filter((line) => line.includes(OFF_LINE))).toHaveLength(1)
    expect(result.builds()).toBeGreaterThan(0)
    expect(warnings).toEqual([])
  })

  it('writes no sandbox off line under danger-full-access with host tools off: the shell is not registered', async () => {
    const result = await start({ THEOCLAW_SANDBOX: 'danger-full-access' }, tempCwd(cleanups), { detect: notEnforced })
    expect(result.error).toBeUndefined()
    expect(result.output()).not.toContain(OFF_LINE)
  })

  it('refuses a workspace under /tmp under read-only', async () => {
    const cwd = tmpWorkspace()
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'read-only' }, cwd, { detect: enforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect(result.error?.message).toContain(cwd)
    expect(result.builds()).toBe(0)
  })

  it('starts with a workspace under /tmp under danger-full-access', async () => {
    const result = await start({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access' }, tmpWorkspace(), { detect: notEnforced })
    expect(result.error).toBeUndefined()
    expect(result.builds()).toBeGreaterThan(0)
  })

  it('registers no git_diff under danger-full-access with a git tool root, and writes its off line', () => {
    const workspace = hostWorkspace()
    const toolRoot = join(workspace, 'files')
    mkdirSync(toolRoot, { mode: 0o700 })
    execFileSync('git', ['init', '-q', toolRoot])
    const settings = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access' }, workspace, {
      detect: enforced,
      warn: () => undefined,
    })
    expect(settings.gitRepository).toBe(true)
    expect(agentToolOptions(settings).tools.map((tool) => tool.name)).not.toContain('git_diff')
    expect(settings.offLines.filter((line) => line.startsWith(GIT_DIFF_OFF_LINE))).toHaveLength(1)
  })

  it('refuses THEOCLAW_STATE_DIR inside the tool root under danger-full-access: the file writers could pair anyone', async () => {
    const workspace = hostWorkspace()
    const stateDir = join(workspace, 'files', 'state')
    const env = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access', THEOCLAW_STATE_DIR: stateDir }
    const result = await start(env, workspace, { detect: notEnforced })
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect((result.error as TheoClawConfigError).variable).toBe('THEOCLAW_STATE_DIR')
    expect(result.error?.message).toContain(stateDir)
    expect(result.builds()).toBe(0)
  })

  it('starts with THEOCLAW_STATE_DIR under /tmp under danger-full-access: only the tool root is still guarded', async () => {
    const stateDir = tmpWorkspace()
    const env = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access', THEOCLAW_STATE_DIR: stateDir }
    const result = await start(env, hostWorkspace(), { detect: notEnforced })
    expect(result.error).toBeUndefined()
  })

  it('refuses THEOCLAW_BROWSER=on under read-only with host tools on: the browser server writes files', () => {
    let error: unknown
    try {
      resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'read-only', THEOCLAW_BROWSER: 'on' }, hostWorkspace(), {
        detect: enforced,
        warn: () => undefined,
        browser: installedBrowser(),
      })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(TheoClawConfigError)
    expect((error as TheoClawConfigError).variable).toBe('THEOCLAW_BROWSER')
    expect((error as Error).message).toContain('THEOCLAW_SANDBOX=read-only')
  })

  it('keeps THEOCLAW_BROWSER=on under workspace-write', () => {
    const settings = resolveToolSettings(
      { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'workspace-write', THEOCLAW_BROWSER: 'on' },
      hostWorkspace(),
      { detect: enforced, warn: () => undefined, browser: installedBrowser() },
    )
    expect(settings.browser).toEqual({ cliPath: FAKE_BROWSER_CLI })
  })
})
