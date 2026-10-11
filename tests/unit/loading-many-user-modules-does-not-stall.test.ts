import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { importUserModule } from '../../packages/theo/src/config/import-user-module.js'

/**
 * `importUserModule` falls back to tsx when Node cannot load a `.ts` file itself. `tsImport()`
 * registers a fresh loader namespace on every call and never removes it, so the hooks pile up.
 * On Node 22.12 (the `engines.node` floor) the fourth or fifth load in one process stalled until
 * the test timed out, which is how every `theokit generate schedule` test failed in CI while
 * passing on Node 22.23, whose built-in type stripping never reaches the fallback.
 *
 * Each fixture imports `./value.js` that only exists as `value.ts`. Node's own resolver does not
 * map `.js` to `.ts`, so the native import fails on every Node version and the fallback runs.
 */
describe('loading many user modules does not stall', () => {
  it('test_ten_modules_that_need_the_tsx_fallback_all_load', { timeout: 20_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'theo-user-module-many-'))
    try {
      writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n')
      const loaded: unknown[] = []
      for (let index = 0; index < 10; index++) {
        writeFileSync(join(root, `value${index}.ts`), `export const value: number = ${index}\n`)
        writeFileSync(
          join(root, `entry${index}.ts`),
          `import { value } from './value${index}.js'\nexport default value\n`,
        )
        const mod = await importUserModule(join(root, `entry${index}.ts`))
        loaded.push(mod.default)
      }

      expect(loaded).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
