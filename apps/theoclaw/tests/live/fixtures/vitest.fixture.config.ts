import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

/**
 * The config of the EC-1 fixture only (B-512, T1.2). Its include lies outside the package's
 * `tests/**\/*.test.ts`, so the package suite never runs the fixture's intended failure; only
 * `ssh-forward-cleanup.live.test.ts` runs it, in a child vitest. The fixture's setup takes up to
 * 10000 ms, over vitest's 5000 ms default, so both timeouts are the live files' 60000 ms.
 */
export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  test: {
    include: ['tests/live/fixtures/*.fixture.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
