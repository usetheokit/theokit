import { join } from 'node:path'

import type { PlatformName } from '@theokit/gateway'

import { TheoClawConfigError } from '../control-plane/errors.js'

/**
 * For each platform, the setting its adapter reads and the environment variable that supplies it.
 * Every variable is required: a platform runs only when all of its variables are set (FR-003).
 *
 * WhatsApp's `verifyToken` is not an adapter option; the webhook route answers Meta's subscription
 * check with it, so it is required here and collected as a secret like the rest. SMS goes through
 * Twilio only (D6).
 */
const PLATFORM_VARIABLES = {
  telegram: { token: 'THEOCLAW_TELEGRAM_TOKEN' },
  discord: { token: 'THEOCLAW_DISCORD_TOKEN' },
  slack: { botToken: 'THEOCLAW_SLACK_BOT_TOKEN', appToken: 'THEOCLAW_SLACK_APP_TOKEN' },
  matrix: {
    homeserverUrl: 'THEOCLAW_MATRIX_HOMESERVER_URL',
    accessToken: 'THEOCLAW_MATRIX_ACCESS_TOKEN',
    userId: 'THEOCLAW_MATRIX_USER_ID',
  },
  mattermost: { baseUrl: 'THEOCLAW_MATTERMOST_BASE_URL', accessToken: 'THEOCLAW_MATTERMOST_ACCESS_TOKEN' },
  email: {
    address: 'THEOCLAW_EMAIL_ADDRESS',
    password: 'THEOCLAW_EMAIL_PASSWORD',
    imapHost: 'THEOCLAW_EMAIL_IMAP_HOST',
    smtpHost: 'THEOCLAW_EMAIL_SMTP_HOST',
  },
  line: { channelSecret: 'THEOCLAW_LINE_CHANNEL_SECRET', channelAccessToken: 'THEOCLAW_LINE_CHANNEL_ACCESS_TOKEN' },
  whatsapp: {
    accessToken: 'THEOCLAW_WHATSAPP_ACCESS_TOKEN',
    phoneNumberId: 'THEOCLAW_WHATSAPP_PHONE_NUMBER_ID',
    appSecret: 'THEOCLAW_WHATSAPP_APP_SECRET',
    verifyToken: 'THEOCLAW_WHATSAPP_VERIFY_TOKEN',
  },
  teams: {
    clientId: 'THEOCLAW_TEAMS_CLIENT_ID',
    clientSecret: 'THEOCLAW_TEAMS_CLIENT_SECRET',
    tenantId: 'THEOCLAW_TEAMS_TENANT_ID',
  },
  tlon_urbit: {
    shipUrl: 'THEOCLAW_TLON_URBIT_SHIP_URL',
    ship: 'THEOCLAW_TLON_URBIT_SHIP',
    code: 'THEOCLAW_TLON_URBIT_CODE',
  },
  sms: {
    accountSid: 'THEOCLAW_SMS_TWILIO_ACCOUNT_SID',
    authToken: 'THEOCLAW_SMS_TWILIO_AUTH_TOKEN',
    fromNumber: 'THEOCLAW_SMS_TWILIO_FROM_NUMBER',
    publicUrl: 'THEOCLAW_SMS_PUBLIC_URL',
  },
} as const satisfies Partial<Record<PlatformName, Readonly<Record<string, string>>>>

/**
 * The platforms TheoClaw can run. `PlatformName` also lists the gateway's other platforms (Signal,
 * IRC, ...), which have no adapter package here, so every map keyed by all platforms is keyed by
 * this instead: adding a platform to the table above is what makes those maps demand a decision.
 */
export type SupportedPlatform = keyof typeof PLATFORM_VARIABLES

type PlatformVariables = typeof PLATFORM_VARIABLES

/** The environment variable that picks WhatsApp's backend: `cloud` (the default) or `baileys` (QR-linked WhatsApp Web). */
export const WHATSAPP_BACKEND_VARIABLE = 'THEOCLAW_WHATSAPP_BACKEND'
/** Where the Baileys pairing is kept; defaults to `whatsapp-session` under `THEOCLAW_STATE_DIR`. */
export const WHATSAPP_SESSION_DIR_VARIABLE = 'THEOCLAW_WHATSAPP_SESSION_DIR'

/** WhatsApp through Baileys: no credential, a directory holding the pairing a QR scan made. */
export interface WhatsAppBaileysSettings {
  readonly sessionDir: string
}

type CloudSettings<P extends SupportedPlatform> = { readonly [K in keyof PlatformVariables[P]]: string }

/** The settings one platform's adapter is built from, keyed by the adapter's own option names. */
export type PlatformSettings<P extends SupportedPlatform> = P extends 'whatsapp'
  ? CloudSettings<'whatsapp'> | WhatsAppBaileysSettings
  : CloudSettings<P>

/** The Baileys settings when WhatsApp is set up that way, narrowing the union. */
export function isBaileys(settings: PlatformSettings<'whatsapp'>): settings is WhatsAppBaileysSettings {
  return 'sessionDir' in settings
}

/** The session directory, from the environment; undefined when neither it nor a state directory is set. */
export function whatsappSessionDir(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const explicit = (env[WHATSAPP_SESSION_DIR_VARIABLE] ?? '').trim()
  if (explicit !== '') return explicit
  const state = (env.THEOCLAW_STATE_DIR ?? '').trim()
  return state === '' ? undefined : join(state, 'whatsapp-session')
}

/** Whether `THEOCLAW_WHATSAPP_BACKEND` selects Baileys. Any other non-empty value is refused. */
export function whatsappUsesBaileys(env: Readonly<Record<string, string | undefined>>): boolean {
  const backend = (env[WHATSAPP_BACKEND_VARIABLE] ?? '').trim().toLowerCase()
  if (backend === '' || backend === 'cloud') return false
  if (backend === 'baileys') return true
  throw new TheoClawConfigError(`${WHATSAPP_BACKEND_VARIABLE} must be cloud or baileys, not "${backend}"`, {
    variable: WHATSAPP_BACKEND_VARIABLE,
  })
}

/** A platform whose every variable is set, with the settings read from them. */
export type ConfiguredPlatform = {
  readonly [P in SupportedPlatform]: { readonly platform: P; readonly settings: PlatformSettings<P> }
}[SupportedPlatform]

/** A platform left out, and the variables it lacks. Never carries a value. */
export interface SkippedPlatform {
  readonly platform: SupportedPlatform
  readonly missing: readonly string[]
}

export interface ResolvedPlatforms {
  readonly configured: readonly ConfiguredPlatform[]
  readonly skipped: readonly SkippedPlatform[]
  /** Every value a configured platform read, for the output mask (D9). Never logged. */
  readonly secrets: readonly string[]
}

export interface PlatformSpec {
  readonly platform: SupportedPlatform
  readonly variables: readonly string[]
}

/** The ten platforms of FR-001, in the order the loop starts them. */
export const PLATFORMS: readonly PlatformSpec[] = (Object.keys(PLATFORM_VARIABLES) as SupportedPlatform[]).map(
  (platform) => ({ platform, variables: Object.values(PLATFORM_VARIABLES[platform]) }),
)

/**
 * Split the environment into the platforms that can run and the ones skipped. A variable that is
 * unset, empty or only whitespace counts as missing (`export X=` in a shell yields `""`); a value
 * is passed on trimmed, so a trailing newline from an environment file never reaches an adapter.
 */
export function resolvePlatforms(env: Readonly<Record<string, string | undefined>>): ResolvedPlatforms {
  const configured: ConfiguredPlatform[] = []
  const skipped: SkippedPlatform[] = []
  const secrets: string[] = []
  for (const { platform } of PLATFORMS) {
    if (platform === 'whatsapp' && whatsappUsesBaileys(env)) {
      const sessionDir = whatsappSessionDir(env)
      if (sessionDir === undefined) skipped.push({ platform, missing: [WHATSAPP_SESSION_DIR_VARIABLE, 'THEOCLAW_STATE_DIR'] })
      else configured.push({ platform, settings: { sessionDir } })
      continue
    }
    const read = Object.entries(PLATFORM_VARIABLES[platform]).map(
      ([setting, variable]) => [setting, variable, (env[variable] ?? '').trim()] as const,
    )
    const missing = read.filter(([, , value]) => value === '').map(([, variable]) => variable)
    if (missing.length > 0) {
      skipped.push({ platform, missing })
      continue
    }
    // Safe: `settings` has exactly the keys of this platform's row, which `PlatformSettings<P>`
    // is derived from; TypeScript cannot pair a loop variable of a union with its own row.
    const settings = Object.fromEntries(read.map(([setting, , value]) => [setting, value]))
    configured.push({ platform, settings } as ConfiguredPlatform)
    secrets.push(...read.map(([, , value]) => value))
  }
  return { configured, skipped, secrets }
}
