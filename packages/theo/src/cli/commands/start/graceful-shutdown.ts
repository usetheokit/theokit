/**
 * Graceful shutdown stage for `theokit start` (T4.2 architecture-cleanup,
 * ADR-0007 D6 — SIGTERM evicts agents + drains StorageManager).
 *
 * EC-13: SIGTERM evicts agents IMMEDIATELY (no per-request drain). In-flight
 * requests get aborted mid-stream — acceptable because the platform LB
 * removed this pod from rotation BEFORE sending SIGTERM (K8s preStop hook +
 * terminationGracePeriodSeconds; same on Vercel/CF/Render).
 *
 * Re-entry guard: multiple SIGTERMs in quick succession run shutdown ONCE.
 */

import type { Server as HttpServer } from 'node:http'

import { warnOnce } from '../../../server/observability/logger.js'

/**
 * How long shutdown waits for the job in progress before moving on, unless the app says otherwise
 * with `jobs.worker.shutdownTimeoutMs` (usetheokit/theokit#1292).
 */
const DEFAULT_BACKGROUND_STOP_TIMEOUT_MS = 20_000

export interface GracefulShutdownOptions {
  /** How long to wait for `stopBackgroundWork`. Default `DEFAULT_BACKGROUND_STOP_TIMEOUT_MS`. */
  readonly backgroundStopTimeoutMs?: number
}

/**
 * @param stopBackgroundWork - stops the cron scheduler and the job worker. Runs FIRST and is
 *   awaited, so a job in progress finishes (and is acked) before the storage pools it uses are
 *   closed below.
 */
export function installGracefulShutdown(
  server: HttpServer,
  stopBackgroundWork: () => Promise<void> = () => Promise.resolve(),
  { backgroundStopTimeoutMs = DEFAULT_BACKGROUND_STOP_TIMEOUT_MS }: GracefulShutdownOptions = {},
): void {
  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n  [theokit] ${signal} received — evicting agents`)
    void (async () => {
      try {
        // Bounded: a job handler that never returns must not hold the process past the platform's
        // grace period. Its lease expires and another worker takes the job. An app whose jobs run
        // longer, under a process manager that waits longer, raises the bound in its config.
        await Promise.race([
          stopBackgroundWork(),
          new Promise<void>((resolve) => setTimeout(resolve, backgroundStopTimeoutMs).unref()),
        ])
      } catch (err) {
        warnOnce('shutdown.background_error', {
          event: 'shutdown.background_error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
      // Lazy-import SDK only at shutdown time to avoid forcing the dep on
      // apps that don't use agents at all.
      try {
        const sdk = (await import('@theokit/sdk').catch(() => null)) as {
          Agent?: { registry?: { evictAll?: () => Promise<void> } }
        } | null
        if (sdk?.Agent?.registry?.evictAll !== undefined) {
          await sdk.Agent.registry.evictAll()
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warnOnce('shutdown.evict_error', {
          event: 'shutdown.evict_error',
          message: msg,
        })
      }
      // T3.1 — drain the StorageManager AFTER agent eviction. Order matters:
      // agents may still hold open pool refs while evicting; closing pools
      // first would break in-flight queries.
      try {
        const { getStorageManager } = await import('../../../server/storage/storage-manager.js')
        const manager = getStorageManager()
        await manager.dispose()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warnOnce('shutdown.dispose_error', {
          event: 'shutdown.dispose_error',
          message: msg,
        })
      }
      // #353 — flush telemetry LAST, so the spans covering eviction and the
      // storage drain are in the batch that leaves. Without this the exporter's
      // final buffer dies with the process, and the most interesting spans a
      // deploy produces — the ones from the shutdown itself — are the ones
      // guaranteed never to arrive.
      try {
        const { getObservabilityAdapter } =
          await import('../../../server/observability-bootstrap.js')
        await getObservabilityAdapter()?.shutdown()
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        warnOnce('shutdown.observability_error', {
          event: 'shutdown.observability_error',
          message: msg,
        })
      }
      console.log(`  [theokit] shutdown complete`)
      server.close(() => {
        process.exit(0)
      })
      setTimeout(() => {
        warnOnce('shutdown.forced_exit', {
          event: 'shutdown.forced_exit',
          message: 'forced exit after 25s timeout',
        })
        process.exit(0)
      }, 25_000).unref()
    })()
  }
  process.on('SIGTERM', () => {
    shutdown('SIGTERM')
  })
  process.on('SIGINT', () => {
    shutdown('SIGINT')
  })
}
