import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { daemonInstall, unitFor, unitPath } from '../src/daemon.js'
import { harness, systemctl } from './support/daemon-harness.js'

describe('theoclaw daemon unit file', () => {
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

  it('Environment and WorkingDirectory keep a literal $ and WorkingDirectory is never quoted', () => {
    const unit = unitFor({ label: 'theoclaw', nodePath: '/n', entryPath: '/e', configPath: '/c/$x b.env', workingDirectory: '/home/a b/100%' })
    // systemd.exec(5): Environment= expands no variable and WorkingDirectory= removes no quotes.
    expect(unit).toContain('Environment="THEOCLAW_CONFIG=/c/$x b.env"')
    expect(unit).toMatch(/^WorkingDirectory=\/home\/a b\/100%%$/m)
  })

  it('a value holding a line break is refused, since it would end the directive', () => {
    for (const bad of [{ nodePath: '/n\nExecStartPre=/x' }, { configPath: '/c\r.env' }, { workingDirectory: '/w\n' }]) {
      expect(() => unitFor({ label: 'theoclaw', nodePath: '/n', entryPath: '/e', configPath: '/c', workingDirectory: '/w', ...bad })).toThrow(/line break/)
    }
  })
})
