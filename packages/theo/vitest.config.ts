import { cpus } from 'node:os'

import { defineConfig } from 'vitest/config'

/**
 * `packages/theo/tests/**` ran in no project at all until this file existed
 * (usetheokit/theokit#357). The package's `test` script says the tests run from
 * the root — `vitest.config.ts` there covers `tests/**` and the sibling packages,
 * and never included this one. Six files typechecked and never executed.
 */
export default defineConfig({
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
