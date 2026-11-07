
import { LinuxSandbox } from '@theokit/agents/sandbox'
import { afterEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { MAIN_SESSION_KEY, readSandboxSessions, sandboxModeForSession } from '../src/sandbox/sandbox-mode.js'
import { resolveToolSettings, toolSettingsForSession } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { enforced } from './tool-start-fixtures.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('readSandboxSessions', () => {
  it('defaults to all, reads non-main, refuses anything else', () => {
    expect(readSandboxSessions({})).toBe('all')
    expect(readSandboxSessions({ THEOCLAW_SANDBOX_SESSIONS: ' non-main ' })).toBe('non-main')
    expect(() => readSandboxSessions({ THEOCLAW_SANDBOX_SESSIONS: 'agent' })).toThrow(TheoClawConfigError)
  })
})

describe('sandboxModeForSession', () => {
  it('gives every session the chosen mode under all', () => {
    expect(sandboxModeForSession('danger-full-access', 'all', 'telegram-dm-1')).toBe('danger-full-access')
  })
  it('never gives a non-main session more than workspace-write, or less than read-only asks', () => {
    expect(sandboxModeForSession('danger-full-access', 'non-main', 'telegram-dm-1')).toBe('workspace-write')
    expect(sandboxModeForSession('read-only', 'non-main', 'telegram-dm-1')).toBe('read-only')
  })
})

describe('THEOCLAW_SANDBOX_SESSIONS=non-main', () => {
  it('runs a non-main session workspace-write while the main session runs danger-full-access', () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const env = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access', THEOCLAW_SANDBOX_SESSIONS: 'non-main' }
    const settings = resolveToolSettings(env, workspace.path, { detect: enforced })
    const main = toolSettingsForSession(settings, env, MAIN_SESSION_KEY, { detect: enforced })
    const other = toolSettingsForSession(settings, env, 'telegram-dm-42', { detect: enforced })
    expect(main.mode).toBe('danger-full-access')
    expect(other.mode).toBe('workspace-write')
    expect(other.sandbox).toBeInstanceOf(LinuxSandbox)
    expect(other.sandbox).not.toBe(main.sandbox)
  })

  it('leaves every session on the chosen mode by default', () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const env = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX: 'danger-full-access' }
    const settings = resolveToolSettings(env, workspace.path, { detect: enforced })
    expect(toolSettingsForSession(settings, env, 'telegram-dm-42', { detect: enforced })).toBe(settings)
  })
})
