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
      // server/agent re-introduced (T2.5): a lean barrel over the PUBLIC agent-seam survivors
      // (in-process turn seam, tool adapters, code-mode, channel webhooks, MCP). The proprietary
      // surface removed in the M3 clean break stays out. Gives agent consumers (TUI / Tauri scaffold
      // templates) a non-deprecated import path instead of the umbrella.
      'server/agent/index': 'src/server/agent/index.ts',
      'server/auth/index': 'src/server/auth/index.ts',
      'server/cost/index': 'src/server/cost/index.ts',
      // Its own door on purpose — `node:sqlite` must not ride the Web-Standards cost barrel
      // onto an edge runtime (usetheokit/theokit#459).
      'server/cost/sqlite/index': 'src/server/cost/sqlite/index.ts',
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
      // M44 (ADR-0053) — React-FREE agent-client entry (node; no React in the bundle).
      'client/core': 'src/client/core.ts',
      'react-query/index': 'src/client/react-query.ts',
      // The security-header seam the six Web deploy entries import at runtime
      // (usetheokit/theokit#410). A missing entry here is invisible until a
      // deployed worker fails to resolve it.
      // Published beside the other generated-entry doors; sourced from `server/` because
      // `adapters/` may not depend on `server/` (#367).
      'router/element-scroll-restoration': 'src/router/element-scroll-restoration.tsx',
      'adapters/agent-mount': 'src/server/generated-entry.ts',
      'adapters/security-headers': 'src/adapters/security-headers.ts',
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
    // theokit#154 — keep the mapping, drop the embedded sources.
    //
    // `sourcemap: true` alone shipped `sourcesContent`, which embeds the ORIGINAL TypeScript in the
    // published map. Measured on @theokit/agents before this change: 652K of a 1.2M `dist` was maps
    // (54%), and the largest one carried 303 889 bytes of source across 48 files. Nobody decided to
    // publish the sources — it fell out of the bundler default.
    //
    // `sourcesContent: false` keeps what the map is FOR (a readable stack trace pointing at file and
    // line) and drops what it was leaking. The alternative, turning sourcemaps off entirely, would
    // also take the stack traces, which is a real loss for a consumer debugging against our dist.
    esbuildOptions(options) {
      options.sourcesContent = false
    },
    clean: true,
    // tsup strips the `node:` prefix by default (`removeNodeProtocol`, on for backwards compat with
    // Node < 14.18). Harmless for legacy builtins — bare `fs` and `path` resolve — and FATAL for the
    // ones Node exposes only under the protocol: `node:sqlite` was emitted as `from "sqlite"`, which
    // resolves to a package nobody installed. The source was right and the ARTIFACT was broken, and
    // only a smoke test importing from `dist/` caught it (usetheokit/theokit#459).
    //
    // esbuild is not the culprit and was measured before this line was written: it preserves
    // `node:sqlite` at node20, node22 and esnext alike.
    removeNodeProtocol: false,
    target: 'node20',
    external: [
      '@theokit/presenter',
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
      '@theokit/presenter',
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
