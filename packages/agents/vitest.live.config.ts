import { defineConfig } from 'vitest/config'

/**
 * Live proofs: they reach a REAL provider, so they are deliberately outside the deterministic
 * suite (`vitest.config.ts` excludes `tests/live/**`). Run with a provider key in the environment:
 *
 *   node --env-file=<path>/.env node_modules/vitest/vitest.mjs run --config vitest.live.config.ts
 */
export default defineConfig({
  test: {
    include: ['tests/live/**/*.test.ts'],
    testTimeout: 120_000,
    // Under THEOKIT_LIVE_REQUIRED=1 an absent provider key fails the run instead of skipping it.
    // Bounds the output each OpenRouter request reserves, so a low balance does not answer 402.
    setupFiles: ['../../scripts/live-openrouter-cap.mjs'],
    // One file at a time: parallel files each reserve credit while the others are in flight.
    fileParallelism: false,
    globalSetup: ['tests/live/require-provider-key.ts'],
  },
})
