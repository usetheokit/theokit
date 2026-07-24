import { resolve } from 'node:path'

import { transformControllerSource, type SwcCore } from '@theokit/http'
import type { Plugin } from 'vite'

/** Vite normalizes module ids to POSIX `/` on every OS; normalize the prefix to match. */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * Vite plugin that compiles `<serverDir>/controllers/**` through @theokit/http's
 * swc transform so parameter decorators (`@Body`, `@Param`, `@Query`) emit the
 * `design:paramtypes` metadata esbuild silently drops. Without it, controller
 * dispatch (Task 1.2) cannot validate `@Body` or bind `@Param`.
 *
 * Scope discipline (ADR-4): the transform is a strict no-op for every file
 * outside `controllers/`, so file-based `route()` compilation is byte-for-byte
 * unchanged. `enforce: 'pre'` runs it before esbuild would mangle the decorators.
 *
 * The swc-loader is REUSED, never reimplemented (ADR-1 / Rule 9 / G12): the swc
 * option block lives once in `@theokit/http`.
 */
interface ControllerSwcTransformOptions {
  /** Absolute backend root (config `serverDir`). Only `controllers/` under it is transformed. */
  serverDir: string
  /**
   * Injectable `@swc/core` loader — test seam only. Defaults to the loader
   * inside `transformControllerSource`, which resolves + caches @swc/core.
   */
  loadSwcCore?: () => Promise<SwcCore | null>
}

export function controllerSwcTransformPlugin(options: ControllerSwcTransformOptions): Plugin {
  // Trailing `/` so `server/controllers-ui/` cannot false-match `server/controllers`.
  // POSIX-normalized so the prefix compares against Vite's `/`-separated ids on Windows too.
  const controllersDir = toPosix(resolve(options.serverDir, 'controllers')) + '/'

  return {
    name: 'theo:controller-swc-transform',
    enforce: 'pre',
    async transform(code: string, id: string) {
      // Strip Vite's query suffix (`?t=...`, `?worker`, etc.) + normalize separators.
      const cleanId = toPosix(id.split('?')[0])
      if (!cleanId.startsWith(controllersDir) || !cleanId.endsWith('.ts')) {
        return null
      }
      const transformed = await transformControllerSource(code, cleanId, options.loadSwcCore)
      return { code: transformed, map: null }
    },
  }
}
