/**
 * The half of the deployed configuration that is not a literal (usetheokit/theokit#425).
 *
 * `csrf` and `disallowed` reached the six Web-standards targets as baked literals because they are
 * plain data. `plugins` and `serialization.transformer` carry FUNCTIONS, and there is no literal
 * for a closure — so the generated entry has to import the app's own config module instead.
 *
 * These assertions are about the emitted SOURCE, which is the artifact the defect lives in: the
 * field was absent from the context the entry built, so every lifecycle hook was dead on a deployed
 * app while working locally.
 */
import { describe, expect, it } from 'vitest'

import { deployedRuntimeConfigFragment } from '../../packages/theo/src/adapters/deployed-runtime-config.js'

describe('an app that carries no plugins and no transformer pays nothing', () => {
  it('test_no_config_module_emits_no_import_and_no_spread', () => {
    const fragment = deployedRuntimeConfigFragment(undefined)

    // An entry for an app with nothing to carry must stay byte-identical to what it was: the
    // import of a module the build did not emit would fail at load, and a spread of an empty
    // object is a per-request allocation for nothing.
    expect(fragment.imports).toEqual([])
    expect(fragment.executeRouteSpread).toBe('')
  })
})

describe('an app that declares plugins reaches the deployed entry', () => {
  const fragment = deployedRuntimeConfigFragment('./theo.runtime-config.mjs')

  it('test_the_entry_imports_the_config_module_the_build_emitted', () => {
    // Quote style is not the property; importing the module the build emitted is. Pinning the
    // exact characters would fail the next time the emitter is reformatted and would say nothing.
    expect(fragment.imports.join('\n')).toMatch(
      /import\s+\w+\s+from\s+['"]\.\/theo\.runtime-config\.mjs['"]/,
    )
  })

  it('test_the_runner_is_built_once_at_module_scope_not_per_request', () => {
    const source = fragment.declarations.join('\n')
    // The construction must sit in the declarations (module scope). A runner rebuilt per request
    // would re-run every plugin's `register`, which is where a plugin allocates its own state.
    expect(source).toMatch(/createPluginRunnerFromConfig/)
    expect(fragment.executeRouteSpread).not.toMatch(/createPluginRunnerFromConfig/)
  })

  it('test_the_executeRoute_call_receives_both_the_runner_and_the_transformer', () => {
    // Both are what `executeRoute` already reads (`server/http/execute.ts`); the defect was only
    // ever that nothing put them in the object.
    expect(fragment.executeRouteSpread).toMatch(/pluginRunner/)
    expect(fragment.executeRouteSpread).toMatch(/transformer/)
  })

  it('test_the_runner_promise_is_awaited_rather_than_passed_as_a_promise', () => {
    // `createPluginRunnerFromConfig` is async because `register` is. Handing `executeRoute` the
    // promise instead of the runner is a truthy object with none of the methods — every hook would
    // silently not fire, which is the defect this closes, reintroduced one layer in.
    expect(fragment.executeRouteSpread).toMatch(/await/)
  })
})
