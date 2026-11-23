import { defineConfig } from 'vitest/config'

/**
 * Live proof run by the live-model CI job (B-407, B-415): the A2A call reaches a REAL provider, so
 * the job runs it with a key and `THEOKIT_LIVE_REQUIRED=1`, and an absent key fails the run instead
 * of skipping green. The deterministic suite (`vitest.config.ts`) still collects the same file and
 * skips it when no key is set.
 *
 * Only the A2A test: `one-real-turn.test.ts`, the other file under `tests/live/`, needs a local
 * ollama server rather than a provider key, and the CI job has none.
 */
export default defineConfig({
  test: {
    include: ['packages/agent/tests/live/an-a2a-call-reaches-a-real-model.test.ts'],
    environment: 'node',
    testTimeout: 180_000,
    globalSetup: ['tools/require-provider-key.mjs'],
  },
})
