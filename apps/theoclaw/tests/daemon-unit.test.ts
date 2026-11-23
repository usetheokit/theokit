import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { daemonInstall, definitionPath } from '../src/daemon.js'
import { harness, systemctl } from './support/daemon-harness.js'

const unitPath = (label: string, home: string): string => definitionPath('linux', label, home)

describe('theoclaw daemon unit file', () => {
  it('writes the unit with the mode the umask allows, also when it puts the previous unit back', async () => {
    const old = process.umask(0o077)
    try {
      const h = harness({ answers: { 'systemctl restart': [{}, { code: 1, stderr: 'Job failed' }] } })
      expect(await daemonInstall(h.io, h.runner)).toBe(0)
      const path = unitPath('theoclaw', h.home)
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(await daemonInstall({ ...h.io, nodePath: '/opt/other/node' }, h.runner)).toBe(1)
      expect(statSync(path).mode & 0o777).toBe(0o600)
    } finally {
      process.umask(old)
    }
  })

  it('daemon refuses a missing built entry and writes no unit', async () => {
    const h = harness()
    rmSync(h.io.entry)
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain(h.io.entry)
    expect(h.stderr()).toContain('build TheoClaw first')
    expect(existsSync(unitPath('theoclaw', h.home))).toBe(false)
    expect(h.calls).toEqual([])
  })

  it('a reinstall that systemctl refuses puts the previous unit back', async () => {
    const h = harness({ answers: { 'systemctl restart': [{}, { code: 1, stderr: 'Job failed' }] } })
    expect(await daemonInstall(h.io, h.runner)).toBe(0)
    const previous = readFileSync(unitPath('theoclaw', h.home), 'utf8')

    const moved = { ...h.io, nodePath: '/opt/other/node' }
    expect(await daemonInstall(moved, h.runner)).toBe(1)
    expect(h.stderr()).toContain('Job failed')
    expect(readFileSync(unitPath('theoclaw', h.home), 'utf8')).toBe(previous)
    expect(systemctl(h).at(-1)).toBe('--user daemon-reload')
  })

  it('a profiled unit works in the profile workspace when the file names none', async () => {
    const h = harness({ env: { THEOCLAW_PROFILE: 'a' }, workspace: false })
    expect(await daemonInstall(h.io, h.runner)).toBe(0)
    const unit = readFileSync(unitPath('theoclaw-a', h.home), 'utf8')
    expect(unit).toMatch(new RegExp(`^WorkingDirectory=${join(h.home, '.theokit', 'profiles', 'a', 'workspace')}$`, 'm'))
  })
})
