/**
 * Dev-mode OpenAPI emit helper for `theokit dev`.
 *
 * Per P#3 plan v1.3 T1.1 (ADRs D3 + D4 + EC-8). Called once on `theokit dev`
 * boot AND on every chokidar 'change'/'add'/'unlink' watcher event for
 * route files when `config.openapi !== undefined`. Re-runs G2's
 * `emitOpenApi()` orchestrator to keep `<distDir>/openapi.json` always
 * fresh in dev.
 *
 * EC-8 absorbed (single-flight guard): if a previous invocation is still
 * awaiting `loadRoutesForOpenApi` (Vite SSR loader can hang on circular
 * imports or syntax errors), skip the new call and emit a `console.warn`
 * so watcher events don't pile up + dev server doesn't deadlock.
 *
 * Best-effort: ALL errors caught + warned. Never throws out of the
 * exported function (would crash Vite dev's chokidar handler).
 *
 * NEVER ship to runtime — dev-only artifact gated on `config.openapi`.
 */
import { generateManifest } from '../../server/scan/manifest.js'

import { emitOpenApi } from './emit.js'
import { loadRoutesForOpenApi } from './load-routes.js'

interface DevEmitConfig {
  servers: { url: string; description?: string }[]
  specVersion: '3.1.0' | '3.0.3'
  title: string
  version: string
}

let inFlight = false

export async function reEmitOpenApi(
  serverDir: string,
  distDir: string,
  openApiConfig: DevEmitConfig,
): Promise<void> {
  if (inFlight) {
    console.warn(
      '[openapi-emit] previous emit still running; skipping watcher event (EC-8 single-flight guard)',
    )
    return
  }
  inFlight = true
  try {
    const manifest = generateManifest(serverDir)
    const hydrated = await loadRoutesForOpenApi({ serverDir, routes: manifest.routes })
    emitOpenApi({
      manifest: hydrated,
      config: { ...openApiConfig, outDir: distDir },
    })
  } catch (err) {
    console.warn(`[openapi-emit] re-emit failed: ${(err as Error).message}`)
  } finally {
    inFlight = false
  }
}

/** Test seam — resets the inFlight flag between tests. NOT for production use. */
export function _resetInFlightForTests(): void {
  inFlight = false
}
