import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ServiceCommandError, ServiceDefinitionError } from './errors.js'
import { logLines, tailFile, type LogsOptions } from './logs.js'
import { runCommand, type Runner, type RunResult } from './runner.js'
import {
  assertLabel,
  validateSpec,
  type ServiceBackend,
  type ServiceBackendOptions,
  type ServiceSpec,
  type ServiceState,
} from './spec.js'
import { quotePowerShell, windowsCommandLine } from './windows-command-line.js'
import { escapeXml } from './xml-escape.js'

/** The Task Scheduler definition. Throws ServiceDefinitionError for a value it cannot hold. */
export function scheduledTaskXml(spec: ServiceSpec, options: { user: string }): string {
  validateSpec(spec, { windows: true })
  const user = escapeXml(options.user)
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    `  <RegistrationInfo><Description>${escapeXml(spec.description ?? spec.label)}</Description></RegistrationInfo>`,
    `  <Triggers><LogonTrigger><Enabled>true</Enabled><UserId>${user}</UserId></LogonTrigger></Triggers>`,
    `  <Principals><Principal id="Author"><UserId>${user}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>`,
    '  <Settings>',
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
    '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
    '    <StartWhenAvailable>true</StartWhenAvailable>',
    '    <AllowStartOnDemand>true</AllowStartOnDemand>',
    '    <Enabled>true</Enabled>',
    // The scheduler's default of 72 hours would stop a service meant to run until logoff.
    '    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>',
    '    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>',
    '  </Settings>',
    '  <Actions Context="Author"><Exec>',
    `    <Command>${escapeXml(spec.command)}</Command>`,
    `    <Arguments>${escapeXml(windowsCommandLine(spec.args ?? []))}</Arguments>`,
    `    <WorkingDirectory>${escapeXml(spec.workingDirectory)}</WorkingDirectory>`,
    '  </Exec></Actions>',
    '</Task>',
    '',
  ].join('\r\n')
}

const POWERSHELL = ['-NoProfile', '-NonInteractive', '-Command'] as const

const ids = (stdout: string): string[] =>
  stdout
    .trim()
    .split(',')
    .filter((id) => /^\d+$/.test(id))

type PowerShell = (script: string) => Promise<RunResult>

/**
 * Ids of the task's process and its descendants, read before `/End` (a child cannot be found from
 * a parent that has exited). The root is the process whose command line holds the arguments of the
 * registered action; a task without arguments matches nothing rather than everything.
 */
async function taskProcesses(powershell: PowerShell, label: string): Promise<string[]> {
  const script = [
    `$task = Get-ScheduledTask -TaskName ${quotePowerShell(label)} -ErrorAction SilentlyContinue`,
    '$cl = if ($task) { @($task.Actions)[0].Arguments } else { $null }',
    'if (-not $cl) { return }',
    '$all = @(Get-CimInstance Win32_Process)',
    '$ids = @($all | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($cl) } | ForEach-Object { $_.ProcessId })',
    'do { $n = $ids.Count; $ids = @($ids + ($all | Where-Object { $ids -contains $_.ParentProcessId -and $_.ProcessId -ne $PID } | ForEach-Object { $_.ProcessId }) | Select-Object -Unique) } while ($ids.Count -gt $n)',
    '$ids -join ","',
  ].join('\n')
  const found = await powershell(script)
  if (found.code !== 0)
    throw new ServiceCommandError('process discovery', found.code, found.stderr.trim())
  return ids(found.stdout)
}

/** Stops the processes and waits about 10 s; returns the ids still alive. */
async function stopProcesses(powershell: PowerShell, pids: readonly string[]): Promise<string[]> {
  const script = [
    `$ids = @(${pids.join(',')})`,
    'for ($i = 0; $i -lt 50; $i++) {',
    '  $alive = @(Get-Process -Id $ids -ErrorAction SilentlyContinue)',
    '  if ($alive.Count -eq 0) { break }',
    '  $alive | Stop-Process -Force -ErrorAction SilentlyContinue',
    '  Start-Sleep -Milliseconds 200',
    '}',
    '(@(Get-Process -Id $ids -ErrorAction SilentlyContinue) | ForEach-Object { $_.Id }) -join ","',
  ].join('\n')
  const result = await powershell(script)
  return result.code === 0 ? ids(result.stdout) : pids.slice()
}

export function createSchtasksBackend(options: ServiceBackendOptions = {}): ServiceBackend {
  const runner: Runner = options.runner ?? runCommand
  const env = options.env ?? process.env

  const schtasks = (...args: string[]): Promise<RunResult> => runner('schtasks', args)
  const powershell = (script: string): Promise<RunResult> =>
    runner('powershell.exe', [...POWERSHELL, script])

  const taskUser = (): string => {
    const name = env.USERNAME
    if (name === undefined || name === '') {
      throw new ServiceDefinitionError(
        'USERNAME',
        'is not set; Task Scheduler needs the user the task runs as',
      )
    }
    const domain = env.USERDOMAIN
    return domain === undefined || domain === '' ? name : `${domain}\\${name}`
  }

  /** From `Get-ScheduledTask`, whose words are not localised, unlike `schtasks /Query`. */
  const presence = async (label: string): Promise<'present' | 'absent' | 'unknown'> => {
    const answer = await powershell(
      `if (Get-ScheduledTask -TaskName ${quotePowerShell(label)} -ErrorAction SilentlyContinue) { 'present' } else { 'absent' }`,
    )
    if (answer.code !== 0) return 'unknown'
    const word = answer.stdout.trim()
    return word === 'present' || word === 'absent' ? word : 'unknown'
  }

  const fail = (command: string, result: RunResult): ServiceCommandError =>
    new ServiceCommandError(`schtasks ${command}`, result.code, result.stderr.trim())

  return {
    platform: 'win32',
    // Task Scheduler keeps the definition itself; the task name is its identifier.
    definitionPath(spec) {
      assertLabel(spec.label)
      return spec.label
    },

    async install(spec) {
      if (Object.keys(spec.env ?? {}).length > 0) {
        throw new ServiceDefinitionError(
          'env',
          'cannot be set: a scheduled task carries no environment; pass the values as args',
        )
      }
      const user = taskUser()
      const xml = scheduledTaskXml(spec, { user })
      const { label } = spec
      // A directory only this user can enter and an exclusive create inside it: nobody can plant the path.
      const dir = mkdtempSync(join(tmpdir(), 'theokit-task-'))
      const path = join(dir, 'task.xml')
      try {
        // The scheduler reads UTF-16 with a byte order mark; the path is inside our own mkdtemp directory.
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        writeFileSync(
          path,
          Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]),
          { flag: 'wx', mode: 0o600 },
        )
        // A running task keeps its old definition, so a reinstall ends it first; a missing one is no error.
        await schtasks('/End', '/TN', label)
        const created = await schtasks('/Create', '/TN', label, '/XML', path, '/F')
        if (created.code !== 0) {
          await schtasks('/Delete', '/TN', label, '/F')
          throw fail('/Create', created)
        }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
      const started = await schtasks('/Run', '/TN', label)
      if (started.code !== 0) {
        await schtasks('/Delete', '/TN', label, '/F')
        throw fail('/Run', started)
      }
    },

    async uninstall(label) {
      assertLabel(label)
      const pids = await taskProcesses(powershell, label)
      await schtasks('/End', '/TN', label)
      const alive = pids.length === 0 ? [] : await stopProcesses(powershell, pids)
      if (alive.length > 0) {
        throw new ServiceCommandError(
          'stop task processes',
          1,
          `processes ${alive.join(', ')} of ${label} are still running`,
        )
      }
      const deleted = await schtasks('/Delete', '/TN', label, '/F')
      // A failed /Delete counts as success only when the scheduler says there is no such task.
      if (deleted.code !== 0 && (await presence(label)) !== 'absent') throw fail('/Delete', deleted)
    },

    async status(label) {
      assertLabel(label)
      const answer = await powershell(
        `(Get-ScheduledTask -TaskName ${quotePowerShell(label)} -ErrorAction SilentlyContinue).State`,
      )
      if (answer.code !== 0) return 'unknown'
      const state = answer.stdout.trim()
      let result: ServiceState = 'unknown'
      if (state === '') result = 'not-installed'
      else if (state === 'Running') result = 'running'
      else if (state === 'Ready' || state === 'Disabled' || state === 'Queued') result = 'stopped'
      return result
    },

    async logs(label, logOptions?: LogsOptions) {
      assertLabel(label)
      const lines = logLines(logOptions)
      if (options.logFile === undefined) {
        throw new ServiceDefinitionError(
          'logFile',
          'is required: a scheduled task writes no log of its own; have the app use teeOutput with this file',
        )
      }
      return await tailFile(options.logFile, lines)
    },

    async restart(label) {
      assertLabel(label)
      // A task that is not running makes /End fail; that is no error.
      await schtasks('/End', '/TN', label)
      const started = await schtasks('/Run', '/TN', label)
      if (started.code !== 0) throw fail('/Run', started)
    },
  }
}
