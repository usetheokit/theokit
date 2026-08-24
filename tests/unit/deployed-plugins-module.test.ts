/**
 * The module a build writes beside a deployed entry so plugins reach it (usetheokit/theokit#425).
 *
 * A plugin declared as a constructed object has no literal and cannot be baked. A plugin declared
 * as a module SPECIFIER can: the build emits a static import for that module, which is the road
 * `renderBakedRoutes` already takes for route modules (#369).
 */
import { describe, expect, it } from 'vitest'

import {
  planDeployedPlugins,
  UnbakeablePluginError,
} from '../../packages/theo/src/adapters/deployed-plugins-module.js'

describe('an app with nothing to carry gets no module', () => {
  it('test_no_plugins_declared_plans_nothing', () => {
    expect(planDeployedPlugins(undefined, 'cloudflare')).toBeUndefined()
    expect(planDeployedPlugins([], 'cloudflare')).toBeUndefined()
  })
})

describe('a plugin named by module is baked as a static import', () => {
  const plan = planDeployedPlugins(
    ['./src/plugins/audit.ts', './src/plugins/auth.ts'],
    'cloudflare',
  )

  it('test_the_emitted_module_imports_every_declared_specifier', () => {
    expect(plan?.source).toMatch(/import\s+\w+\s+from\s+'\.\.\/\.\.\/src\/plugins\/audit\.ts'/)
    expect(plan?.source).toMatch(/import\s+\w+\s+from\s+'\.\.\/\.\.\/src\/plugins\/auth\.ts'/)
  })

  it('test_the_emitted_module_default_exports_the_plugins_in_declared_order', () => {
    // Plugin order is hook order. The emitted array must read in the order the config declared,
    // not in whatever order the imports were written.
    const body = plan?.source ?? ''
    expect(body).toMatch(/plugins:\s*\[__theoPlugin0,\s*__theoPlugin1\]/)
  })

  it('test_a_bare_specifier_is_a_package_and_is_left_alone', () => {
    // `../../my-plugin-pkg` is a path that does not exist. A bare specifier is a dependency the
    // target's bundler resolves from node_modules like any other, so re-basing it would break the
    // one case that needs no re-basing at all.
    const pkg = planDeployedPlugins(['@acme/theo-audit'], 'cloudflare')
    expect(pkg?.source).toMatch(/import\s+\w+\s+from\s+'@acme\/theo-audit'/)
  })

  it('test_the_specifier_the_entry_imports_is_a_sibling_of_the_entry', () => {
    // The entry and this module are written into the same directory, so the entry's import of it
    // must be relative to that directory and not to the project root.
    expect(plan?.moduleSpecifier).toBe('./theo.plugins.mjs')
  })
})

describe('a constructed plugin is refused by name, not dropped', () => {
  it('test_an_inline_plugin_names_itself_and_its_index', () => {
    // Silent degradation is what this whole issue is: the hooks were dead and nothing said so.
    // A target that CAN carry a named module but was handed a closure has something actionable to
    // say, so it says it at build time rather than at the first request.
    expect(() => planDeployedPlugins([{ name: 'audit', register() {} }], 'cloudflare')).toThrow(
      UnbakeablePluginError,
    )
    expect(() => planDeployedPlugins([{ name: 'audit', register() {} }], 'cloudflare')).toThrow(
      /plugins\[0\].*audit/s,
    )
  })

  it('test_the_message_says_what_to_do_about_it', () => {
    let message = ''
    try {
      planDeployedPlugins([{ name: 'audit', register() {} }], 'cloudflare')
    } catch (err) {
      message = (err as Error).message
    }
    // An error that only says "cannot" leaves the reader to discover the string form on their own.
    expect(message).toMatch(/specifier|module path/i)
  })
})
