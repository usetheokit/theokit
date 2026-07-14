/* eslint-disable security/detect-non-literal-fs-filename --
 * config() hook extraction (T2.6 / M6). Reads `app/<file>` candidates +
 * theoSrcDir composition (build-time literals).
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { buildServicesProxyConfig, type ServicesConfig } from '../services/index.js'

export interface ConfigHookCtx {
  projectRoot: string
  theoSrcDir: string
  services: ServicesConfig | undefined
  optimizeDepsInclude: string[]
}

/**
 * Builds the partial Vite config returned from `theoPlugin.config()`.
 * Pure extraction — `optimizeDeps.force: true` (workspace iteration
 * coherence), `server.watch.ignored` (ENOSPC prevention), and the
 * `resolve.alias` cascade with order-matters comment all preserved.
 */
export function runConfigHook(ctx: ConfigHookCtx): Record<string, unknown> {
  // Detect whether we're running from source (.ts) or compiled dist (.js)
  const ext = existsSync(resolve(ctx.theoSrcDir, 'index.ts')) ? '.ts' : '.js'

  // Perf: warm up the app's critical-path files so Vite transforms them
  // before the browser asks. Cuts the visible LCP when these files
  // import heavy barrels (TheoUI).
  const warmupClientFiles: string[] = []
  for (const candidate of ['app/layout.tsx', 'app/page.tsx', 'app/page.jsx']) {
    const full = resolve(ctx.projectRoot, candidate)
    if (existsSync(full)) warmupClientFiles.push(`./${candidate}`)
  }

  // Wave 2 completion T1.1 — translate `services: {}` into Vite proxy.
  // Empty services → empty record → Vite proxy unaffected.
  const servicesProxy =
    ctx.services && Object.keys(ctx.services).length > 0
      ? buildServicesProxyConfig(ctx.services)
      : undefined

  // T7.1 dogfood fix — workspace-linked packages change frequently as
  // we iterate. Vite's pre-bundler caches by lockfile hash, NOT source-
  // content hash; when the workspace dist updates but the lockfile
  // doesn't, the cache serves stale bundles. Setting `force: true`
  // always re-optimizes on boot — slower cold-start but cache-coherent
  // across workspace iter.
  return {
    envPrefix: 'THEO_PUBLIC_',
    optimizeDeps: {
      ...(ctx.optimizeDepsInclude.length > 0 ? { include: ctx.optimizeDepsInclude } : {}),
      force: true,
    },
    server: {
      ...(warmupClientFiles.length > 0 ? { warmup: { clientFiles: warmupClientFiles } } : {}),
      ...(servicesProxy !== undefined ? { proxy: servicesProxy } : {}),
      // Skip watching gitignored heavy dirs to avoid ENOSPC (inotify watcher
      // exhaustion), theokit's own generated output, and local SQLite data.
      // #121: a DB write (`.data/app.db` + `-wal`/`-shm`) on every agent turn /
      // request must NOT trigger a full page reload — that "blinks" the screen
      // and tears down the in-flight agent stream.
      watch: {
        ignored: [
          '**/referencias/**',
          '**/.theokit/**',
          '**/dist/**',
          '**/node_modules/**',
          '**/.data/**',
          '**/*.db',
          '**/*.db-wal',
          '**/*.db-shm',
          '**/*.sqlite',
          '**/*.sqlite-journal',
        ],
      },
    },
    resolve: {
      alias: [
        // Order matters: most-specific first so `theokit/X` doesn't
        // get matched by the bare `theokit` alias.
        { find: 'theokit/server', replacement: resolve(ctx.theoSrcDir, `server/index${ext}`) },
        { find: 'theokit/client', replacement: resolve(ctx.theoSrcDir, `client/index${ext}`) },
        {
          // T2.1 (M5 lonely folders) moved the source from
          // `react-query/index.ts` into `client/react-query.ts` (sibling of
          // `client/index.ts`). The package.json export `./react-query`
          // still points at the build artifact `./dist/react-query/index.{js,d.ts}`,
          // but the dev-time source alias must follow the new location.
          find: 'theokit/react-query',
          replacement: resolve(ctx.theoSrcDir, `client/react-query${ext}`),
        },
        {
          find: 'theokit/vite-plugin',
          replacement: resolve(ctx.theoSrcDir, `vite-plugin/index${ext}`),
        },
        {
          find: 'theokit/adapters/web-shim',
          replacement: resolve(ctx.theoSrcDir, `adapters/web-shim${ext}`),
        },
        {
          find: 'theokit/adapters/ws-shim',
          replacement: resolve(ctx.theoSrcDir, `adapters/ws-shim${ext}`),
        },
        // T1.2 — devtools entry (DEV only; tree-shaken in build).
        // Source layout: src/devtools/dom/entry.tsx (has /dom/ segment)
        // Dist layout:   dist/devtools/entry.js    (tsup flattens /dom/)
        {
          find: 'theokit/devtools/entry',
          replacement: resolve(
            ctx.theoSrcDir,
            ext === '.ts' ? 'devtools/dom/entry.tsx' : 'devtools/entry.js',
          ),
        },
        { find: 'theokit', replacement: resolve(ctx.theoSrcDir, `index${ext}`) },
      ],
    },
  }
}
