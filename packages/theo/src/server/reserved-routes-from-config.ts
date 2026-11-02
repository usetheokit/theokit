import type { TheoConfig } from '../config/schema.js'

import { defineHealthRoute, defineReadyRoute, type ReservedRoutes } from './define/health-route.js'
import { jobBackendFromConfig } from './jobs/job-backend-from-config.js'

/**
 * The reserved `/__theo/*` routes for an app, built from its config. `theokit start` and
 * `theokit dev` serve these.
 *
 * Readiness checks what the config says the app depends on: the `ready` probe the app declares and
 * the configured `jobs.backend` when it has `ping()`. `start` used to register liveness alone, so
 * `/__theo/ready` answered 200 with the job database down, and no config key could change that
 * (usetheokit/theokit#1071). With nothing to check, readiness stays trivially ready.
 *
 * The backend is pinged first: a probe declared for the app's own concerns should not have to
 * repeat a check the framework can make.
 */
export function reservedRoutesFromConfig(
  config: Pick<TheoConfig, 'jobs' | 'ready'>,
): ReservedRoutes {
  const backend = jobBackendFromConfig(config)
  const declared = config.ready
  const health = defineHealthRoute()
  if (backend?.ping === undefined && declared === undefined) return { health }
  return {
    health,
    ready: defineReadyRoute(async () => {
      if (backend?.ping !== undefined) await backend.ping()
      return declared === undefined ? true : await declared()
    }),
  }
}
