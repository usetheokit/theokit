import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { daemonInstall, daemonRestart, daemonStatus, daemonUninstall } from '../src/daemon.js'
import type { Runner } from '../src/run-command.js'
import { type Harness, harness } from './support/daemon-harness.js'

const WINDOWS_ENV = { USERNAME: 'dev', USERDOMAIN: 'BOX' }

function schtasks(h: Harness): string[] {
  return h.calls.filter((call) => call.command === 'schtasks').map((call) => call.args.join(' '))
}

/** Wraps the runner so the temporary XML a `/Create` names is read before install removes it. */
function capturing(h: Harness): { runner: Runner; xml: () => string | undefined } {
  let xml: string | undefined
  const runner: Runner = (command, args) => {
    if (command === 'schtasks' && args[0] === '/Create') {
      xml = readFileSync(args[args.indexOf('/XML') + 1]!).subarray(2).toString('utf16le')
    }
    return h.runner(command, args)
  }
  return { runner, xml: () => xml }
}

// The task XML, the process-tree stop and the delete rules are the package's (`@theokit/host/service`); these cover the mapping.
describe('theoclaw daemon on Windows (Task Scheduler)', () => {
  it('the task passes the configuration and profile as arguments, since a task has no environment', async () => {
    const h = harness({ platform: 'win32', env: { ...WINDOWS_ENV, THEOCLAW_PROFILE: 'work' } })
    const c = capturing(h)
    expect(await daemonInstall(h.io, c.runner)).toBe(0)
    const xml = c.xml()!
    expect(xml).toContain('<UserId>BOX\\dev</UserId>')
    expect(xml).toContain(`<Command>${h.io.nodePath}</Command>`)
    expect(xml).toMatch(/<Arguments>.*main\.js.* --config .*theoclaw-work\.env.* --profile work<\/Arguments>/)
    expect(schtasks(h).map((line) => line.split(' ').slice(0, 3).join(' '))).toEqual(['/End /TN theoclaw-work', '/Create /TN theoclaw-work', '/Run /TN theoclaw-work'])
  })

  it('a refused create deletes the task and exits 1', async () => {
    const h = harness({ platform: 'win32', env: WINDOWS_ENV, answers: { 'schtasks /Create': [{ code: 1, stderr: 'ERROR: Access is denied.' }] } })
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('ERROR: Access is denied.')
    expect(schtasks(h).at(-1)).toBe('/Delete /TN theoclaw /F')
  })

  it('uninstall deletes the task, restart ends and runs it, status reads the scheduled task state', async () => {
    const h = harness({ platform: 'win32', env: WINDOWS_ENV })
    expect(await daemonUninstall(h.io, h.runner)).toBe(0)
    expect(schtasks(h)).toEqual(['/End /TN theoclaw', '/Delete /TN theoclaw /F'])

    const r = harness({ platform: 'win32', env: WINDOWS_ENV })
    expect(await daemonRestart(r.io, r.runner)).toBe(0)
    expect(schtasks(r)).toEqual(['/End /TN theoclaw', '/Run /TN theoclaw'])

    const state = async (stdout: string): Promise<{ exit: number; out: string }> => {
      const s = harness({ platform: 'win32', env: WINDOWS_ENV, answers: { 'powershell.exe -NoProfile': [{ stdout }] } })
      return { exit: await daemonStatus(s.io, s.runner), out: s.stdout() }
    }
    expect(await state('Running\r\n')).toEqual({ exit: 0, out: 'theoclaw: running\n' })
    expect(await state('Ready\r\n')).toEqual({ exit: 3, out: 'theoclaw: stopped\n' })
  })

  it('a missing USERNAME is refused before anything runs', async () => {
    const h = harness({ platform: 'win32' })
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('USERNAME')
    expect(existsSync(h.io.entry)).toBe(true)
    expect(schtasks(h)).toEqual([])
  })
})
