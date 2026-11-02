import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { type DaemonBackend, type DaemonIo, type InstallTarget, type Runner, escapeXml, writeAtomically } from './daemon-common.js'

/**
 * The macOS backend (B-692): a LaunchAgent in `~/Library/LaunchAgents`, bootstrapped into the
 * user's `gui/<uid>` domain, which starts at login and restarts the entry after a failed exit.
 */

/** launchd reads user agents from `~/Library/LaunchAgents`; the file is named by the instance label. */
export function plistPath(label: string, home: string): string {
  return join(home, 'Library', 'LaunchAgents', `${label}.plist`)
}

function logPath(label: string, home: string): string {
  return join(home, 'Library', 'Logs', 'theoclaw', `${label}.log`)
}

export interface PlistInput extends Pick<InstallTarget, 'label' | 'profile' | 'configPath' | 'workingDirectory'> {
  readonly nodePath: string
  readonly entryPath: string
  readonly logFile: string
}

function entry(key: string, value: string, indent: string): string[] {
  return [`${indent}<key>${escapeXml(key)}</key>`, `${indent}<string>${escapeXml(value)}</string>`]
}

export function plistFor(input: PlistInput): string {
  const environment = [['THEOCLAW_CONFIG', input.configPath], ...(input.profile === undefined ? [] : [['THEOCLAW_PROFILE', input.profile]])]
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...entry('Label', input.label, '  '),
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${escapeXml(input.nodePath)}</string>`,
    `    <string>${escapeXml(input.entryPath)}</string>`,
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    ...environment.flatMap(([key, value]) => entry(key!, value!, '    ')),
    '  </dict>',
    ...entry('WorkingDirectory', input.workingDirectory, '  '),
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    ...entry('StandardOutPath', input.logFile, '  '),
    ...entry('StandardErrorPath', input.logFile, '  '),
    '</dict>',
    '</plist>',
    '',
  ].join('\n')
}

/** The user's launchd domain; the one place D5 of the plan changes if `gui/<uid>` is unavailable. */
function domain(uid: number): string {
  return `gui/${uid}`
}

/** The user id, or undefined after saying launchd has no domain to address without one. */
function userId(io: DaemonIo): number | undefined {
  if (io.uid === undefined) io.stderr.write('theoclaw daemon: launchd needs the user id, which this process cannot read\n')
  return io.uid
}

function launchctl(runner: Runner, ...args: string[]): ReturnType<Runner> {
  return runner('launchctl', args)
}

export const launchdBackend: DaemonBackend = {
  async install(io, runner, target) {
    const uid = userId(io)
    if (uid === undefined) return 1
    const { label } = target
    const path = plistPath(label, io.homeDir)
    const logFile = logPath(label, io.homeDir)
    mkdirSync(join(logFile, '..'), { recursive: true })
    writeAtomically(path, plistFor({ ...target, nodePath: io.nodePath, entryPath: io.entry, logFile }))
    // A loaded agent keeps its old definition, so a reinstall boots it out first; a missing one is no error.
    await launchctl(runner, 'bootout', `${domain(uid)}/${label}`)
    const loaded = await launchctl(runner, 'bootstrap', domain(uid), path)
    if (loaded.code !== 0) {
      io.stderr.write(`theoclaw daemon: launchctl bootstrap failed: ${loaded.stderr.trim()}\n`)
      rmSync(path, { force: true })
      return 1
    }
    io.stdout.write(`theoclaw daemon: ${label} installed and started (${path}); log: ${logFile}\n`)
    return 0
  },

  async uninstall(io, runner, target) {
    const uid = userId(io)
    if (uid === undefined) return 1
    await launchctl(runner, 'bootout', `${domain(uid)}/${target.label}`)
    rmSync(plistPath(target.label, io.homeDir), { force: true })
    io.stdout.write(`theoclaw daemon: ${target.label} removed\n`)
    return 0
  },

  /** Exit 0 when launchd reports `state = running`, 3 when it is loaded but not running or not loaded. */
  async status(io, runner, target) {
    const uid = userId(io)
    if (uid === undefined) return 1
    const answer = await launchctl(runner, 'print', `${domain(uid)}/${target.label}`)
    const state = answer.code !== 0 ? 'not loaded' : /^\s*state = running$/m.test(answer.stdout) ? 'running' : 'not running'
    io.stdout.write(`${target.label}: ${state}\n`)
    return state === 'running' ? 0 : 3
  },
}
