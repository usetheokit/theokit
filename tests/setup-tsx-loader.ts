/**
 * Vitest setupFiles hook — registers `tsx/esm` so runtime code calling
 * native `await import('/abs/path/to/theo.config.ts')` resolves correctly
 * during tests.
 *
 * Why: `packages/theo/src/config/load-config.ts:68` does
 *   `await import(pathToFileURL(configPath).href)` against user-authored
 * `theo.config.ts` files. In production, the CLI bin (`dist/cli/index.js`)
 * starts with `import "tsx/esm"` so the loader is already active before
 * `loadConfig()` runs. Tests, however, invoke `loadConfig()` directly via
 * Vitest's process — without tsx registered, Node native ESM rejects `.ts`
 * imports with `Cannot find module ... theo.config.ts`.
 *
 * Implementation note: tsx 4.x on Node 22 deprecated `--loader` in favor
 * of `--import`. Use the programmatic `register()` from `tsx/esm/api`
 * which delegates to `node:module.register()` correctly under the hood.
 * Idempotent: subsequent calls noop.
 *
 * Related failures fixed (verified empirically — see
 * docs/audit/vitest-tsx-loader-fix-2026-06-05.md):
 *   - tests/unit/load-config.test.ts (EC-6 null-config + per-env merges)
 *   - tests/integration/onda{1,2,3,4,5,6,8}-mandatory.test.ts (cascade —
 *     dev-server spawn loads theo.config.ts)
 *   - tests/integration/devtools-injection.test.ts
 *   - tests/integration/auto-inject-entry-client.test.ts
 *   - tests/integration/fixture-{sessions-auth,theoui-autoinject}.test.ts
 *   - tests/integration/g3-canonical-scenarios.test.ts
 *   - tests/integration/example-prod-server.test.ts
 *   - tests/integration/cli-build-emits-cron-manifest.test.ts
 */
// 2026-06-05 update — calling `register()` here causes Node 22 to detect a
// `require()/import()` ESM "cycle" when the tsx loader hook lands back in
// the same evaluation context that triggered the load (test worker). The
// observable symptom: ~50 tests fail with `Cannot require() ES Module ...
// in a cycle`. The framework already gracefully falls back to `tsImport()`
// inside `packages/theo/src/config/import-user-module.ts` when native
// import errors out, so leaving tsx globally UNregistered here makes the
// per-call `tsImport()` only fire on the genuinely cycle-prone paths
// (vitest in-process tests) while production CLI bin still benefits from
// its own `import "tsx/esm"` at boot. Keeping the file in place
// (referenced from `vitest.config.ts setupFiles`) so future contributors
// see this rationale before re-introducing a register().
//
// import { register } from 'tsx/esm/api'
// register()
