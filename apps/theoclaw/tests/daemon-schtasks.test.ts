import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { daemonInstall, daemonStatus, daemonUninstall } from '../src/daemon.js'
import type { Runner } from '../src/run-command.js'
import { type Harness, harness } from './support/daemon-harness.js'

const WINDOWS_ENV = { USERNAME: 'dev', USERDOMAIN: 'BOX' }

function schtasks(h: Harness): string[] {
  return h.calls.filter((call) => call.command === 'schtasks').map((call) => call.args.join(' '))
}

/** Wraps the runner so the temporary XML a `/Create` names is read before install removes it. */
function capturing(h: Harness): { runner: Runner; xml: () => string | undefined; path: () => string | undefined } {
  let xml: string | undefined
  let path: string | undefined
  const runner: Runner = (command, args) => {
    if (command === 'schtasks' && args[0] === '/Create') {
      path = args[args.indexOf('/XML') + 1]
      const bytes = readFileSync(path!)
      expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe])
      xml = bytes.subarray(2).toString('utf16le')
    }
    return h.runner(command, args)
  }
  return { runner, xml: () => xml, path: () => path }
}

describe('theoclaw daemon on Windows (Task Scheduler)', () => {
  it('the_task_xml_is_utf_16_with_no_time_limit_and_passes_the_configuration_as_an_argument', async () => {
    const h = harness({ platform: 'win32', env: { ...WINDOWS_ENV, THEOCLAW_PROFILE: 'work' } })
    const c = capturing(h)
    expect(await daemonInstall(h.io, c.runner)).toBe(0)
    const xml = c.xml()!
    expect(xml).toContain('<LogonTrigger>')
    expect(xml).toContain('<UserId>BOX\\dev</UserId>')
    expect(xml).toContain('<LogonType>InteractiveToken</LogonType>')
    expect(xml).toContain('<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>')
    expect(xml).toContain('<RestartOnFailure>')
    expect(xml).toContain(`<Command>${h.io.nodePath}</Command>`)
    expect(xml).toMatch(/<Arguments>&quot;.*main\.js&quot; --config &quot;.*theoclaw-work\.env&quot; --profile work<\/Arguments>/)
    expect(schtasks(h).map((line) => line.split(' ').slice(0, 3).join(' '))).toEqual(['/End /TN theoclaw-work', '/Create /TN theoclaw-work', '/Run /TN theoclaw-work'])
    expect(existsSync(c.path()!)).toBe(false)
    expect(h.stdout()).not.toContain('OPENROUTER')
  })

  it('a_refused_create_deletes_the_task_and_the_temporary_xml', async () => {
    const h = harness({ platform: 'win32', env: WINDOWS_ENV, answers: { 'schtasks /Create': [{ code: 1, stderr: 'ERROR: Access is denied.' }] } })
    const c = capturing(h)
    expect(await daemonInstall(h.io, c.runner)).toBe(1)
    expect(h.stderr()).toContain('schtasks /Create failed: ERROR: Access is denied.')
    expect(schtasks(h).at(-1)).toBe('/Delete /TN theoclaw /F')
    expect(schtasks(h).some((line) => line.startsWith('/Run'))).toBe(false)
    expect(existsSync(c.path()!)).toBe(false)

    const run = harness({ platform: 'win32', env: WINDOWS_ENV, answers: { 'schtasks /Run': [{ code: 1, stderr: 'ERROR: cannot start' }] } })
    expect(await daemonInstall(run.io, run.runner)).toBe(1)
    expect(run.stderr()).toContain('schtasks /Run failed: ERROR: cannot start')
    expect(schtasks(run).at(-1)).toBe('/Delete /TN theoclaw /F')
  })

  it('uninstall_deletes_the_task_and_status_reads_the_scheduled_task_state', async () => {
    const h = harness({ platform: 'win32', env: WINDOWS_ENV })
    expect(await daemonUninstall(h.io, h.runner)).toBe(0)
    expect(schtasks(h)).toEqual(['/End /TN theoclaw', '/Delete /TN theoclaw /F'])

    const gone = harness({ platform: 'win32', env: WINDOWS_ENV, answers: { 'schtasks /Delete': [{ code: 1, stderr: 'not found' }], 'schtasks /Query': [{ code: 1 }] } })
    expect(await daemonUninstall(gone.io, gone.runner)).toBe(0)
    const stuck = harness({ platform: 'win32', env: WINDOWS_ENV, answers: { 'schtasks /Delete': [{ code: 1, stderr: 'Access is denied' }] } })
    expect(await daemonUninstall(stuck.io, stuck.runner)).toBe(1)
    expect(stuck.stderr()).toContain('schtasks /Delete failed: Access is denied')

    const state = async (stdout: string, code = 0): Promise<{ exit: number; out: string; call: string }> => {
      const s = harness({ platform: 'win32', env: WINDOWS_ENV, answers: { 'powershell.exe -NoProfile': [{ code, stdout }] } })
      return { exit: await daemonStatus(s.io, s.runner), out: s.stdout(), call: s.calls[0]!.args.join(' ') }
    }
    const running = await state('Running\r\n')
    expect(running).toMatchObject({ exit: 0, out: 'theoclaw: Running\n' })
    expect(running.call).toContain("Get-ScheduledTask -TaskName 'theoclaw'")
    expect(await state('Ready\r\n')).toMatchObject({ exit: 3, out: 'theoclaw: Ready\n' })
    expect(await state('', 1)).toMatchObject({ exit: 3, out: 'theoclaw: not installed\n' })
  })

  it('username_unset_is_refused', async () => {
    const h = harness({ platform: 'win32' })
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('USERNAME')
    expect(h.calls).toEqual([])
  })

  it('schtasks_cannot_start_leaves_nothing', async () => {
    const answers = { 'schtasks /End': [{ code: 127 }], 'schtasks /Create': [{ code: 127, stderr: 'spawn schtasks ENOENT' }], 'schtasks /Delete': [{ code: 127 }], 'powershell.exe -NoProfile': [{ code: 127 }] }
    const h = harness({ platform: 'win32', env: WINDOWS_ENV, answers })
    const c = capturing(h)
    expect(await daemonInstall(h.io, c.runner)).toBe(1)
    expect(existsSync(c.path()!)).toBe(false)
    expect(await daemonStatus(h.io, h.runner)).toBe(3)
  })
})
