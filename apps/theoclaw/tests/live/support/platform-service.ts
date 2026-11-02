import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { runCommand, unitPath } from '../../../src/daemon.js'
import { plistPath } from '../../../src/daemon-launchd.js'

/**
 * What the live daemon test asks of the platform's service, one answer per backend (B-692): whether
 * the definition file or task exists, whether the service is running, and what it logged. The
 * test installs through `daemonInstall`; this module only observes, so the check does not trust the
 * code under test to report its own result.
 */

export interface PlatformService {
  readonly definitionExists: (label: string) => Promise<boolean>
  readonly isRunning: (label: string) => Promise<boolean>
  /** The service's own log; empty where the platform keeps none (Windows). */
  readonly log: (label: string) => string
}

const HOME = homedir()

const systemd: PlatformService = {
  definitionExists: (label) => Promise.resolve(existsSync(unitPath(label, HOME))),
  isRunning: async (label) => (await runCommand('systemctl', ['--user', 'is-active', `${label}.service`])).stdout.trim() === 'active',
  log: (label) => {
    try {
      return execFileSync('journalctl', ['--user', '-u', `${label}.service`, '--no-pager', '-o', 'cat'], { encoding: 'utf8' })
    } catch (error) {
      return `journalctl failed: ${String(error)}`
    }
  },
}

const launchd: PlatformService = {
  definitionExists: (label) => Promise.resolve(existsSync(plistPath(label, HOME))),
  isRunning: async (label) => {
    const answer = await runCommand('launchctl', ['print', `gui/${process.getuid?.() ?? 0}/${label}`])
    return answer.code === 0 && /^\s*state = running$/m.test(answer.stdout)
  },
  log: (label) => {
    const path = join(HOME, 'Library', 'Logs', 'theoclaw', `${label}.log`)
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  },
}

const taskScheduler: PlatformService = {
  definitionExists: async (label) => (await runCommand('schtasks', ['/Query', '/TN', label])).code === 0,
  isRunning: async (label) => {
    const answer = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-ScheduledTask -TaskName '${label}').State`])
    return answer.code === 0 && answer.stdout.trim() === 'Running'
  },
  log: () => '',
}

/** The observer for this host, or a refusal naming the platform. */
export function platformService(platform: NodeJS.Platform): PlatformService {
  if (platform === 'linux') return systemd
  if (platform === 'darwin') return launchd
  if (platform === 'win32') return taskScheduler
  throw new Error(`no daemon backend exists for ${platform}`)
}
