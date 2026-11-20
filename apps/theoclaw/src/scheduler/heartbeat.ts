// B-396 (OC-85) — the heartbeat: a job kept out of the store, on `THEOCLAW_HEARTBEAT`, whose prompt
// is `<workspace>/HEARTBEAT.md` read on each fire. An absent or blank file calls no model.
import { join } from 'node:path'

import { fileTransientJob } from '@theokit/agents/tools'
import { validateCron } from '@theokit/sdk/cron'

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
  return readScheduleVariable(VARIABLE, env, configured)
}

/** `<cron> <platform>:<channelId>` read from the variable `variable`; shared with the team report. */
export function readScheduleVariable(
  variable: string,
  env: Readonly<Record<string, string | undefined>>,
  configured: readonly string[],
): HeartbeatSettings | undefined {
  const refuse = (detail: string): TheoClawConfigError => refuseFor(variable, detail)
  const value = env[variable]?.trim()
  if (value === undefined || value === '') return undefined
  const tokens = value.split(/\s+/)
  const targetToken = tokens.pop() ?? ''
  const separator = targetToken.indexOf(':')
  if (tokens.length === 0 || separator <= 0 || separator === targetToken.length - 1) {
    throw refuse(
      'must be "<cron> <platform>:<channelId>", for example "0 9 * * * telegram:-100123"',
    )
  }
  const platform = targetToken.slice(0, separator)
  if (!PLATFORMS.some((spec) => spec.platform === platform)) {
    throw refuse(
      `names platform ${JSON.stringify(platform)}, which is none of ${PLATFORMS.map((spec) => spec.platform).join(', ')}`,
    )
  }
  if (!configured.includes(platform)) {
    throw refuse(
      `names platform ${JSON.stringify(platform)}, which is not configured (configured: ${configured.join(', ') || 'none'})`,
    )
  }
  const cron = tokens.join(' ')
  // The SDK's own validator, synchronous: the start may not await before its listener.
  try {
    validateCron(cron)
  } catch (error) {
    throw refuse(`has a cron the scheduler rejects: ${error instanceof Error ? error.message : String(error)}`)
  }
  return { cron, target: { platform, channelId: targetToken.slice(separator + 1) } }
}

/** The heartbeat as a transient schedule: its prompt is the workspace's `HEARTBEAT.md`, read on each fire. */
export function heartbeatJob(workspace: string, settings: HeartbeatSettings): TransientSchedule {
  const { job, transient } = fileTransientJob({
    id: 'heartbeat',
    cron: settings.cron,
    target: settings.target,
    file: join(workspace, HEARTBEAT_FILE),
  })
  return { id: job.id, cron: job.cron, target: job.target, prompt: transient.prompt }
}

function refuseFor(variable: string, detail: string): TheoClawConfigError {
  return new TheoClawConfigError(`${variable} ${detail}`, { variable })
}
