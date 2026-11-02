import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { daemonInstall, daemonStatus, daemonUninstall, unitFor, unitPath } from '../src/daemon.js'
import { type Harness, harness } from './support/daemon-harness.js'

function unitEnvironment(unit: string): Record<string, string> {
  const pairs = [...unit.matchAll(/^Environment=(?:"([^"]*)"|(\S+))$/gm)].map((match) => (match[1] ?? match[2])!)
  return Object.fromEntries(pairs.map((pair) => [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]))
}

function systemctl(h: Harness): string[] {
  return h.calls.filter((call) => call.command === 'systemctl').map((call) => call.args.join(' '))
}

describe('theoclaw daemon', () => {
  it('the unit runs the built entry with the configuration file', async () => {
    const h = harness()
    expect(await daemonInstall(h.io, h.runner)).toBe(0)

    const path = unitPath('theoclaw', h.home)
    expect(path).toBe(join(h.home, '.config', 'systemd', 'user', 'theoclaw.service'))
    const unit = readFileSync(path, 'utf8')
    const [, node, entry] = /^ExecStart=(\S+) (\S+)$/m.exec(unit)!
    expect(existsSync(entry!)).toBe(true)
    expect(node).toBe('/usr/bin/node')
    expect(unitEnvironment(unit).THEOCLAW_CONFIG).toBe(join(h.home, 'config', 'theoclaw', 'theoclaw.env'))
    expect(unit).toMatch(/^WantedBy=default\.target$/m)
    expect(unit).toMatch(/^Restart=on-failure$/m)
    expect(unit).toContain(`WorkingDirectory=${join(h.home, 'work')}`)
    expect(systemctl(h)).toEqual(['--user daemon-reload', '--user enable --now theoclaw.service', '--user restart theoclaw.service'])
  })

  it('daemon refuses a missing configuration and an unsupported platform', async () => {
    const unconfigured = harness({ configure: false })
    expect(await daemonInstall(unconfigured.io, unconfigured.runner)).toBe(1)
    expect(unconfigured.stderr()).toContain(join(unconfigured.home, 'config', 'theoclaw', 'theoclaw.env'))
    expect(unconfigured.stderr()).toContain('theoclaw onboard')
    expect(existsSync(unitPath('theoclaw', unconfigured.home))).toBe(false)
    expect(unconfigured.calls).toEqual([])

  })

  it('a_platform_with_no_backend_is_refused_and_nothing_is_written', async () => {
    const h = harness({ platform: 'freebsd' })
    for (const verb of [daemonInstall, daemonUninstall, daemonStatus]) expect(await verb(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('freebsd is not supported')
    expect(h.stderr()).toContain('launchd')
    expect(h.stderr()).toContain('Task Scheduler')
    expect(existsSync(unitPath('theoclaw', h.home))).toBe(false)
    expect(h.calls).toEqual([])
  })

  it('daemon removes the unit again when systemctl refuses to start it', async () => {
    const h = harness({ answers: { 'systemctl enable': [{ code: 1, stderr: 'Failed to enable unit: boom' }] } })
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('Failed to enable unit: boom')
    expect(existsSync(unitPath('theoclaw', h.home))).toBe(false)
    expect(systemctl(h).at(-1)).toBe('--user daemon-reload')
  })

  it('uninstall disables, removes the unit and reloads', async () => {
    const h = harness()
    await daemonInstall(h.io, h.runner)
    h.calls.length = 0

    expect(await daemonUninstall(h.io, h.runner)).toBe(0)
    expect(existsSync(unitPath('theoclaw', h.home))).toBe(false)
    expect(systemctl(h)).toEqual(['--user disable --now theoclaw.service', '--user daemon-reload'])
  })

  it('daemon writes an absolute configuration path', async () => {
    const h = harness({ env: { THEOCLAW_CONFIG: 'config/theoclaw/theoclaw.env' } })
    expect(await daemonInstall(h.io, h.runner)).toBe(0)
    const unitEnv = unitEnvironment(readFileSync(unitPath('theoclaw', h.home), 'utf8'))
    expect(unitEnv.THEOCLAW_CONFIG!.startsWith('/')).toBe(true)
    expect(unitEnv.THEOCLAW_CONFIG).toBe(join(h.home, 'config', 'theoclaw', 'theoclaw.env'))
  })

  it('install names enable-linger when lingering is off', async () => {
    const off = harness({ answers: { 'loginctl show-user': [{ stdout: 'Linger=no\n' }] } })
    expect(await daemonInstall(off.io, off.runner)).toBe(0)
    expect(off.stdout()).toContain('loginctl enable-linger')
    expect(off.calls.find((call) => call.command === 'loginctl')?.args).toEqual(['show-user', 'someone', '-p', 'Linger'])

    const on = harness({ answers: { 'loginctl show-user': [{ stdout: 'Linger=yes\n' }] } })
    await daemonInstall(on.io, on.runner)
    expect(on.stdout()).not.toContain('enable-linger')
  })

  it('status exits 0 when the unit is active and 3 otherwise', async () => {
    const h = harness({
      env: { THEOCLAW_PROFILE: 'work' },
      answers: { 'systemctl is-active': [{ stdout: 'active\n' }, { code: 3, stdout: 'inactive\n' }] },
    })
    const codes = [await daemonStatus(h.io, h.runner), await daemonStatus(h.io, h.runner)]
    expect(codes).toEqual([0, 3])
    expect(systemctl(h)).toEqual(['--user is-active theoclaw-work.service', '--user is-active theoclaw-work.service'])
  })

  it('a profiled unit names its profile and a path with a space is quoted', () => {
    const unit = unitFor({ label: 'theoclaw-a', nodePath: '/opt/my node/node', entryPath: '/srv/x/main.js', configPath: '/c/a b.env', profile: 'a', workingDirectory: '/w' })
    expect(unit).toContain('ExecStart="/opt/my node/node" /srv/x/main.js')
    expect(unit).toContain('Environment="THEOCLAW_CONFIG=/c/a b.env"')
    expect(unit).toContain('Environment=THEOCLAW_PROFILE=a')
    expect(unit).toContain('Description=TheoClaw (theoclaw-a)')
    // systemd expands $VAR and %specifiers in both lines, so a literal one is doubled.
    const dollar = unitFor({ label: 'theoclaw', nodePath: '/n/$HOME/node', entryPath: '/e/100%/main.js', configPath: '/c.env', workingDirectory: '/w' })
    expect(dollar).toContain('ExecStart=/n/$$HOME/node /e/100%%/main.js')
  })
})
