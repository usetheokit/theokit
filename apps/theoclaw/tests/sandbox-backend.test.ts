import { spawnSync } from 'node:child_process'

import type { DockerRunner } from '@theokit/agents/sandbox'
import { DockerSandbox } from '@theokit/agents/sandbox'
import { afterEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { readSandboxBackend } from '../src/sandbox/sandbox-backend.js'
import { MAIN_SESSION_KEY } from '../src/sandbox/sandbox-mode.js'
import { resolveToolSettings, toolSettingsForSession } from '../src/tools/tool-settings.js'
import { makeHostToolsWorkspace } from './host-tools-workspace.js'
import { enforced } from './tool-start-fixtures.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function recorder(): { runner: DockerRunner; calls: string[][] } {
  const calls: string[][] = []
  const runner: DockerRunner = (args) => {
    calls.push([...args])
    return Promise.resolve({ stdout: '', stderr: '', code: 0, timedOut: false })
  }
  return { runner, calls }
}

function mountOf(call: string[]): string | undefined {
  return call[call.indexOf('-v') + 1]
}

describe('readSandboxBackend', () => {
  it('defaults to the host sandbox and accepts docker', () => {
    expect(readSandboxBackend({})).toBe('bwrap')
    expect(readSandboxBackend({ THEOCLAW_SANDBOX_BACKEND: ' docker ' })).toBe('docker')
  })

  it('refuses an unknown value, listing the accepted ones', () => {
    expect(() => readSandboxBackend({ THEOCLAW_SANDBOX_BACKEND: 'podman' })).toThrow(/one of bwrap, docker; got "podman"/)
    expect(() => resolveToolSettings({ THEOCLAW_SANDBOX_BACKEND: 'ssh' }, '/nonexistent')).toThrow(TheoClawConfigError)
  })
})

describe('THEOCLAW_SANDBOX_BACKEND=docker', () => {
  function settingsFor(sandbox: string | undefined, dockerRunner: DockerRunner) {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const env = { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX_BACKEND: 'docker', ...(sandbox === undefined ? {} : { THEOCLAW_SANDBOX: sandbox }) }
    return { env, settings: resolveToolSettings(env, workspace.path, { detect: enforced, dockerRunner }) }
  }

  it('builds a DockerSandbox mounting the tool root read-write under workspace-write', async () => {
    const { runner, calls } = recorder()
    const { settings } = settingsFor(undefined, runner)
    expect(settings.sandbox).toBeInstanceOf(DockerSandbox)
    await settings.sandbox.execute('true')
    expect(mountOf(calls[0] ?? [])).toBe(`${settings.toolRoot}:/workspace:rw`)
  })

  it('mounts the tool root read-only for a read-only session', async () => {
    const { runner, calls } = recorder()
    const { env, settings } = settingsFor('workspace-write', runner)
    const session = toolSettingsForSession(settings, { ...env, THEOCLAW_SANDBOX_SESSIONS: 'non-main' }, MAIN_SESSION_KEY, {
      dockerRunner: runner,
    })
    expect(session.mode).toBe(settings.mode)
    const readOnly = settingsFor('read-only', runner).settings
    await readOnly.sandbox.execute('touch x')
    expect(mountOf(calls[0] ?? [])).toBe(`${readOnly.toolRoot}:/workspace:ro`)
  })

  it('labels each session\'s containers with its own key, even in the default mode', async () => {
    const { runner, calls } = recorder()
    const { env, settings } = settingsFor(undefined, runner)
    const session = toolSettingsForSession(settings, env, 'agent:main:chat-7', { dockerRunner: runner })
    await session.sandbox.execute('true')
    const run = calls[0] ?? []
    expect(run.join(' ')).toContain('--label theoclaw.session=agent:main:chat-7')
    expect(run).not.toContain('--rm')
  })

  it('refuses danger-full-access, naming it, rather than downgrading', () => {
    const { runner } = recorder()
    expect(() => settingsFor('danger-full-access', runner)).toThrow(/cannot honor THEOCLAW_SANDBOX=danger-full-access/)
  })
})

const dockerUp = spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0

describe.skipIf(!dockerUp)('docker backend against a real daemon (skipped: `docker info` fails)', () => {
  it('runs shell_exec in the image and refuses a write under read-only', async () => {
    const workspace = makeHostToolsWorkspace()
    cleanups.push(() => workspace.remove())
    const rw = resolveToolSettings({ THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX_BACKEND: 'docker' }, workspace.path)
    const os = await rw.sandbox.execute('cat /etc/os-release')
    expect(os.stdout).toMatch(/Alpine/)
    const ro = resolveToolSettings(
      { THEOCLAW_HOST_TOOLS: 'on', THEOCLAW_SANDBOX_BACKEND: 'docker', THEOCLAW_SANDBOX: 'read-only' },
      workspace.path,
    )
    const write = await ro.sandbox.execute('echo hi > /workspace/f.txt')
    expect(write.exitCode).not.toBe(0)
    expect(write.stderr).toMatch(/Read-only file system/)
  })
})
