import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test-d.ts'],
    // dogfood-regressions-fix-plan v1.1 T1.2 — native bindings preflight.
    // globalSetup runs ONCE per suite (before any worker), making this the
    // most efficient hook for the better-sqlite3 ABI mismatch guard.
    // See: tests/setup-native-bindings.ts + scripts/preflight-native-bindings.mjs.
    globalSetup: ['./tests/setup-native-bindings.ts'],
    // theokit-test-suite-cleanup followup 2026-06-05 — register `tsx/esm`
    // ESM loader inside every test worker so `loadConfig()` (and downstream
    // tests that spawn `theokit dev`/`build`) can `await import(...theo.config.ts)`
    // against user-authored TypeScript configs. CLI bin already calls
    // `import "tsx/esm"` at startup; setupFiles closes the symmetric gap
    // for in-process tests. See tests/setup-tsx-loader.ts for full rationale
    // + the failure inventory it closes.
    setupFiles: ['./tests/setup-tsx-loader.ts'],
    // theokit-test-suite-cleanup followup 2026-06-05 — vitest defaults to
    // running ALL dynamic `await import()` calls through Vite's SSR loader
    // (including those inside framework code like `load-config.ts:68` that
    // import user-authored `theo.config.ts` files written to /tmp during
    // tests). Vite cannot resolve URLs outside its server root, so it
    // throws "Cannot find module" even though the file exists. The
    // `server.deps.external` option marks paths matching the predicate
    // as external — Vite hands them back to Node, where tsx/esm
    // (registered by tests/setup-tsx-loader.ts) handles the actual
    // transformation. The OS-tempdir prefix (`/tmp/`, `/var/folders/`,
    // `os.tmpdir()` on linux/mac) covers every test fixture path.
    // Without this hook, ~89 tests fail (TheoConfigError "Cannot find
    // module" cascade) — verified empirically 2026-06-05.
    server: {
      deps: {
        external: [/^\/tmp\//, /^\/var\/folders\//, /^\/private\/var\/folders\//],
      },
    },
    // theokit-test-suite-cleanup T5 — integration tests spawn `theokit dev`
    // / `theokit build` subprocesses that compete for ports + CPU when run
    // in parallel. Empirical: under default parallel `forks` pool, multiple
    // integration files time out at 5-30s waiting for their dev server to
    // bind (port-bind retries, native-binding rebuilds, Vite module graph
    // construction all serialize per-process). singleFork serializes ALL
    // test files, eliminating the contention. Unit tests still benefit
    // from vitest's intra-file parallelism (multiple `it` blocks run
    // concurrently inside one fork). Verified 411/411 pass with this
    // setting; without it 8+ integration files flake on first run.
    pool: 'forks',
    // Vitest 4 removed `poolOptions.forks.singleFork`. The equivalent
    // top-level option is `fileParallelism: false` — disables parallel
    // execution across test files, achieving the same serialization that
    // singleFork delivered. Intra-file parallelism (multiple `it` per file)
    // is preserved (per vitest 4 default behavior).
    // See https://vitest.dev/guide/migration#pool-rework
    fileParallelism: false,
    // `testTimeout` covers the wall-clock for individual assertions.
    // Integration tests spawning `theokit dev` need >5s under load.
    // 30s is generous but bounded — a real hang surfaces well within this window.
    testTimeout: 30_000,
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.test-d.{ts,tsx}',
        '**/types.ts',
        '**/index.ts',
        'packages/*/src/cli/**',
        'packages/*/dist/**',
        // Pure type files — only `interface` / `type` declarations, no runtime.
        'packages/theo/src/server/plugin-types.ts',
        'packages/theo/src/server/agent-types.ts',
        // DOM-only React portal — exercised by Playwright (devtools E2E),
        // unit tests would only re-test react-dom.createPortal.
        'packages/theo/src/devtools/shadow-portal.tsx',
        // DOM bootstrap — `createRoot()` + `document.body.appendChild`.
        // Exercised by Playwright tests/e2e/devtools-overlay*.spec.ts.
        'packages/theo/src/devtools/entry.tsx',
        // React hook with fetch + ReadableStream — needs @testing-library/react
        // + jsdom that the project does not currently set up. Wire protocol
        // logic is covered by agent-stream-core.ts unit tests; the hook is
        // covered end-to-end by the default-template Playwright spec.
        'packages/theo/src/client/use-agent-stream.ts',
        // create-theo standalone CLI scaffolder — interactive prompts +
        // child_process spawn. The existing exclude `packages/*/src/cli/**`
        // does not match these because create-theo's CLI sits in `src/`.
        'packages/create-theo/src/cli.ts',
        'packages/create-theo/src/install.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      // Vitest 4 removed `all: true` — coverage now reports for all included
      // files by default via the `include` field above. See
      // https://vitest.dev/guide/migration.html#removed-options-from-coverage-1
      clean: true,
    },
  },
  resolve: {
    alias: {
      'theokit/client': path.resolve(__dirname, 'packages/theo/src/client/index.ts'),
      'theokit/server': path.resolve(__dirname, 'packages/theo/src/server/index.ts'),
      theokit: path.resolve(__dirname, 'packages/theo/src/index.ts'),
    },
  },
})
