import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { daemonInstall, daemonStatus, daemonUninstall } from '../src/daemon.js'
import { plistPath } from '../src/daemon-launchd.js'
import { type Harness, harness } from './support/daemon-harness.js'

const UID = 501

function launchctl(h: Harness): string[] {
  return h.calls.filter((call) => call.command === 'launchctl').map((call) => call.args.join(' '))
}

describe('theoclaw daemon on macOS (launchd)', () => {
  it('the_plist_runs_the_built_entry_with_the_configuration_file', async () => {
    const h = harness({ platform: 'darwin', uid: UID, env: { THEOCLAW_PROFILE: 'work' } })
    expect(await daemonInstall(h.io, h.runner)).toBe(0)
    const path = plistPath('theoclaw-work', h.home)
    const plist = readFileSync(path, 'utf8')
    expect(path).toBe(join(h.home, 'Library', 'LaunchAgents', 'theoclaw-work.plist'))
    expect(plist).toContain('<string>theoclaw-work</string>')
    expect(plist).toContain(`<string>${h.io.nodePath}</string>`)
    expect(plist).toContain(`<string>${h.io.entry}</string>`)
    expect(plist).toContain('<key>THEOCLAW_CONFIG</key>')
    expect(plist).toContain('<key>THEOCLAW_PROFILE</key>')
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>')
    expect(plist).toContain('<key>SuccessfulExit</key>\n    <false/>')
    expect(plist).toContain(join(h.home, 'Library', 'Logs', 'theoclaw', 'theoclaw-work.log'))
    expect(launchctl(h)).toEqual([
      `bootout gui/${UID}/theoclaw-work`,
      `bootstrap gui/${UID} ${path}`,
    ])
    expect(h.stdout()).not.toContain('OPENROUTER')
  })

  it('a_refused_bootstrap_removes_the_plist_and_exits_1', async () => {
    const h = harness({
      platform: 'darwin',
      uid: UID,
      answers: {
        'launchctl bootstrap': [{ code: 5, stderr: 'Bootstrap failed: 5: Input/output error' }],
      },
    })
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain(
      'launchctl bootstrap failed: Bootstrap failed: 5: Input/output error',
    )
    expect(existsSync(plistPath('theoclaw', h.home))).toBe(false)
  })

  it('uninstall_boots_out_and_removes_the_plist_and_status_maps_launchctl_print', async () => {
    const h = harness({ platform: 'darwin', uid: UID })
    await daemonInstall(h.io, h.runner)
    h.calls.length = 0
    expect(await daemonUninstall(h.io, h.runner)).toBe(0)
    expect(launchctl(h)).toEqual([`bootout gui/${UID}/theoclaw`])
    expect(existsSync(plistPath('theoclaw', h.home))).toBe(false)

    const running = harness({
      platform: 'darwin',
      uid: UID,
      answers: { 'launchctl print': [{ stdout: '\tstate = running\n' }] },
    })
    expect(await daemonStatus(running.io, running.runner)).toBe(0)
    expect(running.stdout()).toBe('theoclaw: running\n')
    const loaded = harness({
      platform: 'darwin',
      uid: UID,
      answers: { 'launchctl print': [{ stdout: '\tstate = waiting\n' }] },
    })
    expect(await daemonStatus(loaded.io, loaded.runner)).toBe(3)
    expect(loaded.stdout()).toBe('theoclaw: not running\n')
    const absent = harness({
      platform: 'darwin',
      uid: UID,
      answers: { 'launchctl print': [{ code: 113, stderr: 'Could not find service' }] },
    })
    expect(await daemonStatus(absent.io, absent.runner)).toBe(3)
    expect(absent.stdout()).toBe('theoclaw: not loaded\n')
  })

  it('darwin_without_uid_is_refused', async () => {
    const h = harness({ platform: 'darwin' })
    for (const verb of [daemonInstall, daemonUninstall, daemonStatus])
      expect(await verb(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('user id')
    expect(existsSync(plistPath('theoclaw', h.home))).toBe(false)
    expect(h.calls).toEqual([])
  })

  it('launchctl_cannot_start_leaves_nothing', async () => {
    const answers = {
      'launchctl bootout': [{ code: 127 }],
      'launchctl bootstrap': [{ code: 127, stderr: 'spawn launchctl ENOENT' }],
      'launchctl print': [{ code: 127 }],
    }
    const h = harness({ platform: 'darwin', uid: UID, answers })
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(existsSync(plistPath('theoclaw', h.home))).toBe(false)
    expect(await daemonStatus(h.io, h.runner)).toBe(3)
  })

  // usetheokit/theokit#1141: the result of `bootout` was never read, so a refusal printed "removed",
  // deleted the plist and left the service running.
  describe('uninstall when bootout fails', () => {
    it('a_refused_bootout_fails_keeps_the_plist_and_shows_the_diagnostic', async () => {
      const h = harness({
        platform: 'darwin',
        uid: UID,
        answers: {
          'launchctl bootout': [{ code: 1, stderr: 'Boot-out failed: Operation not permitted' }],
          'launchctl print': [{ code: 0, stdout: '\tstate = running\n' }],
        },
      })
      mkdirSync(join(h.home, 'Library', 'LaunchAgents'), { recursive: true })
      writeFileSync(plistPath('theoclaw', h.home), 'previous definition')

      expect(await daemonUninstall(h.io, h.runner)).toBe(1)
      expect(h.stderr()).toContain(
        'launchctl bootout failed: Boot-out failed: Operation not permitted',
      )
      expect(h.stdout()).not.toContain('removed')
      expect(readFileSync(plistPath('theoclaw', h.home), 'utf8')).toBe('previous definition')
    })

    it('a_service_that_is_confirmed_absent_is_still_an_idempotent_success', async () => {
      const h = harness({
        platform: 'darwin',
        uid: UID,
        answers: {
          'launchctl bootout': [{ code: 3, stderr: 'Boot-out failed: 3: No such process' }],
          'launchctl print': [
            { code: 113, stderr: 'Could not find service "theoclaw" in domain for user gui: 501' },
          ],
        },
      })
      mkdirSync(join(h.home, 'Library', 'LaunchAgents'), { recursive: true })
      writeFileSync(plistPath('theoclaw', h.home), 'stale definition')

      expect(await daemonUninstall(h.io, h.runner)).toBe(0)
      expect(h.stdout()).toContain('theoclaw removed')
      expect(existsSync(plistPath('theoclaw', h.home))).toBe(false)
    })

    it('a_bootout_failure_that_cannot_be_checked_is_a_failure_not_an_absence', async () => {
      const h = harness({
        platform: 'darwin',
        uid: UID,
        answers: {
          'launchctl bootout': [{ code: 127, stderr: 'spawn launchctl ENOENT' }],
          'launchctl print': [{ code: 127, stderr: 'spawn launchctl ENOENT' }],
        },
      })
      mkdirSync(join(h.home, 'Library', 'LaunchAgents'), { recursive: true })
      writeFileSync(plistPath('theoclaw', h.home), 'previous definition')

      expect(await daemonUninstall(h.io, h.runner)).toBe(1)
      expect(h.stderr()).toContain('launchctl bootout failed: spawn launchctl ENOENT')
      expect(existsSync(plistPath('theoclaw', h.home))).toBe(true)
    })

    it('a_successful_bootout_does_not_query_launchd_again', async () => {
      const h = harness({ platform: 'darwin', uid: UID })
      expect(await daemonUninstall(h.io, h.runner)).toBe(0)
      expect(launchctl(h)).toEqual([`bootout gui/${UID}/theoclaw`])
    })
  })
})
