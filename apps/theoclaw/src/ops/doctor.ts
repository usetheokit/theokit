import type { Writable } from 'node:stream'

import { auditConfiguration } from '../security-audit.js'
import { configurationPath, loadConfiguration } from '../config-file.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
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

export function doctor(io: DoctorIo): number {
  const env: NodeJS.ProcessEnv = { ...io.env }
  const failures: string[] = []
  let path = configurationPath(env, io.homeDir)
  try {
    path = loadConfiguration(env, io.homeDir) ?? path
  } catch (error) {
    failures.push((error as TheoClawConfigError).message)
  }
  io.stdout.write(`config: ${path}\n`)
  try {
    requireModel(env)
  } catch (error) {
    failures.push(
      error instanceof TheoClawConfigError ? error.message : 'the model settings cannot be read',
    )
  }
  for (const key of KEYS) {
    const value = env[key]
    const defect = value === undefined || value.trim() === '' ? undefined : credentialDefect(value)
    if (defect !== undefined) failures.push(`${key} ${defect}`)
  }
  const warnings = (() => {
    try {
      return auditConfiguration(io.env, io.homeDir).map(
        (finding) => `${finding.id}: ${finding.message}`,
      )
    } catch {
      return []
    }
  })()
  for (const line of warnings) io.stdout.write(`warn  ${line}\n`)
  for (const line of failures) io.stdout.write(`fail  ${line}\n`)
  if (failures.length === 0) io.stdout.write('ok    the configuration can start a turn\n')
  return failures.length === 0 ? 0 : 3
}
