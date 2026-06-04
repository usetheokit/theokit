/**
 * G6 T1.2 — Vite plugin: watch `server/routes/**` and invalidate SSR module
 * cache on add/change/unlink with a 50 ms debounce window.
 *
 * Plan: .claude/knowledge-base/plans/g6-router-convention-plan.md v1.1
 *
 * Pattern reference: SvelteKit `exports/vite/dev/index.js:335-398`.
 *
 * Why this exists: in dev, `scanServerRoutes` runs per-request (fresh disk
 * read), so adding/removing routes already takes effect on next request.
 * But the SSR dynamic-import cache holds stale code for EDITED routes — Vite
 * needs an explicit `invalidateModule` call to bust it. We also send a
 * `full-reload` so any browser code that imported a route module
 * (rare, but the typed client G1 does this for ts-only type resolution)
 * picks up the change.
 *
 * EC-6: 50 ms debounce collapses bursty file events (e.g., codemod-driven
 * 21-rename storm in T2.1) into a single invalidation cycle — without it,
 * 21 invalidations + 21 full-reloads in 5 s would hang the dev server.
 */
import { sep } from 'node:path'

import type { Plugin, ViteDevServer } from 'vite'

export interface ServerRoutesHmrPluginOptions {
  /** Absolute path of the consumer's `server/` directory. */
  serverDir: string
  /** Debounce window in milliseconds (default 50 ms per EC-6). */
  debounceMs?: number
}

interface ModuleGraphLike {
  getModuleById: (id: string) => unknown
  invalidateModule: (mod: unknown) => void
  idToModuleMap: Map<string, { id: string }>
}

interface ViteDevServerLike {
  watcher: { on: (event: string, listener: (path: string) => void) => void }
  moduleGraph: ModuleGraphLike
  ws: { send: (payload: { type: string }) => void }
}

export function serverRoutesHmrPlugin(opts: ServerRoutesHmrPluginOptions): Plugin {
  const routesDir = `${opts.serverDir}${sep}routes${sep}`
  // Cross-platform: on Windows the watcher MAY emit forward slashes even on NTFS.
  const routesDirPosix = routesDir.replace(/\\/g, '/')
  const debounceMs = opts.debounceMs ?? 50

  const isUnderRoutes = (filePath: string): boolean => {
    const normalized = filePath.replace(/\\/g, '/')
    return normalized.startsWith(routesDirPosix)
  }

  return {
    name: 'theokit:server-routes-hmr',

    configureServer(server: ViteDevServer) {
      const srv = server as unknown as ViteDevServerLike
      let timer: ReturnType<typeof setTimeout> | null = null

      const fireInvalidation = (): void => {
        timer = null
        for (const mod of srv.moduleGraph.idToModuleMap.values()) {
          const normalizedId = mod.id.replace(/\\/g, '/')
          if (normalizedId.startsWith(routesDirPosix)) {
            srv.moduleGraph.invalidateModule(mod)
          }
        }
        srv.ws.send({ type: 'full-reload' })
      }

      const scheduleInvalidation = (filePath: string): void => {
        if (!isUnderRoutes(filePath)) return
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(fireInvalidation, debounceMs)
      }

      srv.watcher.on('add', scheduleInvalidation)
      srv.watcher.on('change', scheduleInvalidation)
      srv.watcher.on('unlink', scheduleInvalidation)
    },
  }
}
