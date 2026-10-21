import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
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
import { WhatsAppAdapter } from '@theokit/gateway-whatsapp'

import type { PlatformBuild } from './channel-loop.js'
import type { ConfiguredPlatform, PlatformSettings } from './platforms.js'

/**
 * The SMS adapter's options: Twilio only (D6). The webhook route parses with the same options, so
 * both are built here and cannot drift apart.
 */
export function smsOptions(settings: PlatformSettings<'sms'>): TwilioOptions {
  return { backend: 'twilio', ...settings }
}

type AdapterConstructors = {
  readonly [P in PlatformName]: (settings: PlatformSettings<P>) => BasePlatformAdapter
}

/**
 * The one module that imports the ten gateway packages: a missing peer or a renamed class fails
 * here and nowhere else. No constructor connects; some validate their options and throw, which
 * fails only that platform's builder.
 */
const ADAPTERS: AdapterConstructors = {
  telegram: (settings) => new TelegramAdapter(settings),
  discord: (settings) => new DiscordAdapter(settings),
  slack: (settings) => new SlackAdapter(settings),
  matrix: (settings) => new MatrixAdapter(settings),
  mattermost: (settings) => new MattermostAdapter(settings),
  email: (settings) => new EmailAdapter(settings),
  line: (settings) => new LineAdapter(settings),
  // The verify token answers Meta's subscription check in the route; it is not an adapter option,
  // so the three Cloud fields are picked by name rather than spread.
  whatsapp: ({ accessToken, phoneNumberId, appSecret }) =>
    WhatsAppAdapter.from({ backend: 'cloud', cloud: { accessToken, phoneNumberId, appSecret } }),
  teams: (settings) => new TeamsAdapter(settings),
  sms: (settings) => new SMSAdapter(smsOptions(settings)),
}

/**
 * One platform with its own settings, keyed so `ADAPTERS[entry.platform]` and `entry.settings`
 * stay paired for the compiler (the correlated-union pattern): a builder handed another
 * platform's settings does not compile.
 */
type SettingsFor<P extends PlatformName = PlatformName> = {
  [K in P]: { readonly platform: K; readonly settings: PlatformSettings<K> }
}[P]

function buildAdapter<P extends PlatformName>(entry: SettingsFor<P>): BasePlatformAdapter {
  return ADAPTERS[entry.platform](entry.settings)
}

/** One builder per configured platform; the adapter is constructed only when the loop calls it. */
export function adapterBuilders(configured: readonly ConfiguredPlatform[]): PlatformBuild[] {
  return configured.map((entry) => ({ platform: entry.platform, build: () => buildAdapter(entry) }))
}
