import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ServiceCommandError,
  serviceBackend,
  systemdUnit,
  UnsupportedPlatformError,
  type Runner,
} from '../../src/service/index.js'

const homes: string[] = []
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true })
})
const home = (): string => {
  const h = mkdtempSync(join(tmpdir(), 'host-svc-'))
  homes.push(h)
  return h
}
const spec = (label: string, arg = 'one') => ({
  label,
  command: '/usr/bin/node',
  args: [arg],
  workingDirectory: '/srv',
})

function fake(failOn?: string): { runner: Runner; calls: string[] } {
  const calls: string[] = []
  const runner: Runner = async (_c, args) => {
    const line = args.slice(1).join(' ')
    calls.push(line)
    return {
      code: failOn !== undefined && line.startsWith(failOn) ? 1 : 0,
      stdout: 'active\n',
      stderr: failOn === undefined ? '' : 'boom',
    }
  }
  return { runner, calls }
}

describe('systemd backend', () => {
  it('restores the previous unit on a failed reinstall', async () => {
    const homeDir = home()
    const ok = fake()
    await serviceBackend('linux', { homeDir, runner: ok.runner }).install(spec('a'))
    const path = serviceBackend('linux', { homeDir }).definitionPath({ label: 'a' })
    const before = readFileSync(path, 'utf8')
    const bad = fake('enable')
    await expect(
      serviceBackend('linux', { homeDir, runner: bad.runner }).install(spec('a', 'two')),
    ).rejects.toBeInstanceOf(ServiceCommandError)
    expect(readFileSync(path, 'utf8')).toBe(before)
    expect(bad.calls.at(-1)).toBe('daemon-reload')
  })

  it('leaves no unit on a failed first install', async () => {
    const homeDir = home()
    const bad = fake('enable')
    const backend = serviceBackend('linux', { homeDir, runner: bad.runner })
    const error = await backend.install(spec('a')).catch((e: unknown) => e)
    expect(error).toMatchObject({ exitCode: 1 })
    expect(existsSync(backend.definitionPath({ label: 'a' }))).toBe(false)
  })

  it('writes two concurrent installs completely', async () => {
    const homeDir = home()
    const backend = serviceBackend('linux', { homeDir, runner: fake().runner })
    await Promise.all([backend.install(spec('a')), backend.install(spec('b', 'two'))])
    expect(readFileSync(backend.definitionPath({ label: 'a' }), 'utf8')).toBe(
      systemdUnit(spec('a')),
    )
    expect(readFileSync(backend.definitionPath({ label: 'b' }), 'utf8')).toBe(
      systemdUnit(spec('b', 'two')),
    )
  })

  it('reports status, restarts and uninstalls', async () => {
    const homeDir = home()
    const { runner, calls } = fake()
    const backend = serviceBackend('linux', { homeDir, runner })
    expect(await backend.status('a')).toBe('not-installed')
    await backend.install(spec('a'))
    expect(await backend.status('a')).toBe('running')
    await backend.restart('a')
    await backend.uninstall('a')
    expect(existsSync(backend.definitionPath({ label: 'a' }))).toBe(false)
    expect(calls).toContain('disable --now -- a.service')
  })

  it('refuses an unsupported platform by name', () => {
    expect(() => serviceBackend('aix')).toThrow(UnsupportedPlatformError)
    expect(() => serviceBackend('aix')).toThrow(/aix/)
  })

  it('puts -- before the unit name so a leading-hyphen label is not an option', async () => {
    const homeDir = home()
    const { runner, calls } = fake()
    const backend = serviceBackend('linux', { homeDir, runner })
    await backend.install(spec('-x'))
    await backend.restart('-x')
    await backend.status('-x')
    await backend.uninstall('-x')
    expect(calls).toEqual(
      expect.arrayContaining([
        'enable --now -- -x.service',
        'restart -- -x.service',
        'is-active -- -x.service',
        'disable --now -- -x.service',
      ]),
    )
  })

  it('keeps the unit file and throws when disable fails on an installed service', async () => {
    const homeDir = home()
    const backend = serviceBackend('linux', { homeDir, runner: fake().runner })
    await backend.install(spec('a'))
    const failing = serviceBackend('linux', { homeDir, runner: fake('disable').runner })
    await expect(failing.uninstall('a')).rejects.toBeInstanceOf(ServiceCommandError)
    expect(existsSync(backend.definitionPath({ label: 'a' }))).toBe(true)
  })

  it('tolerates a failed disable when there is no unit file', async () => {
    const backend = serviceBackend('linux', { homeDir: home(), runner: fake('disable').runner })
    await expect(backend.uninstall('ghost')).resolves.toBeUndefined()
  })
})
