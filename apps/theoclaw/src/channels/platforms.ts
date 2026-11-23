import { join } from 'node:path'

import { configFromEnv } from '@theokit/gateway'
import type { ChannelDescriptor, PlatformName } from '@theokit/gateway'
import { discordChannel } from '@theokit/gateway-discord'
import { emailChannel } from '@theokit/gateway-email'
import { googleChatChannel } from '@theokit/gateway-google-chat'
import { imessageChannel } from '@theokit/gateway-imessage'
import { lineChannel } from '@theokit/gateway-line'
import { matrixChannel } from '@theokit/gateway-matrix'
import { mattermostChannel } from '@theokit/gateway-mattermost'
import { qqChannel } from '@theokit/gateway-qq'
import { raftChannel } from '@theokit/gateway-raft'
import { signalChannel } from '@theokit/gateway-signal'
import { slackChannel } from '@theokit/gateway-slack'
import { smsChannel } from '@theokit/gateway-sms'
import { teamsChannel } from '@theokit/gateway-teams'
import { telegramChannel } from '@theokit/gateway-telegram'
import { tlonUrbitChannel } from '@theokit/gateway-tlon-urbit'
import { wechatChannel } from '@theokit/gateway-wechat'
import { wecomChannel } from '@theokit/gateway-wecom'
import { whatsappChannel } from '@theokit/gateway-whatsapp'
import { xChannel } from '@theokit/gateway-x'
import { yuanbaoChannel } from '@theokit/gateway-yuanbao'
import { zaloChannel } from '@theokit/gateway-zalo'

import { TheoClawConfigError } from '../control-plane/errors.js'

/** Every channel descriptor's `env` names are read behind this prefix: `TELEGRAM_TOKEN` is `THEOCLAW_TELEGRAM_TOKEN`. */
const PREFIX = 'THEOCLAW_'

/**
 * How TheoClaw reads one platform's gateway descriptor from its environment. The descriptor names
 * the fields, which are secret and which are required; this says which of them TheoClaw reads, and
 * where TheoClaw's own variable names differ from the descriptor's.
 */
interface ChannelSpec {
  readonly descriptor: ChannelDescriptor
  /** The descriptor's config keys TheoClaw reads, in the order its variables are reported missing. */
  readonly keys: readonly string[]
  /** Keys the descriptor leaves optional that TheoClaw requires: a platform runs only when all of them are set (FR-003). */
  readonly required?: readonly string[]
  /** The descriptor's `env` names TheoClaw spells differently, by key and without the prefix. */
  readonly env?: Readonly<Record<string, string>>
  /** A flag that switches the platform on; it is no secret, and masking it would blank every "1" in the output. */
  readonly enabledBy?: string
  /** Which values the output mask hides: every value read (default), the descriptor's secret fields, or none. */
  readonly mask?: 'all' | 'secret' | 'none'
}

/**
 * The platforms TheoClaw runs, in the order the loop starts them. WhatsApp's `verifyToken` is not an
 * adapter option; the webhook route answers Meta's subscription check with it, so it is required
 * here and collected as a secret like the rest. SMS goes through Twilio only (D6). Google Chat reads
 * its service-account JSON key file, and WhatsApp's Baileys backend is chosen in `resolvePlatforms`.
 */
const CHANNELS: Readonly<Record<SupportedPlatform, ChannelSpec>> = {
  telegram: { descriptor: telegramChannel, keys: ['token'] },
  discord: { descriptor: discordChannel, keys: ['token'] },
  slack: { descriptor: slackChannel, keys: ['botToken', 'appToken'] },
  matrix: { descriptor: matrixChannel, keys: ['homeserverUrl', 'accessToken', 'userId'] },
  mattermost: { descriptor: mattermostChannel, keys: ['baseUrl', 'accessToken'] },
  email: { descriptor: emailChannel, keys: ['address', 'password', 'imapHost', 'smtpHost'] },
  line: { descriptor: lineChannel, keys: ['channelSecret', 'channelAccessToken'] },
  whatsapp: {
    descriptor: whatsappChannel,
    keys: ['accessToken', 'phoneNumberId', 'appSecret', 'verifyToken'],
    required: ['verifyToken'],
  },
  teams: { descriptor: teamsChannel, keys: ['clientId', 'clientSecret', 'tenantId'] },
  google_chat: {
    descriptor: googleChatChannel.variants?.file ?? googleChatChannel,
    keys: ['serviceAccountFile', 'audience'],
  },
  signal: { descriptor: signalChannel, keys: ['account', 'signalCliPath'] },
  imessage: { descriptor: imessageChannel, keys: ['cliPath', 'dbPath'], enabledBy: 'THEOCLAW_IMESSAGE_ENABLED', mask: 'none' },
  raft: {
    descriptor: raftChannel,
    keys: ['command'],
    env: { command: 'RAFT_CLI_PATH' },
    enabledBy: 'THEOCLAW_RAFT_ENABLED',
    mask: 'none',
  },
  x: {
    descriptor: xChannel,
    keys: ['userId', 'username', 'clientId', 'clientSecret', 'refreshToken', 'allowFrom', 'bearerToken', 'guestDailyLimit'],
    mask: 'secret',
  },
  wechat: { descriptor: wechatChannel, keys: ['appId', 'appSecret', 'token'] },
  wecom: { descriptor: wecomChannel, keys: ['corpId', 'corpSecret', 'agentId', 'token', 'encodingAesKey'] },
  yuanbao: { descriptor: yuanbaoChannel, keys: ['appId', 'appSecret', 'callbackSecret'] },
  qq: { descriptor: qqChannel, keys: ['appId', 'appSecret'] },
  zalo: { descriptor: zaloChannel, keys: ['appId', 'oaSecretKey', 'accessToken'] },
  tlon_urbit: { descriptor: tlonUrbitChannel, keys: ['shipUrl', 'ship', 'code'] },
  sms: {
    descriptor: smsChannel,
    keys: ['accountSid', 'authToken', 'fromNumber', 'publicUrl'],
    env: {
      accountSid: 'SMS_TWILIO_ACCOUNT_SID',
      authToken: 'SMS_TWILIO_AUTH_TOKEN',
      fromNumber: 'SMS_TWILIO_FROM_NUMBER',
    },
  },
}

/**
 * The platforms TheoClaw can run. `PlatformName` also lists the gateway's other platforms (IRC,
 * ...), which have no adapter package here, so every map keyed by all platforms is keyed by this
 * instead: adding a platform to the table above is what makes those maps demand a decision.
 */
export type SupportedPlatform = Extract<
  PlatformName,
  | 'telegram' | 'discord' | 'slack' | 'matrix' | 'mattermost' | 'email' | 'line' | 'whatsapp' | 'teams'
  | 'google_chat' | 'signal' | 'imessage' | 'raft' | 'x' | 'wechat' | 'wecom' | 'yuanbao' | 'qq' | 'zalo'
  | 'tlon_urbit' | 'sms'
>

/** What `descriptorFor` hands `createChannels`: the platform's descriptor, variant chosen. */
export function descriptorFor(platform: SupportedPlatform, settings: PlatformSettings): ChannelDescriptor {
  if (platform === 'whatsapp' && isBaileys(settings)) {
    return whatsappChannel.variants?.baileys ?? whatsappChannel
  }
  return CHANNELS[platform].descriptor
}

/** The environment variable that picks WhatsApp's backend: `cloud` (the default) or `baileys` (QR-linked WhatsApp Web). */
const WHATSAPP_BACKEND_VARIABLE = 'THEOCLAW_WHATSAPP_BACKEND'
/** Where the Baileys pairing is kept; defaults to `whatsapp-session` under `THEOCLAW_STATE_DIR`. */
const WHATSAPP_SESSION_DIR_VARIABLE = 'THEOCLAW_WHATSAPP_SESSION_DIR'
/** Optional X variable that is no descriptor field: a bad value is refused here with TheoClaw's own wording. */
const X_GUEST_DAILY_LIMIT_VARIABLE = 'THEOCLAW_X_GUEST_DAILY_LIMIT'

/**
 * The settings one platform's descriptor is built from, keyed by the descriptor's config keys: the
 * trimmed text of each variable that is set. WhatsApp's Baileys backend has only `sessionDir`.
 */
export type PlatformSettings = Readonly<Record<string, string>>

/** The Baileys settings when WhatsApp is set up that way. */
export function isBaileys(settings: PlatformSettings): boolean {
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
function whatsappUsesBaileys(env: Readonly<Record<string, string | undefined>>): boolean {
  const backend = (env[WHATSAPP_BACKEND_VARIABLE] ?? '').trim().toLowerCase()
  if (backend === '' || backend === 'cloud') return false
  if (backend === 'baileys') return true
  throw new TheoClawConfigError(`${WHATSAPP_BACKEND_VARIABLE} must be cloud or baileys, not "${backend}"`, {
    variable: WHATSAPP_BACKEND_VARIABLE,
  })
}

/** A platform whose every variable is set, with the settings read from them. */
export interface ConfiguredPlatform {
  readonly platform: SupportedPlatform
  readonly settings: PlatformSettings
}

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

const SUPPORTED = Object.keys(CHANNELS) as SupportedPlatform[]

/** The descriptor reduced to the fields TheoClaw reads, under TheoClaw's names and requirements. */
function readable(spec: ChannelSpec): ChannelDescriptor {
  const config = spec.keys.flatMap((key) => {
    const field = spec.descriptor.config.find((candidate) => candidate.key === key)
    if (field === undefined) return []
    const env = spec.env?.[key] ?? field.env
    return [{ ...field, required: field.required || (spec.required?.includes(key) ?? false), ...(env === undefined ? {} : { env }) }]
  })
  return { ...spec.descriptor, config }
}

/** The ten platforms of FR-001, in the order the loop starts them. */
export const PLATFORMS: readonly PlatformSpec[] = SUPPORTED.map((platform) => {
  const spec = CHANNELS[platform]
  const variables = readable(spec).config.flatMap((field) => (field.required && field.env !== undefined ? [PREFIX + field.env] : []))
  return { platform, variables: spec.enabledBy === undefined ? variables : [spec.enabledBy] }
})

/**
 * Split the environment into the platforms that can run and the ones skipped. A variable that is
 * unset, empty or only whitespace counts as missing (`export X=` in a shell yields `""`); a value
 * is passed on trimmed, so a trailing newline from an environment file never reaches an adapter.
 */
export function resolvePlatforms(
  env: Readonly<Record<string, string | undefined>>,
  os: string = process.platform,
): ResolvedPlatforms {
  const configured: ConfiguredPlatform[] = []
  const skipped: SkippedPlatform[] = []
  const secrets: string[] = []
  for (const platform of SUPPORTED) {
    if (platform === 'whatsapp' && whatsappUsesBaileys(env)) {
      const sessionDir = whatsappSessionDir(env)
      if (sessionDir === undefined) skipped.push({ platform, missing: [WHATSAPP_SESSION_DIR_VARIABLE, 'THEOCLAW_STATE_DIR'] })
      else configured.push({ platform, settings: { sessionDir } })
      continue
    }
    const spec = CHANNELS[platform]
    if (spec.enabledBy !== undefined && (env[spec.enabledBy] ?? '').trim() === '') {
      skipped.push({ platform, missing: [spec.enabledBy] })
      continue
    }
    const read = configFromEnv(readable(spec), env, PREFIX)
    if (read.missing.length > 0) {
      skipped.push({ platform, missing: read.missing })
      continue
    }
    if (platform === 'imessage' && os !== 'darwin') {
      // iMessage needs Messages signed in on a Mac; refuse it elsewhere rather than loop on a missing `imsg`.
      throw new TheoClawConfigError(
        `iMessage runs only on macOS with Messages signed in (this is ${os}); unset THEOCLAW_IMESSAGE_ENABLED`,
        { variable: 'THEOCLAW_IMESSAGE_ENABLED' },
      )
    }
    if (platform === 'x') {
      // The adapter would answer nobody without an allowlist entry.
      if ((read.config.allowFrom ?? '').split(',').every((entry) => entry.trim() === '')) {
        skipped.push({ platform, missing: [`${PREFIX}X_ALLOW_FROM`] })
        continue
      }
      const limit = read.config.guestDailyLimit
      if (limit !== undefined && !/^[1-9]\d*$/.test(limit)) {
        throw new TheoClawConfigError(`${X_GUEST_DAILY_LIMIT_VARIABLE} must be a positive integer`, {
          variable: X_GUEST_DAILY_LIMIT_VARIABLE,
        })
      }
    }
    configured.push({ platform, settings: read.config })
    if (spec.mask === 'secret') secrets.push(...read.secrets)
    else if (spec.mask !== 'none') {
      // Every required value is masked, secret or not; an optional one (a binary path) is not.
      const required = readable(spec).config.filter((field) => field.required).map((field) => field.key)
      secrets.push(...required.flatMap((key) => read.config[key] ?? []))
    }
  }
  return { configured, skipped, secrets }
}
