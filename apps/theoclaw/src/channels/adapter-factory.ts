import { createChannels, createFileCredentialStore } from '@theokit/gateway'
import type { BasePlatformAdapter, CredentialStore } from '@theokit/gateway'

import type { PlatformBuild } from './channel-loop.js'
import { descriptorFor, isBaileys } from './platforms.js'
import type { ConfiguredPlatform } from './platforms.js'

/** Options that apply to every build, from the authorization policy. */
export interface AdapterBuildOptions {
  /**
   * Whether Slack, Mattermost and WhatsApp answer a group message only when mentioned
   * (`THEOCLAW_GROUP_ACTIVATION`). Unset leaves each adapter's own default.
   */
  readonly requireMention?: boolean
  /** Where a WhatsApp pairing QR goes; unset leaves the package default (stderr). */
  readonly onQr?: (qr: string) => void
  /** How long the Baileys backend waits for the session to open (the QR scan); the package default is 60 s. */
  readonly connectTimeoutMs?: number
}

/** The platforms whose descriptor takes a `requireMention` setting TheoClaw drives from `THEOCLAW_GROUP_ACTIVATION`. */
const MENTION_GATED: ReadonlySet<string> = new Set(['slack', 'mattermost', 'whatsapp'])

function mention(options: AdapterBuildOptions): { readonly requireMention?: boolean } {
  return options.requireMention === undefined ? {} : { requireMention: options.requireMention }
}

/** What the descriptor is given besides the environment's settings. */
function configFor(entry: ConfiguredPlatform, options: AdapterBuildOptions): Readonly<Record<string, unknown>> {
  return {
    ...entry.settings,
    ...(MENTION_GATED.has(entry.platform) ? mention(options) : {}),
    // The Signal adapter names a sender by `sourceUuid`; an owner written as `signal:+5511...` matches the number.
    ...(entry.platform === 'signal' ? { senderKey: 'number' } : {}),
    // A LINE group message reaches the agent without a mention, as it did before the gateway's webhook handler served it
    // (the descriptor's default is to require one, naming a bot user id TheoClaw does not read).
    ...(entry.platform === 'line' ? { requireMention: false } : {}),
    // The Chat webhook is served by the instance's HTTP server at `/webhooks/google_chat`: the adapter opens no port.
    ...(entry.platform === 'google_chat' ? { webhook: 'external' } : {}),
  }
}

/** The file the rotated X refresh token has always been kept in; the descriptor's own key adds the user id. */
const X_TOKEN_KEY = 'x-refresh-token'

/** A store that keeps every key it is asked for under one key, so an existing deployment's token file is still read. */
function singleKey(store: CredentialStore, key: string): CredentialStore {
  return { get: () => store.get(key), set: (_key, value) => store.set(key, value) }
}

/**
 * What `create` is given besides the config. X rotates the refresh token on every refresh, so the new
 * one is kept by the gateway's file credential store as `x-refresh-token` under `THEOCLAW_STATE_DIR`
 * (mode 0600) and wins over the environment's on the next start; without a state directory the rotated
 * token is lost on restart. Baileys gets the QR sink (else stderr) and the pairing wait.
 */
export function depsFor(
  entry: ConfiguredPlatform,
  options: AdapterBuildOptions,
  stateDir = process.env.THEOCLAW_STATE_DIR,
): Readonly<Record<string, unknown>> | undefined {
  if (entry.platform === 'x') {
    const dir = (stateDir ?? '').trim()
    return dir === '' ? undefined : { credentialStore: singleKey(createFileCredentialStore(dir), X_TOKEN_KEY) }
  }
  if (entry.platform === 'whatsapp' && isBaileys(entry.settings)) {
    return {
      ...(options.onQr === undefined ? {} : { onQr: options.onQr }),
      ...(options.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: options.connectTimeoutMs }),
    }
  }
  return undefined
}

/**
 * The adapter of one configured platform, built from its gateway descriptor. Nothing connects; a
 * configuration the descriptor refuses throws, which fails only that platform.
 */
function buildAdapter(entry: ConfiguredPlatform, options: AdapterBuildOptions): BasePlatformAdapter {
  const deps = depsFor(entry, options)
  const { adapters, rejected } = createChannels([
    { descriptor: descriptorFor(entry.platform, entry.settings),
      config: configFor(entry, options),
      envPrefix: 'THEOCLAW_',
      ...(deps === undefined ? {} : { deps }),
    },
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
