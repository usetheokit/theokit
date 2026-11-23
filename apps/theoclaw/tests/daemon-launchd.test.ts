import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { daemonInstall, daemonRestart, daemonStatus, daemonUninstall, definitionPath } from '../src/daemon.js'
import { type Harness, harness } from './support/daemon-harness.js'

const UID = 501
const plistPath = (label: string, home: string): string => definitionPath('darwin', label, home)

function launchctl(h: Harness): string[] {
  return h.calls.filter((call) => call.command === 'launchctl').map((call) => call.args.join(' '))
}

// The plist text, the bootout rules and the rollback are the package's (`@theokit/host/service`); these cover the mapping.
describe('theoclaw daemon on macOS (launchd)', () => {
  it('the plist runs the built entry with the configuration file and logs where `theoclaw logs` reads', async () => {
    const old = process.umask(0o077)
    try {
      const h = harness({ platform: 'darwin', uid: UID, env: { THEOCLAW_PROFILE: 'work' } })
      expect(await daemonInstall(h.io, h.runner)).toBe(0)
      const path = plistPath('theoclaw-work', h.home)
      const plist = readFileSync(path, 'utf8')
      expect(path).toBe(join(h.home, 'Library', 'LaunchAgents', 'theoclaw-work.plist'))
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(plist).toContain(`<string>${h.io.nodePath}</string>`)
      expect(plist).toContain(`<string>${h.io.entry}</string>`)
      expect(plist).toContain('<key>THEOCLAW_CONFIG</key>')
      expect(plist).toContain('<key>THEOCLAW_PROFILE</key>')
      expect(plist).toContain('<key>SuccessfulExit</key>\n    <false/>')
      expect(plist).toContain(join(h.home, 'Library', 'Logs', 'theoclaw', 'theoclaw-work.log'))
      expect(launchctl(h)).toEqual([`bootout gui/${UID}/theoclaw-work`, `bootstrap gui/${UID} ${path}`])
    } finally {
      process.umask(old)
    }
  })

  it('a refused bootstrap removes the plist and exits 1', async () => {
    const h = harness({ platform: 'darwin', uid: UID, answers: { 'launchctl bootstrap': [{ code: 5, stderr: 'Bootstrap failed: 5: Input/output error' }] } })
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('Bootstrap failed: 5: Input/output error')
    expect(existsSync(plistPath('theoclaw', h.home))).toBe(false)
  })

  it('uninstall boots out and removes the plist; status maps launchctl print; restart kickstarts', async () => {
    const h = harness({ platform: 'darwin', uid: UID })
    await daemonInstall(h.io, h.runner)
    h.calls.length = 0
    expect(await daemonUninstall(h.io, h.runner)).toBe(0)
    expect(launchctl(h)).toEqual([`bootout gui/${UID}/theoclaw`])
    expect(existsSync(plistPath('theoclaw', h.home))).toBe(false)

    const state = async (answer: { code?: number; stdout?: string }): Promise<{ exit: number; out: string }> => {
      const s = harness({ platform: 'darwin', uid: UID, answers: { 'launchctl print': [answer] } })
      return { exit: await daemonStatus(s.io, s.runner), out: s.stdout() }
    }
    expect(await state({ stdout: '\tstate = running\n' })).toEqual({ exit: 0, out: 'theoclaw: running\n' })
    expect(await state({ stdout: '\tstate = waiting\n' })).toEqual({ exit: 3, out: 'theoclaw: stopped\n' })
    expect(await state({ code: 113 })).toEqual({ exit: 3, out: 'theoclaw: not-installed\n' })

    const r = harness({ platform: 'darwin', uid: UID })
    expect(await daemonRestart(r.io, r.runner)).toBe(0)
    expect(launchctl(r)).toEqual([`kickstart -k gui/${UID}/theoclaw`])
  })

  it('darwin without a user id is refused', async () => {
    const h = harness({ platform: 'darwin' })
    for (const verb of [daemonInstall, daemonUninstall, daemonStatus, daemonRestart]) expect(await verb(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('user id')
    expect(existsSync(plistPath('theoclaw', h.home))).toBe(false)
    expect(h.calls).toEqual([])
  })

  it('a bootout refusal keeps the plist and shows the diagnostic', async () => {
    const h = harness({
      platform: 'darwin',
      uid: UID,
      answers: {
        'launchctl bootout': [{}, { code: 1, stderr: 'Boot-out failed: Operation not permitted' }],
        'launchctl print': [{ code: 0, stdout: '\tstate = running\n' }],
      },
    })
    await daemonInstall(h.io, h.runner)
    expect(await daemonUninstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('Boot-out failed: Operation not permitted')
    expect(h.stdout()).not.toContain('removed')
    expect(existsSync(plistPath('theoclaw', h.home))).toBe(true)
  })
})
