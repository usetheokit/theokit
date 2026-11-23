import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { systemdUnit } from '@theokit/host/service'
import { describe, expect, it } from 'vitest'

import { daemonInstall, daemonRestart, daemonStatus, daemonUninstall, definitionPath } from '../src/daemon.js'
import { harness, systemctl, unitEnvironment } from './support/daemon-harness.js'

const unitPath = (label: string, home: string): string => definitionPath('linux', label, home)

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
    expect(systemctl(h)).toEqual(['--user daemon-reload', '--user enable --now -- theoclaw.service', '--user restart -- theoclaw.service'])
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
    for (const verb of [daemonInstall, daemonUninstall, daemonStatus, daemonRestart]) expect(await verb(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('freebsd is not supported')
    expect(h.stderr()).toContain('launchd')
    expect(h.stderr()).toContain('Task Scheduler')
    expect(existsSync(unitPath('theoclaw', h.home))).toBe(false)
    expect(h.calls).toEqual([])
  })

  it('darwin_and_win32_are_dispatched_to_a_backend_not_refused_as_unsupported', async () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const h = harness({ platform, uid: 501, env: { USERNAME: 'dev' } })
      await daemonStatus(h.io, h.runner)
      expect(h.stderr(), platform).not.toContain('is not supported')
      expect(h.calls.length, platform).toBe(1)
    }
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
    expect(systemctl(h)).toEqual(['--user disable --now -- theoclaw.service', '--user daemon-reload'])
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
    await daemonInstall(h.io, h.runner)
    h.calls.length = 0
    const codes = [await daemonStatus(h.io, h.runner), await daemonStatus(h.io, h.runner)]
    expect(codes).toEqual([0, 3])
    expect(systemctl(h)).toEqual(['--user is-active -- theoclaw-work.service', '--user is-active -- theoclaw-work.service'])
  })

  it('status says not installed for a service with no unit', async () => {
    const h = harness()
    expect(await daemonStatus(h.io, h.runner)).toBe(3)
    expect(h.stdout()).toBe('theoclaw: not-installed\n')
    expect(h.calls).toEqual([])
  })

  it('restart asks the service manager to restart the instance and reports a refusal', async () => {
    const h = harness({ env: { THEOCLAW_PROFILE: 'work' } })
    expect(await daemonRestart(h.io, h.runner)).toBe(0)
    expect(systemctl(h)).toEqual(['--user restart -- theoclaw-work.service'])
    expect(h.stdout()).toContain('theoclaw-work restarted')

    const refused = harness({ answers: { 'systemctl restart': [{ code: 5, stderr: 'Unit not found' }] } })
    expect(await daemonRestart(refused.io, refused.runner)).toBe(1)
    expect(refused.stderr()).toContain('Unit not found')
  })

  it('a profiled unit names its profile and a path with a space is quoted', () => {
    const unit = systemdUnit({ label: 'theoclaw-a', description: 'TheoClaw (theoclaw-a)', command: '/opt/my node/node', args: ['/srv/x/main.js'], env: { THEOCLAW_CONFIG: '/c/a b.env', THEOCLAW_PROFILE: 'a' }, workingDirectory: '/w' })
    expect(unit).toContain('ExecStart="/opt/my node/node" /srv/x/main.js')
    expect(unit).toContain('Environment="THEOCLAW_CONFIG=/c/a b.env"')
    expect(unit).toContain('Environment=THEOCLAW_PROFILE=a')
    expect(unit).toContain('Description=TheoClaw (theoclaw-a)')
    // ExecStart= expands $VAR and %specifiers, so a literal one is doubled there.
    const dollar = systemdUnit({ label: 'theoclaw', command: '/n/$HOME/node', args: ['/e/100%/main.js'], workingDirectory: '/w' })
    expect(dollar).toContain('ExecStart=/n/$$HOME/node /e/100%%/main.js')
  })

  it('the installed unit passes the entry as an argument and names the profile in the environment', async () => {
    const h = harness({ env: { THEOCLAW_PROFILE: 'a' } })
    expect(await daemonInstall({ ...h.io, nodePath: '/opt/my node/node' }, h.runner)).toBe(0)
    const unit = readFileSync(unitPath('theoclaw-a', h.home), 'utf8')
    expect(unit).toContain(`ExecStart="/opt/my node/node" ${h.io.entry}`)
    expect(unitEnvironment(unit).THEOCLAW_PROFILE).toBe('a')
    expect(unit).toContain('Description=TheoClaw (theoclaw-a)')
  })
})
