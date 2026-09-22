import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { runConfigHook } from '../../packages/theo/src/vite-plugin/config-hook.js'

/**
 * B-228, the regression bullet: the next change must not reintroduce two module instances silently.
 *
 * ## Why this pins the CAUSE and not the symptom
 *
 * The symptom is a scaffold whose page renders "Unexpected Application Error!" and carries zero
 * links, because two React Router instances reach the client and the `RouterProvider` that was
 * filled is not the one `useLocation()` reads. Measuring that needs a build, a server and a browser
 * — it was run end to end on 2026-09-22 and it passed — and none of those three belong in a unit
 * suite CI repeats on every push.
 *
 * What CREATES the condition is one line, and `config-hook.ts:79-89` says so: the alias cascade's
 * catch-all maps any unlisted `theokit/*` subpath to WORKSPACE SOURCE, whose own bare
 * `react-router` import then resolves against the workspace's `node_modules` while the app's entry
 * resolves against its own. `resolve.dedupe` is what collapses the two.
 *
 * ## Why all four names, and not the one that was caught
 *
 * Only `react-router` produced the reported failure. `react` and `react-dom` carry the same hazard
 * by the same route and would produce this class of defect with a different symptom, and
 * `react-router/dom` is a separate specifier Vite resolves separately. Dropping any one of them
 * reopens the door the other three close, so the test names the set rather than the instance.
 */
const DEDUPED = ['react-router', 'react-router/dom', 'react', 'react-dom'] as const

describe('one module instance per package reaches the client (B-228)', () => {
  const config = (): Record<string, unknown> =>
    runConfigHook({
      projectRoot: resolve(__dirname, '../..'),
      theoSrcDir: resolve(__dirname, '../../packages/theo/src'),
      services: undefined,
      optimizeDepsInclude: [],
    })

  it('test_the_vite_config_dedupes_every_package_that_carries_the_hazard', () => {
    const resolveSection = config().resolve as { dedupe?: string[] } | undefined
    const dedupe = resolveSection?.dedupe

    expect(
      dedupe,
      'the vite config declares no `resolve.dedupe`, so the alias cascade can deliver two instances ' +
        'of a package to the client and the one a hook reads is not the one a provider filled',
    ).toBeDefined()

    for (const name of DEDUPED) {
      expect(
        dedupe,
        `\`${name}\` is not deduped. Two instances of it reach the client through the alias ` +
          `cascade's catch-all, which maps an unlisted \`theokit/*\` subpath to workspace source ` +
          `whose bare import resolves against a different node_modules than the app's entry`,
      ).toContain(name)
    }
  })

  it('test_the_alias_cascade_that_creates_the_hazard_is_still_there', () => {
    // Without this, the test above passes on a config that dropped the aliases entirely — which
    // would also "fix" the duplication, by breaking every `theokit/*` subpath instead. A guard that
    // survives the removal of the thing it guards against is measuring nothing.
    const resolveSection = config().resolve as { alias?: unknown[] } | undefined

    expect(
      resolveSection?.alias,
      'the alias cascade is gone, so the dedupe above no longer guards anything and this pair of ' +
        'tests would keep passing while the subpaths it exists for stopped resolving',
    ).toBeDefined()
    expect((resolveSection?.alias ?? []).length).toBeGreaterThan(0)
  })
})
