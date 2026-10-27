import type { PlatformName } from '@theokit/gateway'

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
  sms: {
    accountSid: 'THEOCLAW_SMS_TWILIO_ACCOUNT_SID',
    authToken: 'THEOCLAW_SMS_TWILIO_AUTH_TOKEN',
    fromNumber: 'THEOCLAW_SMS_TWILIO_FROM_NUMBER',
    publicUrl: 'THEOCLAW_SMS_PUBLIC_URL',
  },
} as const satisfies Record<PlatformName, Readonly<Record<string, string>>>

type PlatformVariables = typeof PLATFORM_VARIABLES

/** The settings one platform's adapter is built from, keyed by the adapter's own option names. */
export type PlatformSettings<P extends PlatformName> = { readonly [K in keyof PlatformVariables[P]]: string }

/** A platform whose every variable is set, with the settings read from them. */
export type ConfiguredPlatform = {
  readonly [P in PlatformName]: { readonly platform: P; readonly settings: PlatformSettings<P> }
}[PlatformName]

/** A platform left out, and the variables it lacks. Never carries a value. */
export interface SkippedPlatform {
  readonly platform: PlatformName
  readonly missing: readonly string[]
}

export interface ResolvedPlatforms {
  readonly configured: readonly ConfiguredPlatform[]
  readonly skipped: readonly SkippedPlatform[]
  /** Every value a configured platform read, for the output mask (D9). Never logged. */
  readonly secrets: readonly string[]
}

export interface PlatformSpec {
  readonly platform: PlatformName
  readonly variables: readonly string[]
}

/** The ten platforms of FR-001, in the order the loop starts them. */
export const PLATFORMS: readonly PlatformSpec[] = (Object.keys(PLATFORM_VARIABLES) as PlatformName[]).map(
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
