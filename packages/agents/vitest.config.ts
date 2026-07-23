import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@theokit/http/runtime/node': resolve(__dirname, '../http/src/runtime-node.ts'),
      '@theokit/http': resolve(__dirname, '../http/src/index.ts'),
      '@theokit/presenter': resolve(__dirname, '../presenter/src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // `tests/live/**` hits a real provider: excluded from the deterministic suite
    // (rules/testing.md § 3 — flaky-by-nature tests are not unit tests) and run on demand
    // via `npm run test:live`. It is still typechecked by the root tsconfig.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/live/**'],
  },
})
