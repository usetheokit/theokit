import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { configurationPath } from '../src/config-file.js'
import { daemonInstall, daemonRestart, daemonStatus, daemonUninstall } from '../src/daemon.js'
import type { Runner } from '../src/run-command.js'
import { type Harness, harness } from './support/daemon-harness.js'

const WINDOWS_ENV = { USERNAME: 'dev', USERDOMAIN: 'BOX' }

function schtasks(h: Harness): string[] {
  return h.calls.filter((call) => call.command === 'schtasks').map((call) => call.args.join(' '))
}

/** Wraps the runner so the temporary XML a `/Create` names is read before install removes it. */
function capturing(h: Harness): {
  runner: Runner
  xml: () => string | undefined
  path: () => string | undefined
} {
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

/** The XML sits in a fresh directory of its own under the temp directory, and that directory is gone. */
function expectPrivateDirGone(path: string): void {
  const dir = dirname(path)
  expect(dirname(dir)).toBe(tmpdir())
  expect(dir).toMatch(/theokit-task-.{6}$/)
  expect(existsSync(dir)).toBe(false)
}

describe('theoclaw daemon on Windows (Task Scheduler)', () => {
  it('a_relative_config_path_is_written_resolved_against_the_working_directory', async () => {
    const h = harness({ platform: 'win32', env: { ...WINDOWS_ENV, THEOCLAW_CONFIG: 'conf/custom.env' } })
    mkdirSync(join(h.io.cwd, 'conf'), { recursive: true })
    writeFileSync(join(h.io.cwd, 'conf', 'custom.env'), 'THEOCLAW_MODEL="m"\n')
    const c = capturing(h)
    expect(await daemonInstall(h.io, c.runner)).toBe(0)
    const args = /<Arguments>(.*)<\/Arguments>/.exec(c.xml()!)![1]!
    expect(args).toContain(join(h.io.cwd, 'conf', 'custom.env'))
    expect(args).not.toContain('--config conf')
  })

  it('the_task_arguments_keep_the_absolute_config_path_and_profile', async () => {
    const h = harness({ platform: 'win32', env: { ...WINDOWS_ENV, THEOCLAW_PROFILE: 'work' } })
    const c = capturing(h)
    expect(await daemonInstall(h.io, c.runner)).toBe(0)
    const args = /<Arguments>(.*)<\/Arguments>/.exec(c.xml()!)![1]!
    expect(args).toContain(`--config`)
    expect(args).toContain(resolve(h.io.cwd, configurationPath(h.io.env, h.io.homeDir)).replaceAll('&', '&amp;'))
    expect(args).toContain('--profile work')
  })

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
    expect(xml).toMatch(/<Arguments>.*main\.js.* --config .*theoclaw-work\.env.* --profile work<\/Arguments>/)
    expect(schtasks(h).map((line) => line.split(' ').slice(0, 3).join(' '))).toEqual([
      '/End /TN theoclaw-work',
      '/Create /TN theoclaw-work',
      '/Run /TN theoclaw-work',
    ])
    expect(existsSync(c.path()!)).toBe(false)
    expectPrivateDirGone(c.path()!)
    expect(h.stdout()).not.toContain('OPENROUTER')
  })

  it('a_refused_create_deletes_the_task_and_the_temporary_xml', async () => {
    const h = harness({
      platform: 'win32',
      env: WINDOWS_ENV,
      answers: { 'schtasks /Create': [{ code: 1, stderr: 'ERROR: Access is denied.' }] },
    })
    const c = capturing(h)
    expect(await daemonInstall(h.io, c.runner)).toBe(1)
    expect(h.stderr()).toContain('schtasks /Create')
    expect(h.stderr()).toContain('ERROR: Access is denied.')
    expect(schtasks(h).at(-1)).toBe('/Delete /TN theoclaw /F')
    expect(schtasks(h).some((line) => line.startsWith('/Run'))).toBe(false)
    expect(existsSync(c.path()!)).toBe(false)
    expectPrivateDirGone(c.path()!)

    const run = harness({
      platform: 'win32',
      env: WINDOWS_ENV,
      answers: { 'schtasks /Run': [{ code: 1, stderr: 'ERROR: cannot start' }] },
    })
    expect(await daemonInstall(run.io, run.runner)).toBe(1)
    expect(run.stderr()).toContain('schtasks /Run')
    expect(run.stderr()).toContain('ERROR: cannot start')
    expect(schtasks(run).at(-1)).toBe('/Delete /TN theoclaw /F')
  })

  it('uninstall_stops_the_task_process_tree_read_before_end_and_refuses_to_delete_with_survivors', async () => {
    const h = harness({
      platform: 'win32',
      env: { ...WINDOWS_ENV, THEOCLAW_PROFILE: 'ox' },
      answers: { 'powershell.exe -NoProfile': [{ stdout: '11,12\r\n' }, { stdout: '12\r\n' }] },
    })
    // A task whose processes are still alive is not deleted: the package fails before `/Delete`.
    expect(await daemonUninstall(h.io, h.runner)).toBe(1)
    const order = h.calls.map((call) => `${call.command} ${call.args[0]}`)
    expect(order).toEqual([
      'powershell.exe -NoProfile',
      'schtasks /End',
      'powershell.exe -NoProfile',
    ])
    const [find, stop] = h.calls.filter((call) => call.command === 'powershell.exe').map((c) => c.args.at(-1)!)
    expect(find).toContain("Get-ScheduledTask -TaskName 'theoclaw-ox'")
    expect(stop).toContain('$ids = @(11,12)')
    expect(h.stderr()).toContain('processes 12 of theoclaw-ox')
  })

  it('uninstall_deletes_the_task_and_status_reads_the_scheduled_task_state', async () => {
    const h = harness({ platform: 'win32', env: WINDOWS_ENV })
    expect(await daemonUninstall(h.io, h.runner)).toBe(0)
    expect(schtasks(h)).toEqual(['/End /TN theoclaw', '/Delete /TN theoclaw /F'])

    const gone = harness({
      platform: 'win32',
      env: WINDOWS_ENV,
      answers: {
        'schtasks /Delete': [{ code: 1, stderr: 'not found' }],
        'powershell.exe -NoProfile': [{ stdout: '' }, { stdout: 'absent\r\n' }],
      },
    })
    expect(await daemonUninstall(gone.io, gone.runner)).toBe(0)
    const stuck = harness({
      platform: 'win32',
      env: WINDOWS_ENV,
      answers: {
        'schtasks /Delete': [{ code: 1, stderr: 'Access is denied' }],
        'powershell.exe -NoProfile': [{ stdout: '' }, { stdout: 'present\r\n' }],
      },
    })
    expect(await daemonUninstall(stuck.io, stuck.runner)).toBe(1)
    expect(stuck.stderr()).toContain('schtasks /Delete')
    expect(stuck.stderr()).toContain('Access is denied')

    const state = async (
      stdout: string,
      code = 0,
    ): Promise<{ exit: number; out: string; call: string }> => {
      const s = harness({
        platform: 'win32',
        env: WINDOWS_ENV,
        answers: { 'powershell.exe -NoProfile': [{ code, stdout }] },
      })
      return {
        exit: await daemonStatus(s.io, s.runner),
        out: s.stdout(),
        call: s.calls[0]!.args.join(' '),
      }
    }
    const running = await state('Running\r\n')
    expect(running).toMatchObject({ exit: 0, out: 'theoclaw: running\n' })
    expect(running.call).toContain("Get-ScheduledTask -TaskName 'theoclaw'")
    expect(await state('Ready\r\n')).toMatchObject({ exit: 3, out: 'theoclaw: stopped\n' })
    expect(await state('', 1)).toMatchObject({ exit: 3, out: 'theoclaw: unknown\n' })
  })

  it('username_unset_is_refused', async () => {
    const h = harness({ platform: 'win32' })
    expect(await daemonInstall(h.io, h.runner)).toBe(1)
    expect(h.stderr()).toContain('USERNAME')
    expect(h.calls).toEqual([])
  })

  it('schtasks_cannot_start_leaves_nothing', async () => {
    const answers = {
      'schtasks /End': [{ code: 127 }],
      'schtasks /Create': [{ code: 127, stderr: 'spawn schtasks ENOENT' }],
      'schtasks /Delete': [{ code: 127 }],
      'powershell.exe -NoProfile': [{ code: 127 }],
    }
    const h = harness({ platform: 'win32', env: WINDOWS_ENV, answers })
    const c = capturing(h)
    expect(await daemonInstall(h.io, c.runner)).toBe(1)
    expect(existsSync(c.path()!)).toBe(false)
    expect(await daemonStatus(h.io, h.runner)).toBe(3)
  })

  // usetheokit/theokit#1142: a command that cannot start is reported as 127. Uninstall read the
  // failed /Query as proof that the task was gone, and printed "removed" for a task it never touched.
  describe('uninstall when schtasks cannot be run', () => {
    const cannotStart = { code: 127, stderr: 'schtasks unavailable' }

    it('fails_and_shows_the_diagnostic_instead_of_reporting_a_removal', async () => {
      const h = harness({
        platform: 'win32',
        env: WINDOWS_ENV,
        answers: {
          'schtasks /End': [cannotStart],
          'schtasks /Delete': [cannotStart],
          'schtasks /Query': [cannotStart],
          'powershell.exe -NoProfile': [{ code: 127, stderr: 'powershell unavailable' }],
        },
      })

      expect(await daemonUninstall(h.io, h.runner)).toBe(1)
      // The package reads the task's processes first, and that failure stops the uninstall.
      expect(h.stderr()).toContain('powershell unavailable')
      expect(h.stdout()).not.toContain('removed')
    })

    it('does_not_take_a_failed_query_for_an_absent_task', async () => {
      const h = harness({
        platform: 'win32',
        env: WINDOWS_ENV,
        answers: {
          'schtasks /Delete': [{ code: 1, stderr: 'ERROR: Access is denied.' }],
          'powershell.exe -NoProfile': [{ stdout: '' }, { code: 1, stderr: 'query failed' }],
        },
      })

      expect(await daemonUninstall(h.io, h.runner)).toBe(1)
      expect(h.stderr()).toContain('schtasks /Delete')
      expect(h.stderr()).toContain('ERROR: Access is denied.')
      expect(h.stdout()).not.toContain('removed')
    })

    it('asks_for_the_task_by_name_and_without_depending_on_the_language_of_the_message', async () => {
      const h = harness({
        platform: 'win32',
        env: WINDOWS_ENV,
        answers: {
          'schtasks /Delete': [
            { code: 1, stderr: 'ERRO: O sistema nao pode encontrar o arquivo especificado.' },
          ],
          'powershell.exe -NoProfile': [{ stdout: '' }, { stdout: 'absent\r\n' }],
        },
      })

      expect(await daemonUninstall(h.io, h.runner)).toBe(0)
      const query = h.calls.find(
        (call) => call.command === 'powershell.exe' && call.args.join(' ').includes('if (Get-ScheduledTask'),
      )
      expect(query?.args.join(' ')).toContain("Get-ScheduledTask -TaskName 'theoclaw'")
    })

    it('a_task_that_was_deleted_needs_no_second_look', async () => {
      const h = harness({ platform: 'win32', env: WINDOWS_ENV })
      expect(await daemonUninstall(h.io, h.runner)).toBe(0)
      expect(h.calls.some((call) => call.args.join(' ').includes('if (Get-ScheduledTask'))).toBe(false)
    })
  })

  it('restart_ends_and_runs_the_task', async () => {
    const h = harness({ platform: 'win32', env: WINDOWS_ENV })
    expect(await daemonRestart(h.io, h.runner)).toBe(0)
    expect(schtasks(h)).toEqual(['/End /TN theoclaw', '/Run /TN theoclaw'])
  })
})
