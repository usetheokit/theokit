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
import { warnOnce } from './observability/logger.js'
import { createObservabilityPlugin } from './observability/middleware.js'
import type { TheoPlugin } from './plugin-types.js'

/**
 * The adapter resolved at boot, for callers that are not the HTTP plugin.
 *
 * An agent run is the case that forced this: its spans are produced by
 * `observeAgentRun` from the wire chunk stream, far from the request hooks, and
 * it must be the SAME adapter — two independently resolved adapters mean two
 * exporters and two half-complete pictures of one run.
 *
 * `undefined` when nothing asked for telemetry, which is what keeps the
 * zero-cost path zero-cost.
 */
let activeAdapter: ObservabilityAdapter | undefined

export function getObservabilityAdapter(): ObservabilityAdapter | undefined {
  return activeAdapter
}

/** Test-only: forget the boot-resolved adapter. Production code must not call this. */
export function _resetObservabilityAdapter(): void {
  activeAdapter = undefined
}

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
  if (adapter.name === 'noop') {
    // Silence here is the defect. An application that WROTE `observability: {}`
    // asked for telemetry, and returning quietly gives it a passing boot, no
    // spans, and nothing to search for — the config-validates-and-does-nothing
    // shape usetheokit/theokit#321 recorded for `rateLimit`.
    //
    // Only when it was asked for: an application that configured nothing is not
    // owed a warning about a thing it never requested.
    if (parsed !== undefined) {
      warnOnce('observability.no_exporter', {
        event: 'observability.no_exporter',
        message:
          'observability is configured but no exporter resolved, so no spans will be recorded. ' +
          'Set THEO_CLOUD_INGEST_URL and THEO_CLOUD_API_KEY, or pass observability.provider with ' +
          'your own adapter. In development, NODE_ENV=development resolves the console exporter.',
      })
    }
    return undefined
  }

  activeAdapter = adapter
  return createObservabilityPlugin(adapter)
}
