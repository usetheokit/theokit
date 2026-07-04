import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      // M7-3: public programmatic boot subpath (theokit/boot) — convention-server fetch handler.
      'boot/index': 'src/server/boot.ts',
      'server/index': 'src/server/index.ts',
      // T4.4 (architecture-cleanup) — subpath entrypoints per ADR-0001 v3.
      // Consumers should migrate to these; `theokit/server` keeps re-exporting
      // them for backwards compat until 1.0.
      // (server/agent/index removed in the M3 clean break — the subpath held only
      // the proprietary surface; its survivors are internal.)
      'server/auth/index': 'src/server/auth/index.ts',
      'server/cost/index': 'src/server/cost/index.ts',
      'server/cron/index': 'src/server/cron/index.ts',
      'server/define/index': 'src/server/define/index.ts',
      'server/http/index': 'src/server/http/index.ts',
      'server/jobs/index': 'src/server/jobs/index.ts',
      'server/observability/index': 'src/server/observability/index.ts',
      'server/plugins/index': 'src/server/plugins/index.ts',
      'server/rate-limit/index': 'src/server/rate-limit/index.ts',
      'server/realtime/index': 'src/server/realtime/index.ts',
      'server/scan/index': 'src/server/scan/index.ts',
      'server/security/index': 'src/server/security/index.ts',
      'server/storage/index': 'src/server/storage/index.ts',
      'server/webhook/index': 'src/server/webhook/index.ts',
      'vite-plugin/index': 'src/vite-plugin/index.ts',
      'client/index': 'src/client/index.ts',
      'react-query/index': 'src/client/react-query.ts',
      'adapters/web-shim': 'src/adapters/web-shim.ts',
      'adapters/ws-shim': 'src/adapters/ws-shim.ts',
      // Devtools client entry — loaded dynamically in dev mode by the
      // Vite plugin's `theokit/devtools/entry` alias. MUST ship in dist
      // because consumers resolve `theokit` via package.json#exports → dist/,
      // not src/. Without this entry the alias resolves to a missing file
      // and `pnpm dev` in any consumer crashes with a vite:import-analysis
      // error (regression from 2026-05-22; see tests/unit/devtools-entry-dist.test.ts).
      'devtools/entry': 'src/devtools/dom/entry.tsx',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
    external: [
      'vite',
      'react',
      'react-dom',
      'react-router',
      'zod',
      '@vitejs/plugin-react',
      'cac',
      'busboy',
      'superjson',
      // G1 — `typescript` used by server/scan/detect-http-methods.ts for AST-based
      // HTTP method detection. CJS package with dynamic require('fs'); cannot be
      // bundled into ESM output. Reachable via vite/@vitejs/plugin-react transitive.
      'typescript',
    ],
  },
  {
    entry: {
      'cli/index': 'src/cli/index.ts',
    },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'node20',
    banner: {
      js: '#!/usr/bin/env node\nimport "tsx/esm";',
    },
    external: [
      'vite',
      'react',
      'react-dom',
      'react-router',
      'zod',
      '@vitejs/plugin-react',
      'cac',
      'busboy',
      'superjson',
      // G1 — `typescript` used by server/scan/detect-http-methods.ts for AST-based
      // HTTP method detection. CJS package with dynamic require('fs'); cannot be
      // bundled into ESM output. Reachable via vite/@vitejs/plugin-react transitive.
      'typescript',
    ],
  },
])
