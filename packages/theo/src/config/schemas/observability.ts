import { z } from 'zod'

/**
 * Observability subsystem config.
 *
 * `adapter-registry.ts` has documented `theo.config.ts > observability.provider`
 * as the first source in its resolution chain since it was written, and the key
 * did not exist in the schema — so the chain's highest-priority entry was
 * unreachable and every consumer fell through to the environment
 * (usetheokit/theokit#353).
 *
 * Default `observability: undefined` keeps telemetry off, which is what an
 * application that never asked for it should get.
 */
export const observabilitySchema = z.object({
  /** Set `false` to opt out even when the environment would enable an exporter. */
  enabled: z.boolean().default(true),
  /**
   * An `ObservabilityAdapter` instance. Validated structurally rather than by
   * shape, for the same reason `storage` and `plugins` are: the config layer
   * cannot import the adapter contract without inverting the module graph, and
   * the adapter is a live object rather than data.
   */
  provider: z.custom<unknown>().optional(),
})
