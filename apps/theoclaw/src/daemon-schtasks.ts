import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Numeric character references are valid in both XML service definitions.
import { escapeHtml as escapeXml } from 'theokit/server/security'

import {
  type DaemonBackend,
  type DaemonIo,
  type InstallTarget,
  type Runner,
  type RunResult,
} from './daemon-common.js'

/**
 * The Windows backend (B-692): a Task Scheduler task named by the instance label, registered from an
 * XML file, started at the owner's logon and restarted after a failure. A task carries no
 * environment, so the entry takes `--config` and `--profile` as arguments (`entry-arguments.ts`).
 */

/** The logon type of the task's principal; the one place D5 of the plan changes if the runner refuses it. */
const LOGON_TYPE = 'InteractiveToken'

export interface TaskInput extends Pick<
  InstallTarget,
  'label' | 'profile' | 'configPath' | 'workingDirectory'
> {
  readonly nodePath: string
  readonly entryPath: string
  /** `<USERDOMAIN>\<USERNAME>`, or the bare user name when the domain is unset. */
  readonly user: string
}

/** The command line the task runs: Windows quotes a path with double quotes, which XML text escapes. */
function taskArguments(input: TaskInput): string {
  const profile = input.profile === undefined ? '' : ` --profile ${input.profile}`
  return `"${input.entryPath}" --config "${input.configPath}"${profile}`
}

export function taskXml(input: TaskInput): string {
  const user = escapeXml(input.user)
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    `  <RegistrationInfo><Description>TheoClaw (${escapeXml(input.label)})</Description></RegistrationInfo>`,
    `  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${user}</UserId></LogonTrigger></Triggers>`,
    `  <Principals><Principal id="Author"><UserId>${user}</UserId><LogonType>${LOGON_TYPE}</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    // The scheduler's default of 72 hours would stop a server that is meant to run until logoff.
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>',
    '  </Settings>',
    '  <Actions Context="Author"><Exec>',
    `    <Command>${escapeXml(input.nodePath)}</Command>`,
    `    <Arguments>${escapeXml(taskArguments(input))}</Arguments>`,
    `    <WorkingDirectory>${escapeXml(input.workingDirectory)}</WorkingDirectory>`,
    '  </Exec></Actions>',
    '</Task>',
    '',
  ].join('\r\n')
}

function schtasks(runner: Runner, ...args: string[]): Promise<RunResult> {
  return runner('schtasks', args)
}

/** The user the task runs as, or undefined after naming the missing variable. */
function taskUser(io: DaemonIo): string | undefined {
  const name = io.env.USERNAME
  if (name === undefined || name === '') {
    io.stderr.write(
      'theoclaw daemon: USERNAME is not set; Task Scheduler needs the user the task runs as\n',
    )
    return undefined
  }
  const domain = io.env.USERDOMAIN
  return domain === undefined || domain === '' ? name : `${domain}\\${name}`
}

/**
 * Whether the task exists, from `Get-ScheduledTask` rather than from `schtasks /Query`: the first prints
 * a word this code chose, the second a message that Windows translates. `unknown` is any answer that
 * is not one of the two words, a failed or unstartable command included.
 */
async function taskPresence(
  runner: Runner,
  label: string,
): Promise<'present' | 'absent' | 'unknown'> {
  const answer = await runner('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `if (Get-ScheduledTask -TaskName '${label}' -ErrorAction SilentlyContinue) { 'present' } else { 'absent' }`,
  ])
  if (answer.code !== 0) return 'unknown'
  const word = answer.stdout.trim()
  return word === 'present' || word === 'absent' ? word : 'unknown'
}

async function fail(
  io: DaemonIo,
  runner: Runner,
  label: string,
  command: string,
  result: RunResult,
): Promise<number> {
  io.stderr.write(`theoclaw daemon: schtasks ${command} failed: ${result.stderr.trim()}\n`)
  await schtasks(runner, '/Delete', '/TN', label, '/F')
  return 1
}

export const schtasksBackend: DaemonBackend = {
  async install(io, runner, target) {
    const user = taskUser(io)
    if (user === undefined) return 1
    const { label } = target
    const xml = taskXml({ ...target, nodePath: io.nodePath, entryPath: io.entry, user })
    // The scheduler reads UTF-16 with a byte order mark.
    // A directory only this user can enter, and an exclusive create inside it, so nobody can plant the path.
    const dir = mkdtempSync(join(tmpdir(), 'theoclaw-task-'))
    const path = join(dir, 'task.xml')
    try {
      writeFileSync(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]), {
        flag: 'wx',
        mode: 0o600,
      })
      // A running task keeps its old definition, so a reinstall ends it first; a missing one is no error.
      await schtasks(runner, '/End', '/TN', label)
      const created = await schtasks(runner, '/Create', '/TN', label, '/XML', path, '/F')
      if (created.code !== 0) return await fail(io, runner, label, '/Create', created)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const started = await schtasks(runner, '/Run', '/TN', label)
    if (started.code !== 0) return fail(io, runner, label, '/Run', started)
    io.stdout.write(`theoclaw daemon: task ${label} installed and started\n`)
    return 0
  },

  async uninstall(io, runner, target) {
    const { label } = target
    await schtasks(runner, '/End', '/TN', label)
    const deleted = await schtasks(runner, '/Delete', '/TN', label, '/F')
    // A refused or impossible /Delete leaves the task in place. It counts as removed only when the
    // scheduler is asked and says there is no such task: a command that cannot start (127) or a
    // query that fails proves nothing, so the owner sees the failure instead (#1142).
    if (deleted.code !== 0 && (await taskPresence(runner, label)) !== 'absent') {
      io.stderr.write(`theoclaw daemon: schtasks /Delete failed: ${deleted.stderr.trim()}\n`)
      return 1
    }
    io.stdout.write(`theoclaw daemon: task ${label} removed\n`)
    return 0
  },

  /** Exit 0 when the task is `Running`, 3 otherwise; the state is the enum name, which schtasks localises and this does not. */
  async status(io, runner, target) {
    const answer = await runner('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-ScheduledTask -TaskName '${target.label}').State`,
    ])
    const state = answer.code === 0 ? answer.stdout.trim() || 'unknown' : 'not installed'
    io.stdout.write(`${target.label}: ${state}\n`)
    return state === 'Running' ? 0 : 3
  },
}
