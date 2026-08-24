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
    const fragment = deployedRuntimeConfigFragment({})

    // An entry for an app with nothing to carry must stay byte-identical to what it was: the
    // import of a module the build did not emit would fail at load, and a spread of an empty
    // object is a per-request allocation for nothing.
    expect(fragment.imports).toEqual([])
    expect(fragment.executeRouteSpread).toBe('')
  })
})

describe('an app that declares plugins reaches the deployed entry', () => {
  const fragment = deployedRuntimeConfigFragment({
    runtimeConfigModule: './theo.runtime-config.mjs',
  })

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

  it('test_the_executeRoute_call_receives_the_runner', () => {
    // What `executeRoute` already reads (`server/http/execute.ts:181`); the defect was only ever
    // that nothing put it in the object.
    expect(fragment.executeRouteSpread).toMatch(/pluginRunner/)
  })

  it('test_plugins_alone_do_not_drag_in_a_transformer', () => {
    // The two halves are independent: an app with plugins and default JSON must not pay for a
    // transformer lookup it did not ask for.
    expect(fragment.executeRouteSpread).not.toMatch(/transformer/)
  })

  it('test_the_runner_promise_is_awaited_rather_than_passed_as_a_promise', () => {
    // `createPluginRunnerFromConfig` is async because `register` is. Handing `executeRoute` the
    // promise instead of the runner is a truthy object with none of the methods — every hook would
    // silently not fire, which is the defect this closes, reintroduced one layer in.
    expect(fragment.executeRouteSpread).toMatch(/await/)
  })
})

describe('serialization is a literal, not an import (usetheokit/theokit#425)', () => {
  it('test_superjson_is_resolved_from_the_selector_the_config_declares', () => {
    const fragment = deployedRuntimeConfigFragment({ serialization: 'superjson' })

    // `config.serialization` is `z.enum(['json','superjson'])` — a SELECTOR. The issue read it as
    // an object carrying functions; it is not, which is why this half needs no module at all.
    expect(fragment.declarations.join('\n')).toMatch(/resolveTransformer\(\s*'superjson'\s*\)/)
    expect(fragment.executeRouteSpread).toMatch(/transformer/)
  })

  it('test_superjson_alone_does_not_drag_in_a_plugin_runner', () => {
    const fragment = deployedRuntimeConfigFragment({ serialization: 'superjson' })

    expect(fragment.executeRouteSpread).not.toMatch(/pluginRunner/)
    expect(fragment.imports.join('\n')).not.toMatch(/createPluginRunnerFromConfig/)
  })

  it('test_the_default_selector_emits_nothing', () => {
    // `executeRoute` already falls back to `JSON.stringify`, and it deliberately omits the
    // `x-theo-transformer` header for the default so a client is told only when there is something
    // to be told. Emitting a lookup that reproduces the fallback would be cost for no signal.
    expect(deployedRuntimeConfigFragment({ serialization: 'json' })).toEqual(
      deployedRuntimeConfigFragment({}),
    )
  })
})
