import { existsSync, mkdirSync } from 'node:fs'
import type { Writable } from 'node:stream'

import { diagnose, renderDiagnosis, type Check } from '@theokit/agents/doctor'

import { auditConfiguration, fixFindings } from '../security-audit.js'
import { configurationPath, loadConfiguration } from '../config-file.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { checkPolicy } from './policy.js'
import { requireModel } from '../control-plane/settings.js'

/**
 * `theoclaw doctor` (B-399, OC-95): checks the configuration the start would see, offline. A
 * failed check names the variable and the defect, never the value. Exit 0 when nothing fails,
 * 3 while a check fails; warnings (the security audit's findings) do not change the exit.
 */

export interface DoctorIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
}

const PLACEHOLDER = /^(changeme|change-me|your[-_ ].*|xxx+|<.*>|\.\.\.|todo|none|null|undefined)$/i
const MIN_KEY_LENGTH = 8

/** What is wrong with a credential's shape, or undefined. The text never holds the credential. */
export function credentialDefect(value: string): string | undefined {
  if (value !== value.trim()) return 'has leading or trailing whitespace'
  if (/\s/.test(value)) return 'contains whitespace'
  if (/["'`\\]/.test(value)) return 'contains a quote or backslash'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return 'contains a control character'
  if (PLACEHOLDER.test(value)) return 'is a placeholder'
  if (value.length < MIN_KEY_LENGTH) return `is shorter than ${MIN_KEY_LENGTH} characters`
  return undefined
}

const KEYS = ['THEOKIT_API_KEY', 'OPENROUTER_API_KEY']

/**
 * `--fix` (B-717): repairs only what has one safe fix and touches no value: the file and directory
 * modes of the security audit (SA-001, SA-002) and a missing `THEOCLAW_STATE_DIR`, created at 0700.
 * Returns the lines to print. The configuration file is never rewritten.
 */
function repair(io: DoctorIo): string[] {
  const lines: string[] = []
  const env: NodeJS.ProcessEnv = { ...io.env }
  try {
    const path = loadConfiguration(env, io.homeDir) ?? configurationPath(env, io.homeDir)
    const fixed = fixFindings(auditConfiguration(io.env, io.homeDir), path)
    for (const id of fixed) lines.push(`fixed ${id}`)
  } catch {
    // an unreadable or missing named file is reported by the checks, not repaired
  }
  const stateDir = (env.THEOCLAW_STATE_DIR ?? '').trim()
  if (stateDir !== '' && !existsSync(stateDir)) {
    try {
      mkdirSync(stateDir, { recursive: true, mode: 0o700 })
      lines.push('fixed THEOCLAW_STATE_DIR: created the state directory')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
      lines.push(`THEOCLAW_STATE_DIR: cannot create the state directory: ${code}`)
    }
  }
  return lines
}

/**
 * TheoClaw's checks, in the framework's shape. The configuration file is loaded into a copy of the
 * environment first, because the model, credential and policy checks read what it sets.
 */
export function doctorChecks(io: DoctorIo): Check[] {
  const env: NodeJS.ProcessEnv = { ...io.env }
  const checks: Check[] = []
  let path = configurationPath(env, io.homeDir)
  try {
    path = loadConfiguration(env, io.homeDir) ?? path
    checks.push({ name: 'config', status: 'ok', detail: path })
  } catch (error) {
    checks.push({ name: 'config', status: 'fail', detail: (error as TheoClawConfigError).message })
  }
  try {
    requireModel(env)
    checks.push({ name: 'model', status: 'ok', detail: 'the model settings are complete' })
  } catch (error) {
    const detail =
      error instanceof TheoClawConfigError ? error.message : 'the model settings cannot be read'
    checks.push({ name: 'model', status: 'fail', detail })
  }
  const stateDir = (env.THEOCLAW_STATE_DIR ?? '').trim()
  if (stateDir !== '' && !existsSync(stateDir)) {
    const detail = 'THEOCLAW_STATE_DIR names a directory that does not exist (fixable with --fix)'
    checks.push({ name: 'state directory', status: 'fail', detail })
  }
  for (const key of KEYS) {
    const value = env[key]
    const defect = value === undefined || value.trim() === '' ? undefined : credentialDefect(value)
    if (defect !== undefined) {
      checks.push({ name: 'credential', status: 'fail', detail: `${key} ${defect}` })
    }
  }
  const violations = checkPolicy(env, path)
  for (const detail of violations) checks.push({ name: 'policy', status: 'fail', detail })
  try {
    for (const finding of auditConfiguration(io.env, io.homeDir)) {
      const detail = `${finding.id}: ${finding.message}`
      checks.push({ name: 'security audit', status: 'warn', detail })
    }
  } catch {
    // an unreadable configuration is reported by the config check
  }
  return checks
}

export function doctor(io: DoctorIo, options: { readonly fix?: boolean } = {}): number {
  if (options.fix === true) for (const line of repair(io)) io.stdout.write(`${line}\n`)
  const diagnosis = diagnose(doctorChecks(io))
  io.stdout.write(`${renderDiagnosis(diagnosis)}\n`)
  return diagnosis.exitCode === 0 ? 0 : 3
}
