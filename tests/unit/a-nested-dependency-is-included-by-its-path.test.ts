/**
 * The include hint that named the problem and then used the mechanism with the problem.
 *
 * `buildOptimizeDepsInclude` pushed the bare specifier `'devalue'`, under a comment that already said
 * why a bare specifier cannot work here: *"devalue lives in theokit's node_modules subtree, not the
 * consumer root"*. Vite resolves `optimizeDeps.include` entries from its ROOT — which is the consumer —
 * so the hint asked Vite to find the package exactly where the comment says it is not.
 *
 * Measured 2026-09-30 on a `create-theokit` scaffold installed from npm. `devalue` does not resolve
 * from the app (`theokit` declares `^5.8.1` and pnpm does not hoist it), and every `theokit dev` boot
 * printed:
 *
 *     Failed to resolve dependency: devalue, present in client 'optimizeDeps.include'
 *
 * Sabotage-verified on the platform rather than in a mock: with `'theokit > devalue'` the boot printed
 * it **0** times; reverting that one line to `'devalue'` and rebuilding brought it back to **1**. Same
 * scaffold, same boot, one specifier different.
 *
 * `'parent > child'` is Vite's documented form for a dependency reached THROUGH another one, which is
 * exactly the relationship the original comment describes.
 */
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildOptimizeDepsInclude } from '../../packages/theo/src/vite-plugin/index.js'

const ROOT = resolve(import.meta.dirname, '../..')

describe('a nested dependency is included by its path', () => {
  it('names devalue through theokit rather than bare', () => {
    // THE case. The bare form is resolved from the consumer root, where devalue is not.
    const include = buildOptimizeDepsInclude(ROOT, undefined)

    expect(
      include,
      'the bare specifier is resolved from the Vite root — the consumer — and devalue lives in ' +
        "theokit's subtree, which is what the hint's own comment says",
    ).toContain('theokit > devalue')
  })

  it('does not also push the bare form', () => {
    // COUNTERPROOF: keeping both would leave the failing entry in place and the warning with it.
    expect(buildOptimizeDepsInclude(ROOT, undefined)).not.toContain('devalue')
  })

  it('still carries what a project asked for', () => {
    // The caller's own `viteOptimizeDeps` must survive: this function merges rather than replaces, and
    // a fix that dropped the caller's list would be silent.
    const include = buildOptimizeDepsInclude(ROOT, ['some-consumer-package'])

    expect(include).toContain('some-consumer-package')
    expect(include).toContain('theokit > devalue')
  })
})
