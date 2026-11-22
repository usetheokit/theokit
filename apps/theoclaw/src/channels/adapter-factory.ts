import { createChannels, createFileCredentialStore } from '@theokit/gateway'
import type { BasePlatformAdapter, ChannelDescriptor } from '@theokit/gateway'
import type { TwilioOptions } from '@theokit/gateway-sms'
import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'
import { XAdapter } from '@theokit/gateway-x'
import type { XAdapterOptions } from '@theokit/gateway-x'

import type { PlatformBuild } from './channel-loop.js'
import { descriptorFor, isBaileys } from './platforms.js'
import type { ConfiguredPlatform, PlatformSettings } from './platforms.js'

/**
 * The SMS adapter's options: Twilio only (D6). The webhook route parses with the same options, so
 * both are built here and cannot drift apart.
 */
export function smsOptions(settings: PlatformSettings): TwilioOptions {
  return {
    backend: 'twilio',
    accountSid: settings.accountSid ?? '',
    authToken: settings.authToken ?? '',
    fromNumber: settings.fromNumber ?? '',
    publicUrl: settings.publicUrl ?? '',
  }
}

/** Options that apply to every build, from the authorization policy. */
export interface AdapterBuildOptions {
  /**
   * Whether Telegram, Slack, Mattermost and WhatsApp answer a group message only when mentioned
   * (`THEOCLAW_GROUP_ACTIVATION`). Unset leaves each adapter's own default.
   */
  readonly requireMention?: boolean
  /** Where a WhatsApp pairing QR goes; unset leaves the package default (stderr). */
  readonly onQr?: (qr: string) => void
  /** How long the Baileys backend waits for the session to open (the QR scan); the package default is 60 s. */
  readonly connectTimeoutMs?: number
}

/** The platforms whose descriptor takes a `requireMention` setting TheoClaw drives from `THEOCLAW_GROUP_ACTIVATION`. */
const MENTION_GATED: ReadonlySet<string> = new Set(['telegram', 'slack', 'mattermost', 'whatsapp'])

function mention(options: AdapterBuildOptions): { readonly requireMention?: boolean } {
  return options.requireMention === undefined ? {} : { requireMention: options.requireMention }
}

/**
 * The QR-linked WhatsApp Web backend (`THEOCLAW_WHATSAPP_BACKEND=baileys`): no Meta app, no webhook.
 * The QR goes to `options.onQr`, else stderr (the package default). The descriptor has no field for
 * the QR sink or the pairing wait, so this one backend is built here rather than by the descriptor.
 */
export function whatsappBaileysAdapter(sessionDir: string, options: AdapterBuildOptions): WhatsAppAdapter {
  return WhatsAppAdapter.from(
    {
      backend: 'baileys',
      baileys: {
        sessionDir,
        ...(options.onQr === undefined ? {} : { onQr: options.onQr }),
        ...(options.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: options.connectTimeoutMs }),
      },
    },
    mention(options),
  )
}

/**
 * The X adapter's options. X rotates the refresh token on every refresh, so the new one is kept by
 * the gateway's file credential store as `x-refresh-token` under `THEOCLAW_STATE_DIR` (mode 0600)
 * and wins over the environment's on the next start. Without a state directory the rotated token
 * is lost on restart. The descriptor has no field for the store, so X is built here.
 */
export function xOptions(settings: PlatformSettings, stateDir = process.env.THEOCLAW_STATE_DIR): XAdapterOptions {
  const dir = (stateDir ?? '').trim()
  const limit = settings.guestDailyLimit
  return {
    userId: settings.userId ?? '',
    username: settings.username ?? '',
    clientId: settings.clientId ?? '',
    clientSecret: settings.clientSecret ?? '',
    refreshToken: settings.refreshToken ?? '',
    allowFrom: (settings.allowFrom ?? '').split(',').map((entry) => entry.trim()).filter((entry) => entry !== ''),
    ...(settings.bearerToken === undefined ? {} : { bearerToken: settings.bearerToken }),
    ...(limit === undefined ? {} : { guest: { dailyLimit: Number(limit) } }),
    ...(dir === '' ? {} : { credentialStore: createFileCredentialStore(dir), credentialKey: 'x-refresh-token' }),
  }
}

/** What the descriptor is given besides the environment's settings. */
function configFor(entry: ConfiguredPlatform, options: AdapterBuildOptions): Readonly<Record<string, unknown>> {
  return {
    ...entry.settings,
    ...(MENTION_GATED.has(entry.platform) ? mention(options) : {}),
    // The Signal adapter names a sender by `sourceUuid`; an owner written as `signal:+5511...` matches the number.
    ...(entry.platform === 'signal' ? { senderKey: 'number' } : {}),
    // The Chat webhook is served by the instance's HTTP server at `/webhooks/google_chat`: the adapter opens no port.
    ...(entry.platform === 'google_chat' ? { webhook: 'external' } : {}),
  }
}

/** The descriptor, with `create` replaced for the two channels whose build needs more than its config can say. */
function descriptorOf(entry: ConfiguredPlatform, options: AdapterBuildOptions): ChannelDescriptor {
  const descriptor = descriptorFor(entry.platform, entry.settings)
  if (entry.platform === 'x') return { ...descriptor, create: () => new XAdapter(xOptions(entry.settings)) }
  if (entry.platform === 'whatsapp' && isBaileys(entry.settings)) {
    return { ...descriptor, create: () => whatsappBaileysAdapter(entry.settings.sessionDir ?? '', options) }
  }
  return descriptor
}

/**
 * The adapter of one configured platform, built from its gateway descriptor. Nothing connects; a
 * configuration the descriptor refuses throws, which fails only that platform.
 */
function buildAdapter(entry: ConfiguredPlatform, options: AdapterBuildOptions): BasePlatformAdapter {
  const { adapters, rejected } = createChannels([
    { descriptor: descriptorOf(entry, options), config: configFor(entry, options), envPrefix: 'THEOCLAW_' },
  ])
  const [adapter] = adapters
  const [rejection] = rejected
  if (rejection !== undefined) throw rejection.error
  if (adapter === undefined) throw new Error(`${entry.platform}: no adapter was built`)
  return adapter
}

/** One builder per configured platform; the adapter is constructed only when the loop calls it. */
export function adapterBuilders(
  configured: readonly ConfiguredPlatform[],
  options: AdapterBuildOptions = {},
): PlatformBuild[] {
  return configured.map((entry) => ({
    platform: entry.platform,
    build: () => buildAdapter(entry, options),
  }))
}
