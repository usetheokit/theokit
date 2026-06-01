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
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
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
      all: true,
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
