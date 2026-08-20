import { defineConfig } from 'vitest/config'

/**
 * `packages/theo/tests/**` ran in no project at all until this file existed
 * (usetheokit/theokit#357). The package's `test` script says the tests run from
 * the root — `vitest.config.ts` there covers `tests/**` and the sibling packages,
 * and never included this one. Six files typechecked and never executed.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
