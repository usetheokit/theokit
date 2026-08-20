/**
 * Build the observability plugin from `theo.config.ts > observability` + the
 * environment (#353).
 *
 * Until this existed, `createObservabilityPlugin` had no production caller and
 * `startSpan` was invoked in exactly one production file — the one nothing
 * called. Every adapter, the OTLP serializer and the span implementation were
 * tested, published and unreachable: the framework emitted no spans at all.
 *
 * ## When the plugin is wired, and one deliberate divergence
 *
 * `adapter-registry.ts` documents a four-step chain: explicit config, then
 * TheoCloud env vars, then `NODE_ENV=development` → console, then noop. This
 * function honours the first two and does NOT treat the third as an opt-in.
 *
 * The reason is that step 3 would turn telemetry on for every `theo dev` that
 * never asked for it, and the console adapter writes JSON lines to `stderr`
 * (`adapters/console.ts:23`) — the same stream `observability/logger.ts` already
 * writes a different JSON shape to. Two interleaved formats on one stream is a
 * downgrade for every developer, bought in exchange for telemetry nobody
 * requested.
 *
 * So: `observability: {}` in the config turns it on, and in dev that still
 * resolves to the console adapter exactly as the chain says. What changes is
 * that `NODE_ENV=development` alone no longer counts as asking.
 *
 * Returns `undefined` when nothing asked for telemetry, which preserves the
 * zero-plugin path for applications that configure none.
 */
import { observabilitySchema } from '../config/schemas/index.js'

import { resolveAdapter } from './observability/adapter-registry.js'
import type { ObservabilityAdapter } from './observability/adapters/types.js'
import { createObservabilityPlugin } from './observability/middleware.js'
import type { TheoPlugin } from './plugin-types.js'

export function createObservabilityPluginFromConfig(
  observabilityConfig: unknown,
  env: Record<string, string | undefined>,
): TheoPlugin | undefined {
  const parsed =
    observabilityConfig === undefined || observabilityConfig === null
      ? undefined
      : observabilitySchema.parse(observabilityConfig)

  if (parsed?.enabled === false) return undefined

  // An ingest URL plus a key is an explicit deployment decision, so it opts in
  // on its own — that is what makes the env half of the documented chain reachable
  // without a config file.
  const cloudConfigured = Boolean(env.THEO_CLOUD_INGEST_URL) && Boolean(env.THEO_CLOUD_API_KEY)
  if (parsed === undefined && !cloudConfigured) return undefined

  const adapter = resolveAdapter({
    env,
    config: { provider: parsed?.provider as ObservabilityAdapter | undefined },
  })

  // The registry never fails; it falls back to noop. Wiring a plugin whose every
  // hook is a no-op would cost a runner on the request path and buy nothing.
  if (adapter.name === 'noop') return undefined

  return createObservabilityPlugin(adapter)
}
