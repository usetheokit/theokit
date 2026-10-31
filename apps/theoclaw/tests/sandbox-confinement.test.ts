import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BwrapDetection } from '@theokit/agents/sandbox'
import { detectBwrapMemoized, LinuxSandbox, LocalSandbox, resolveSandboxPosture, writableRootsFor } from '@theokit/agents/sandbox'
import type { CustomTool } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { agentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import type { ToolSettings } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { runControlTurn, startForTools, stop } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

/**
 * The shell B-382 registers, run directly through the tools the process builds, over a real
 * bubblewrap. Nothing here skips: a host without an enforced sandbox fails the first test, so the
 * file cannot pass on the `LocalSandbox` fallback (NFR-001).
 */

const MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const
const FILE_WRITERS = ['apply_patch', 'edit_file', 'write_file']

interface ShellResult {
  readonly ok: boolean
  readonly exit_code?: number
  readonly stdout?: string
  readonly stderr?: string
}

const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  for (const start of started.splice(0)) await stop(start)
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A host-tools workspace and an `outside/` directory beside it, under the same base. */
function workspaceAndOutside(): { readonly workspace: string; readonly outside: string } {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  const outside = mkdtempSync(join(dirname(workspace.path), 'outside-'))
  cleanups.push(() => rmSync(outside, { recursive: true, force: true }))
  return { workspace: workspace.path, outside }
}

function settingsFor(mode: (typeof MODES)[number], workspace: string): ToolSettings {
  return resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: mode }, workspace)
}

function toolNamed(tools: readonly CustomTool[], name: string): CustomTool {
  const tool = tools.find((candidate) => candidate.name === name)
  if (tool === undefined) throw new Error(`no ${name} among ${tools.map((candidate) => candidate.name).join(', ')}`)
  return tool
}

async function runShell(settings: ToolSettings, command: string): Promise<ShellResult> {
  const output = await toolNamed(agentToolOptions(settings).tools, 'shell_exec').handler({ command })
  return (typeof output === 'string' ? JSON.parse(output) : output) as ShellResult
}

/** A refused write: the shell ran, the command failed on the read-only bind, and nothing was written. */
function expectRefusedWrite(result: ShellResult, target: string): void {
  expect(result.ok).toBe(true)
  expect(result.exit_code).not.toBe(0)
  expect(result.stderr).toMatch(/Read-only file system/)
  expect(existsSync(target)).toBe(false)
}

describe('the shell under a real bubblewrap', () => {
  it('the host confines: workspace-write is enforced and the start-time backend is a LinuxSandbox', () => {
    expect(resolveSandboxPosture({ mode: 'workspace-write' }).enforced).toBe(true)
    const { workspace } = workspaceAndOutside()
    expect(settingsFor('workspace-write', workspace).sandbox).toBeInstanceOf(LinuxSandbox)
  })

  it('under workspace-write the shell cannot write outside its tool root', async () => {
    const { workspace, outside } = workspaceAndOutside()
    const target = join(outside, 'x')
    expectRefusedWrite(await runShell(settingsFor('workspace-write', workspace), `echo x > ${target}`), target)
  })

  it('under workspace-write the shell writes inside its tool root', async () => {
    const { workspace } = workspaceAndOutside()
    const settings = settingsFor('workspace-write', workspace)
    const result = await runShell(settings, 'echo x > inside.txt')
    expect(result.ok).toBe(true)
    expect(result.exit_code).toBe(0)
    expect(readdirSync(settings.toolRoot)).toEqual(['inside.txt'])
  })

  it('under read-only the shell runs and cannot write inside its tool root', async () => {
    const { workspace } = workspaceAndOutside()
    const settings = settingsFor('read-only', workspace)
    const listed = await runShell(settings, 'ls')
    expect(listed.ok).toBe(true)
    expect(listed.exit_code).toBe(0)
    expectRefusedWrite(await runShell(settings, 'echo x > inside.txt'), join(settings.toolRoot, 'inside.txt'))
  })

  it('the same outside write succeeds under danger-full-access', async () => {
    const { workspace, outside } = workspaceAndOutside()
    const settings = settingsFor('danger-full-access', workspace)
    expect(settings.sandbox).toBeInstanceOf(LocalSandbox)
    const result = await runShell(settings, `echo x > ${join(outside, 'x')}`)
    expect(result.ok).toBe(true)
    expect(result.exit_code).toBe(0)
    expect(readFileSync(join(outside, 'x'), 'utf8')).toBe('x\n')
  })

  it('the writable roots are the tool root and /tmp under workspace-write, and none under read-only', () => {
    const toolRoot = '/srv/theoclaw/files'
    expect(writableRootsFor('workspace-write', toolRoot)).toEqual([toolRoot, '/tmp'])
    expect(writableRootsFor('read-only', toolRoot)).toEqual([])
  })
})

describe('the tools each mode registers', () => {
  it('read-only leaves write_file, edit_file and apply_patch out and keeps shell_exec', () => {
    const { workspace } = workspaceAndOutside()
    const names = agentToolOptions(settingsFor('read-only', workspace)).tools.map((tool) => tool.name)
    expect(names).toContain('shell_exec')
    for (const writer of FILE_WRITERS) expect(names).not.toContain(writer)
  })

  it('host tools off keeps a read-only LinuxSandbox in every mode', async () => {
    for (const mode of MODES) {
      const { workspace, outside } = workspaceAndOutside()
      const settings = resolveToolSettings({ THEOCLAW_SANDBOX: mode }, workspace)
      expect(settings.sandbox).toBeInstanceOf(LinuxSandbox)
      expect(settings.mode).toBe('read-only')
      expect(agentToolOptions(settings).tools.map((tool) => tool.name)).not.toContain('shell_exec')
      // The backend itself binds nothing writable: a command run on it cannot write outside.
      const target = join(outside, 'x')
      const result = await settings.sandbox.execute(`echo x > ${target}`)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toMatch(/Read-only file system/)
      expect(existsSync(target)).toBe(false)
    }
  })
})

describe('one backend per start', () => {
  it('ten agents create no backend: the detect count after the start does not move, and every shell runs in the one tool root', async () => {
    let detections = 0
    const detect = (): BwrapDetection => {
      detections += 1
      return detectBwrapMemoized()
    }
    const { workspace } = workspaceAndOutside()
    const start = await startForTools({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'workspace-write' }, workspace, { detect })
    started.push(start)
    expect(start.error).toBeUndefined()
    const afterStart = detections
    const roots = new Set<string>()
    for (let agent = 0; agent < 10; agent += 1) {
      const options = await runControlTurn(start)
      const output = await toolNamed(options.tools, 'shell_exec').handler({ command: 'pwd' })
      roots.add(String((typeof output === 'string' ? JSON.parse(output) : output).stdout).trim())
    }
    expect(detections).toBe(afterStart)
    expect([...roots]).toEqual([join(workspace, 'files')])
  })
})

describe('the sandbox backends', () => {
  it('TheoClaw defines no SandboxBackend subclass', () => {
    const src = fileURLToPath(new URL('../src', import.meta.url))
    const subclasses: string[] = []
    for (const entry of readdirSync(src, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue
      const file = join(entry.parentPath, entry.name)
      if (/extends\s+(SandboxBackend|LocalSandbox|LinuxSandbox)\b/.test(readFileSync(file, 'utf8'))) subclasses.push(file)
    }
    expect(subclasses).toEqual([])
  })
})
