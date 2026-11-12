// B-396 (OC-85) — the heartbeat: a job kept out of the store, on `THEOCLAW_HEARTBEAT`, whose prompt
// is `<workspace>/HEARTBEAT.md` read on each fire. An absent or blank file calls no model.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { PLATFORMS } from '../channels/platforms.js'
import type { TransientSchedule } from './scheduler-wiring.js'

/** The file whose text is the heartbeat's prompt, in the workspace. Exported for its tests and the live check. */
export const HEARTBEAT_FILE = 'HEARTBEAT.md'

const VARIABLE = 'THEOCLAW_HEARTBEAT'

export interface HeartbeatSettings {
  readonly cron: string
  readonly target: { readonly platform: string; readonly channelId: string }
}

/**
 * Read `THEOCLAW_HEARTBEAT`: `<5-field cron or @shorthand> <platform>:<channelId>`, the last
 * space-separated token being the target, whose platform must be one of `configured` (a heartbeat
 * to a platform with no adapter would pay for a model run on every fire and send nothing). Unset or
 * blank: no heartbeat. Synchronous, so the start refuses a malformed value before it installs
 * anything (`TheoClawConfigError` naming the variable).
 */
export function readHeartbeatSettings(
  env: Readonly<Record<string, string | undefined>>,
  configured: readonly string[],
): HeartbeatSettings | undefined {
  const value = env[VARIABLE]?.trim()
  if (value === undefined || value === '') return undefined
  const tokens = value.split(/\s+/)
  const targetToken = tokens.pop() ?? ''
  const separator = targetToken.indexOf(':')
  if (tokens.length === 0 || separator <= 0 || separator === targetToken.length - 1) {
    throw refuse('must be "<cron> <platform>:<channelId>", for example "0 9 * * * telegram:-100123"')
  }
  const platform = targetToken.slice(0, separator)
  if (!PLATFORMS.some((spec) => spec.platform === platform)) {
    throw refuse(`names platform ${JSON.stringify(platform)}, which is none of ${PLATFORMS.map((spec) => spec.platform).join(', ')}`)
  }
  if (!configured.includes(platform)) {
    throw refuse(`names platform ${JSON.stringify(platform)}, which is not configured (configured: ${configured.join(', ') || 'none'})`)
  }
  const cron = tokens.join(' ')
  const problem = cronProblem(cron)
  if (problem !== undefined) throw refuse(`has a cron the scheduler rejects: ${problem}`)
  return { cron, target: { platform, channelId: targetToken.slice(separator + 1) } }
}

/** The heartbeat as a transient schedule: its prompt is the workspace's `HEARTBEAT.md`, read on each fire. */
export function heartbeatJob(workspace: string, settings: HeartbeatSettings): TransientSchedule {
  const file = join(workspace, HEARTBEAT_FILE)
  return {
    id: 'heartbeat',
    cron: settings.cron,
    target: settings.target,
    prompt: async () => {
      try {
        const text = (await readFile(file, 'utf8')).trim()
        return text === '' ? undefined : text
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
  }
}

function refuse(detail: string): TheoClawConfigError {
  return new TheoClawConfigError(`${VARIABLE} ${detail}`, { variable: VARIABLE })
}

// The SDK validates a cron only inside its asynchronous `Cron.create`, and the start may not await
// before its listener (a signal would pass unhandled), so the same rules are checked here, at read
// time. They mirror the SDK 5.11 validator (`internal/cron/validate.ts`); `tests/heartbeat.test.ts`
// checks that what this accepts the SDK accepts too, and the SDK still validates at registration.
const SHORTHANDS = new Set(['@hourly', '@daily', '@weekly', '@monthly', '@yearly'])
const FIELD_RANGES = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 6 },
] as const
const DIGITS = /^\d+$/

/** Why the SDK would refuse `cron`, or `undefined` when it would accept it. */
function cronProblem(cron: string): string | undefined {
  if (cron.startsWith('@')) return SHORTHANDS.has(cron) ? undefined : `unknown shorthand ${cron}`
  const fields = cron.split(' ')
  if (fields.length !== FIELD_RANGES.length) {
    return `${cron} has ${String(fields.length)} fields, not ${String(FIELD_RANGES.length)}`
  }
  const bad = FIELD_RANGES.find((range, index) => !fieldAccepted(fields[index] ?? '', range))
  return bad === undefined ? undefined : `${cron} has an invalid ${bad.name} field`
}

interface FieldRange {
  readonly min: number
  readonly max: number
}

function fieldAccepted(field: string, range: FieldRange): boolean {
  if (field === '*') return true
  if (field.startsWith('*/')) return stepAccepted(field.slice(2), range)
  if (field.includes(',')) return field.split(',').every((part) => fieldAccepted(part, range))
  if (field.includes('-')) return spanAccepted(field, range)
  return inRange(numberOf(field), range)
}

function stepAccepted(text: string, range: FieldRange): boolean {
  const step = numberOf(text)
  return step !== undefined && step > 0 && step <= range.max
}

function spanAccepted(field: string, range: FieldRange): boolean {
  const [start, end, ...rest] = field.split('-').map(numberOf)
  return rest.length === 0 && inRange(start, range) && inRange(end, range) && (start ?? 0) <= (end ?? 0)
}

function inRange(value: number | undefined, range: FieldRange): boolean {
  return value !== undefined && value >= range.min && value <= range.max
}

function numberOf(text: string): number | undefined {
  return DIGITS.test(text) ? Number.parseInt(text, 10) : undefined
}
