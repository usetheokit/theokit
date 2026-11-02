import { chmodSync, existsSync, statSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import type { Writable } from 'node:stream'

import { configurationPath, loadConfiguration } from './config-file.js'
import { isLoopback } from './control-plane/bind.js'
import { UsageError } from './cli-args.js'

/**
 * `theoclaw security audit [--fix]` (B-708, OC-89): reads the configuration the start would see
 * and reports risky settings by id. A finding names the setting, never its value, which may be a
 * token. `--fix` repairs only what is safe to change without a person: the permissions of the
 * configuration file and of TheoClaw's own directory. A setting that changes behaviour (a bind, a
 * policy, a sandbox mode, a token) is reported and left as it is.
 */

export interface Finding {
  readonly id: string
  readonly message: string
  readonly fixable: boolean
}

const MIN_TOKEN_LENGTH = 32
const OWN_DIRECTORY = 'theoclaw'

function modeOf(path: string): number {
  return statSync(path).mode & 0o777
}

/** Whether `path` is TheoClaw's own directory (the default `<config>/theoclaw`), the only one `--fix` narrows. */
function ownsDirectory(directory: string): boolean {
  return basename(directory) === OWN_DIRECTORY
}

type Env = Readonly<Record<string, string | undefined>>

function fileFindings(path: string): Finding[] {
  if (!existsSync(path)) return []
  const findings: Finding[] = []
  if ((modeOf(path) & 0o077) !== 0) {
    findings.push({ id: 'SA-001', fixable: true, message: `${path} is readable beyond its owner (mode ${modeOf(path).toString(8)}); it holds the model key and tokens, and should be 600` })
  }
  const directory = dirname(path)
  if (ownsDirectory(directory) && (modeOf(directory) & 0o077) !== 0) {
    findings.push({ id: 'SA-002', fixable: true, message: `${directory} is open beyond its owner (mode ${modeOf(directory).toString(8)}); it should be 700` })
  }
  return findings
}

function settingFindings(env: Env): Finding[] {
  const findings: Finding[] = []
  const host = (env.THEOCLAW_HOST ?? '').trim()
  if (host !== '' && !isLoopback(host) && env.THEOCLAW_PUBLIC_BIND === 'yes') {
    findings.push({ id: 'SA-003', fixable: false, message: 'THEOCLAW_HOST binds a non-loopback address with THEOCLAW_PUBLIC_BIND=yes: the control plane is reachable from the network' })
  }
  if (env.THEOCLAW_DM_POLICY === 'open') {
    findings.push({ id: 'SA-004', fixable: false, message: 'THEOCLAW_DM_POLICY=open: any sender can start a turn; use pairing or an allowlist' })
  }
  if (env.THEOCLAW_SANDBOX === 'danger-full-access') {
    findings.push({ id: 'SA-005', fixable: false, message: 'THEOCLAW_SANDBOX=danger-full-access: the shell runs unconfined' })
  }
  return findings
}

function tokenFindings(env: Env): Finding[] {
  return ['THEOCLAW_CONTROL_TOKEN', 'THEOCLAW_WEBCHAT_TOKEN']
    .filter((variable) => {
      const token = (env[variable] ?? '').trim()
      return token !== '' && token.length < MIN_TOKEN_LENGTH
    })
    .map((variable) => ({ id: 'SA-006', fixable: false, message: `${variable} is shorter than ${MIN_TOKEN_LENGTH} characters and is easy to guess; generate a longer one` }))
}

/** Findings for the file at `configurationPath(env, homeDir)` merged with `env`; throws when a named file is missing. */
export function auditConfiguration(env: Env, homeDir: string): Finding[] {
  const merged: NodeJS.ProcessEnv = { ...env }
  const path = loadConfiguration(merged, homeDir) ?? configurationPath(merged, homeDir)
  return [...fileFindings(path), ...settingFindings(merged), ...tokenFindings(merged)]
}

/** Applies each fixable finding and returns the ids it fixed; the path is the file the findings were read from. */
export function fixFindings(findings: readonly Finding[], path: string): string[] {
  const fixed: string[] = []
  for (const finding of findings) {
    if (!finding.fixable) continue
    if (finding.id === 'SA-001') chmodSync(path, 0o600)
    else if (finding.id === 'SA-002') chmodSync(dirname(path), 0o700)
    else continue
    fixed.push(finding.id)
  }
  return fixed
}

/** The `security` subcommand: exit 0 when nothing is left to report, 3 when findings remain. */
export function securityCommand(
  args: readonly string[],
  io: { readonly env: NodeJS.ProcessEnv; readonly homeDir: string; readonly stdout: Writable },
): Promise<number> {
  const [verb, ...flags] = args
  if (verb !== 'audit' || flags.some((flag) => flag !== '--fix')) {
    throw new UsageError('theoclaw security: expected audit [--fix]')
  }
  const findings = auditConfiguration(io.env, io.homeDir)
  const path = configurationPath({ ...io.env }, io.homeDir)
  const fixed = flags.includes('--fix') ? fixFindings(findings, path) : []
  for (const id of fixed) io.stdout.write(`fixed ${id}\n`)
  const remaining = findings.filter((finding) => !fixed.includes(finding.id))
  for (const finding of remaining) io.stdout.write(`${finding.id}${finding.fixable ? ' (fixable with --fix)' : ''}: ${finding.message}\n`)
  return Promise.resolve(remaining.length === 0 ? 0 : 3)
}
