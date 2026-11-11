import type { BasePlatformAdapter } from '@theokit/gateway'
import { DiscordAdapter } from '@theokit/gateway-discord'
import { EmailAdapter } from '@theokit/gateway-email'
import { LineAdapter } from '@theokit/gateway-line'
import { MatrixAdapter } from '@theokit/gateway-matrix'
import { MattermostAdapter } from '@theokit/gateway-mattermost'
import { SlackAdapter } from '@theokit/gateway-slack'
import { SMSAdapter } from '@theokit/gateway-sms'
import type { TwilioOptions } from '@theokit/gateway-sms'
import { TeamsAdapter } from '@theokit/gateway-teams'
import { TelegramAdapter } from '@theokit/gateway-telegram'
import { TlonUrbitAdapter } from '@theokit/gateway-tlon-urbit'
import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'

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
export function whatsappBaileysAdapter(sessionDir: string, options: AdapterBuildOptions): WhatsAppAdapter {
  return WhatsAppAdapter.from(
    { backend: 'baileys', baileys: {
        sessionDir,
        ...(options.onQr === undefined ? {} : { onQr: options.onQr }),
        ...(options.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: options.connectTimeoutMs }),
      } },
    mention(options),
  )
}

type AdapterConstructors = {
  readonly [P in SupportedPlatform]: (settings: PlatformSettings<P>, options: AdapterBuildOptions) => BasePlatformAdapter
}

function mention(options: AdapterBuildOptions): { readonly requireMention?: boolean } {
  return options.requireMention === undefined ? {} : { requireMention: options.requireMention }
}

/**
 * The one module that imports the eleven gateway packages: a missing peer or a renamed class fails
 * here and nowhere else. No constructor connects; some validate their options and throw, which
 * fails only that platform's builder.
 */
const ADAPTERS: AdapterConstructors = {
  telegram: (settings) => new TelegramAdapter(settings),
  discord: (settings) => new DiscordAdapter(settings),
  slack: (settings, options) => new SlackAdapter({ ...settings, ...mention(options) }),
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
            cloud: { accessToken: settings.accessToken, phoneNumberId: settings.phoneNumberId, appSecret: settings.appSecret },
          },
          mention(options),
        ),
  teams: (settings) => new TeamsAdapter(settings),
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

function buildAdapter<P extends SupportedPlatform>(entry: SettingsFor<P>, options: AdapterBuildOptions): BasePlatformAdapter {
  return ADAPTERS[entry.platform](entry.settings, options)
}

/** One builder per configured platform; the adapter is constructed only when the loop calls it. */
export function adapterBuilders(configured: readonly ConfiguredPlatform[], options: AdapterBuildOptions = {}): PlatformBuild[] {
  return configured.map((entry) => ({ platform: entry.platform, build: () => buildAdapter(entry, options) }))
}
