import { defineConfig } from 'vitest/config'

/**
 * Live proofs: they reach a REAL provider, so they are deliberately outside the deterministic
 * suite (`vitest.config.ts` excludes `tests/live/**`). Run with a provider key in the environment:
 *
 *   node --env-file=<path>/.env node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 */
export default defineConfig({
  test: { include: ['tests/live/**/*.test.ts'], testTimeout: 120_000 },
})
