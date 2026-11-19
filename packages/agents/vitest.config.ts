import { cpus } from 'node:os'
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@theokit/http/runtime/node': resolve(__dirname, '../http/src/runtime-node.ts'),
      '@theokit/http': resolve(__dirname, '../http/src/index.ts'),
      // The subpath comes BEFORE the barrel: the alias is prefix-first, so mapping only
      // `@theokit/presenter` would make `@theokit/presenter/wire` resolve to the barrel and fail.
      '@theokit/presenter/wire': resolve(__dirname, '../presenter/src/wire/index.ts'),
      '@theokit/presenter': resolve(__dirname, '../presenter/src/index.ts'),
    },
  },
  test: {
    // Default is os.availableParallelism(): one fork per core, each booting a full
    // test environment. Capping leaves headroom for the host, and costs no wall-clock
    // because the gain above this point was already noise when measured.
    maxWorkers: Math.max(2, cpus().length - 4),
    include: ['tests/**/*.test.ts'],
    // `tests/live/**` hits a real provider: excluded from the deterministic suite
    // (rules/testing.md § 3 — flaky-by-nature tests are not unit tests) and run on demand
    // via `npm run test:live`. It is still typechecked by the root tsconfig.
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/live/**'],
    // `tests/type/*.test-d.ts` matched no `include` and no typecheck config, so six
    // type tests were compiled by `tsc` as ordinary source and asserted nothing —
    // `expectTypeOf` is inert without the typechecker driving it
    // (usetheokit/theokit#357). The root project has carried this block since the
    // split; this package never got it.
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test-d.ts'],
      // The PACKAGE's test tsconfig, not the root one. The root config expects the
      // whole monorepo built, and the CI job that runs this builds only
      // `@theokit/agents...` — so pointing at the root turned every unbuilt
      // sibling into `Cannot find module 'theokit/client/core'`. This one carries
      // the package's own path mappings and includes `tests/**`.
      tsconfig: './tsconfig.test.json',
    },
  },
})
