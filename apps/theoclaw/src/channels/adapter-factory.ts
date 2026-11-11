import type { BasePlatformAdapter, MessageEvent } from '@theokit/gateway'
import { DiscordAdapter } from '@theokit/gateway-discord'
import { EmailAdapter } from '@theokit/gateway-email'
import type { GoogleChatAdapterOptions } from '@theokit/gateway-google-chat'
import { GoogleChatAdapter } from '@theokit/gateway-google-chat'
import { LineAdapter } from '@theokit/gateway-line'
import { MatrixAdapter } from '@theokit/gateway-matrix'
import { MattermostAdapter } from '@theokit/gateway-mattermost'
import { IMessageAdapter } from '@theokit/gateway-imessage'
import { SlackAdapter } from '@theokit/gateway-slack'
import { SignalAdapter } from '@theokit/gateway-signal'
import { SMSAdapter } from '@theokit/gateway-sms'
import type { TwilioOptions } from '@theokit/gateway-sms'
import { TeamsAdapter } from '@theokit/gateway-teams'
import { TelegramAdapter } from '@theokit/gateway-telegram'
import { TlonUrbitAdapter } from '@theokit/gateway-tlon-urbit'
import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'

import { readFileSync } from 'node:fs'

import type { PlatformBuild } from './channel-loop.js'
import { isBaileys } from './platforms.js'
import type { ConfiguredPlatform, PlatformSettings, SupportedPlatform } from './platforms.js'

/**
 * The SMS adapter's options: Twilio only (D6). The webhook route parses with the same options, so
 * both are built here and cannot drift apart.
 */
export function smsOptions(settings: PlatformSettings<'sms'>): TwilioOptions {
  return { backend: 'twilio', ...settings }
}

/**
 * The Google Chat adapter's options, read from the service-account JSON key file. The adapter gets
 * a stub Express app, so it opens no port of its own: the Chat webhook is served by the instance's
 * HTTP server at `/webhooks/google_chat`, and `connect()` only fetches the first access token.
 */
export function googleChatOptions(settings: PlatformSettings<'google_chat'>): GoogleChatAdapterOptions {
  let key: unknown
  try {
    key = JSON.parse(readFileSync(settings.serviceAccountFile, 'utf8'))
  } catch (error) {
    throw new Error(`the Google Chat service-account file could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
  const { client_email: email, private_key: privateKey } = (typeof key === 'object' && key !== null ? key : {}) as Record<string, unknown>
  if (typeof email !== 'string' || typeof privateKey !== 'string') {
    throw new Error('the Google Chat service-account file has no client_email and private_key')
  }
  return {
    serviceAccountEmail: email,
    privateKey,
    audience: settings.audience,
    app: { post: () => undefined } as unknown as NonNullable<GoogleChatAdapterOptions['app']>,
  }
}

/**
 * The Signal adapter names a sender by `sourceUuid` when signal-cli sends one, so an owner written
 * as `signal:+5511...` would never match. Inbound events are rewritten to carry the phone number
 * as the sender id whenever the envelope has one; the UUID stays in `signal.sourceUuid`.
 */
export class NumberKeyedSignalAdapter extends SignalAdapter {
  override onInbound(handler: Parameters<SignalAdapter['onInbound']>[0]): () => void {
    return super.onInbound((event) => handler(withNumberSender(event)))
  }
}

function withNumberSender<E extends MessageEvent>(event: E): E {
  const number = (event as { signal?: { sourceNumber?: string } }).signal?.sourceNumber
  return number === undefined ? event : { ...event, sender: { ...event.sender, id: number } }
}

/** Options that apply to every build, from the authorization policy. */
export interface AdapterBuildOptions {
  /**
   * Whether Slack, Mattermost and WhatsApp answer a group message only when mentioned
   * (`THEOCLAW_GROUP_ACTIVATION`). Unset leaves each adapter's own default, which is `true`.
   */
  readonly requireMention?: boolean
  /** Where a WhatsApp pairing QR goes; unset leaves the package default (stderr). */
  readonly onQr?: (qr: string) => void
  /** How long the Baileys backend waits for the session to open (the QR scan); the package default is 60 s. */
  readonly connectTimeoutMs?: number
}

/**
 * The QR-linked WhatsApp Web backend (`THEOCLAW_WHATSAPP_BACKEND=baileys`): no Meta app, no webhook.
 * The QR goes to `options.onQr`, else stderr (the package default).
 */
export function whatsappBaileysAdapter(
  sessionDir: string,
  options: AdapterBuildOptions,
): WhatsAppAdapter {
  return WhatsAppAdapter.from(
    {
      backend: 'baileys',
      baileys: {
        sessionDir,
        ...(options.onQr === undefined ? {} : { onQr: options.onQr }),
        ...(options.connectTimeoutMs === undefined
          ? {}
          : { connectTimeoutMs: options.connectTimeoutMs }),
      },
    },
    mention(options),
  )
}

type AdapterConstructors = {
  readonly [P in SupportedPlatform]: (
    settings: PlatformSettings<P>,
    options: AdapterBuildOptions,
  ) => BasePlatformAdapter
}

function mention(options: AdapterBuildOptions): { readonly requireMention?: boolean } {
  return options.requireMention === undefined ? {} : { requireMention: options.requireMention }
}

/** True for the rejection @slack/web-api raises when Slack refuses a credential (`invalid_auth` and kin). */
export function isSlackPlatformError(reason: unknown): boolean {
  return (
    typeof reason === 'object' &&
    reason !== null &&
    (reason as { code?: unknown }).code === 'slack_webapi_platform_error'
  )
}

/**
 * Bolt's Socket Mode client rejects a background promise when Slack refuses the credential, and
 * nothing awaits it, so Node would exit the whole instance. While this adapter lives, that one
 * rejection is reported on stderr and dropped; any other rejection is rethrown as Node would.
 */
export class GuardedSlackAdapter extends SlackAdapter {
  private static guarded = false

  override async connect(): Promise<boolean> {
    if (!GuardedSlackAdapter.guarded) {
      GuardedSlackAdapter.guarded = true
      process.on('unhandledRejection', (reason) => {
        if (!isSlackPlatformError(reason)) throw reason
        const message = reason instanceof Error ? reason.message : String(reason)
        process.stderr.write(`slack: connect failed: ${message}\n`)
      })
    }
    return super.connect()
  }
}

/**
 * The one module that imports the eleven gateway packages: a missing peer or a renamed class fails
 * here and nowhere else. No constructor connects; some validate their options and throw, which
 * fails only that platform's builder.
 */
const ADAPTERS: AdapterConstructors = {
  telegram: (settings) => new TelegramAdapter(settings),
  discord: (settings) => new DiscordAdapter(settings),
  slack: (settings, options) => new GuardedSlackAdapter({ ...settings, ...mention(options) }),
  matrix: (settings) => new MatrixAdapter(settings),
  mattermost: (settings, options) => new MattermostAdapter({ ...settings, ...mention(options) }),
  email: (settings) => new EmailAdapter(settings),
  line: (settings) => new LineAdapter(settings),
  // The verify token answers Meta's subscription check in the route; it is not an adapter option,
  // so the three Cloud fields are picked by name rather than spread.
  whatsapp: (settings, options) =>
    isBaileys(settings)
      ? whatsappBaileysAdapter(settings.sessionDir, options)
      : WhatsAppAdapter.from(
          {
            backend: 'cloud',
            cloud: {
              accessToken: settings.accessToken,
              phoneNumberId: settings.phoneNumberId,
              appSecret: settings.appSecret,
            },
          },
          mention(options),
        ),
  teams: (settings) => new TeamsAdapter(settings),
  google_chat: (settings) => new GoogleChatAdapter(googleChatOptions(settings)),
  signal: (settings) => new NumberKeyedSignalAdapter(settings),
  imessage: (settings) => new IMessageAdapter(settings),
  tlon_urbit: (settings) => new TlonUrbitAdapter(settings),
  sms: (settings) => new SMSAdapter(smsOptions(settings)),
}

/**
 * One platform with its own settings, keyed so `ADAPTERS[entry.platform]` and `entry.settings`
 * stay paired for the compiler (the correlated-union pattern): a builder handed another
 * platform's settings does not compile.
 */
type SettingsFor<P extends SupportedPlatform = SupportedPlatform> = {
  [K in P]: { readonly platform: K; readonly settings: PlatformSettings<K> }
}[P]

function buildAdapter<P extends SupportedPlatform>(
  entry: SettingsFor<P>,
  options: AdapterBuildOptions,
): BasePlatformAdapter {
  return ADAPTERS[entry.platform](entry.settings, options)
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
