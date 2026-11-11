import type { PlatformName } from '@theokit/gateway'

import { parseApprovedHooks } from '../agent/hook-approval.js'
import { type GoalSettings, readGoalSettings } from '../channels/goal-command.js'
import { TheoClawConfigError } from '../control-plane/errors.js'

/** The variable that names the configured triggers, comma-separated (B-397 FR-002). */
export const TRIGGERS_VARIABLE = 'THEOCLAW_TRIGGERS'

const NAME = /^[a-z][a-z0-9-]{0,31}$/

/** The shortest trigger secret accepted: a shorter HMAC key is guessable and mangles the output mask (EC-2). */
const MIN_SECRET_LENGTH = 16

/** One signed trigger: `POST /hooks/<name>`, verified with `secret`, answered on `replyTo`. */
export interface TriggerSettings {
  readonly name: string
  readonly secret: string
  readonly replyTo: { readonly platform: PlatformName; readonly channelId: string }
  readonly instructions?: string
}

/** What the event features read at start: the triggers, the hook fingerprints the owner approved, and `/goal`'s budget. */
export interface EventSettings {
  readonly triggers: readonly TriggerSettings[]
  /** Set by `THEOCLAW_EMAIL_TRIGGER_REPLY_TO`: inbound e-mail runs isolated and the summary goes there. */
  readonly emailTrigger?: EmailTriggerSettings
  readonly approvedHooks: ReadonlySet<string>
  readonly goal: GoalSettings
}

/** Where the summary of each inbound e-mail goes, and what the run is told besides. */
export interface EmailTriggerSettings {
  readonly replyTo: TriggerSettings['replyTo']
  readonly instructions?: string
}

type Env = Readonly<Record<string, string | undefined>>

/** `THEOCLAW_TRIGGER_<NAME>_<suffix>`, the name upper-cased with `-` as `_`. */
function variableOf(name: string, suffix: string): string {
  return `THEOCLAW_TRIGGER_${name.toUpperCase().replaceAll('-', '_')}_${suffix}`
}

function required(env: Env, variable: string): string {
  const value = (env[variable] ?? '').trim()
  if (value === '') throw new TheoClawConfigError(`${variable} is not set`, { variable })
  return value
}

/** The trigger names, each checked; an empty entry, a bad name or a duplicate refuses the start. */
function triggerNames(env: Env): readonly string[] {
  const raw = (env[TRIGGERS_VARIABLE] ?? '').trim()
  if (raw === '') return []
  const names = raw.split(',').map((name) => name.trim())
  names.forEach((name, index) => {
    if (!NAME.test(name)) {
      throw new TheoClawConfigError(
        `${TRIGGERS_VARIABLE} entry ${index + 1} is not a trigger name (a lower-case letter, then up to 31 of a-z, 0-9 or -)`,
        { variable: TRIGGERS_VARIABLE },
      )
    }
    if (names.indexOf(name) !== index) {
      throw new TheoClawConfigError(`${TRIGGERS_VARIABLE} names ${name} twice`, { variable: TRIGGERS_VARIABLE })
    }
  })
  return names
}

/** `<platform>:<channel id>`, split at the first `:`; the platform must be a configured one. */
function replyTarget(env: Env, name: string, configured: readonly PlatformName[], given?: string): TriggerSettings['replyTo'] {
  const variable = given ?? variableOf(name, 'REPLY_TO')
  const value = required(env, variable)
  const separator = value.indexOf(':')
  const platform = separator < 0 ? value : value.slice(0, separator)
  const channelId = separator < 0 ? '' : value.slice(separator + 1).trim()
  if (!(configured as readonly string[]).includes(platform)) {
    // The platform is a name the owner chose from a fixed list, never a secret; the channel id is not printed.
    throw new TheoClawConfigError(`${variable} names ${platform}, which is not configured`, { variable })
  }
  if (channelId === '') throw new TheoClawConfigError(`${variable} names no channel id after the platform`, { variable })
  return { platform: platform as PlatformName, channelId }
}

function triggerSettings(env: Env, name: string, configured: readonly PlatformName[]): TriggerSettings {
  const secretVariable = variableOf(name, 'SECRET')
  const secret = required(env, secretVariable)
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new TheoClawConfigError(`${secretVariable} is shorter than ${MIN_SECRET_LENGTH} characters`, { variable: secretVariable })
  }
  const instructions = (env[variableOf(name, 'INSTRUCTIONS')] ?? '').trim()
  return {
    name,
    secret,
    replyTo: replyTarget(env, name, configured),
    ...(instructions === '' ? {} : { instructions }),
  }
}

/**
 * The triggers `THEOCLAW_TRIGGERS` names, with each one's `SECRET`, `REPLY_TO` and optional
 * `INSTRUCTIONS`. Unset or blank names none. A bad trigger throws `TheoClawConfigError` naming the
 * variable, never its value, so the start refuses before anything opens (FR-002).
 */
export function readTriggerSettings(env: Env, configured: readonly PlatformName[]): readonly TriggerSettings[] {
  return triggerNames(env).map((name) => triggerSettings(env, name, configured))
}

/**
 * `THEOCLAW_EMAIL_TRIGGER_REPLY_TO` (`<platform>:<channel id>`) turns each inbound e-mail into one
 * isolated, tool-less run whose summary goes there. The e-mail channel must be configured and the
 * reply must go to another platform, so a summary is never mailed back to the sender's address.
 */
export function readEmailTriggerSettings(env: Env, configured: readonly PlatformName[]): EmailTriggerSettings | undefined {
  const variable = 'THEOCLAW_EMAIL_TRIGGER_REPLY_TO'
  if ((env[variable] ?? '').trim() === '') return undefined
  if (!configured.includes('email' as PlatformName)) {
    throw new TheoClawConfigError(`${variable} is set but the e-mail channel is not configured`, { variable })
  }
  const replyTo = replyTarget(env, '', configured, variable)
  if (replyTo.platform === ('email' as PlatformName)) {
    throw new TheoClawConfigError(`${variable} must name a platform other than email`, { variable })
  }
  const instructions = (env['THEOCLAW_EMAIL_TRIGGER_INSTRUCTIONS'] ?? '').trim()
  return { replyTo, ...(instructions === '' ? {} : { instructions }) }
}

/** The triggers, the approved hook fingerprints and the goal settings, read once at start. */
export function readEventSettings(env: Env, configured: readonly PlatformName[]): EventSettings {
  const emailTrigger = readEmailTriggerSettings(env, configured)
  return { triggers: readTriggerSettings(env, configured), ...(emailTrigger === undefined ? {} : { emailTrigger }), approvedHooks: parseApprovedHooks(env), goal: readGoalSettings(env) }
}

/** Every trigger secret and every approved fingerprint, which the process output mask hides (NFR-003). */
export function eventSecrets(settings: EventSettings): readonly string[] {
  return [...settings.triggers.map((trigger) => trigger.secret), ...settings.approvedHooks]
}
