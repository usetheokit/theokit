/**
 * A plugin may be declared by module specifier, so a deploy can carry it (usetheokit/theokit#425).
 *
 * ## Why the shape had to grow
 *
 * `config.plugins` holds CONSTRUCTED objects. A generated deploy entry cannot carry a closure —
 * there is no literal for one — so every lifecycle hook was dead on the six Web-standards targets
 * while firing locally.
 *
 * Bundling `theo.config.ts` itself into the entry was measured and rejected: it silently drops
 * `theo.config.<NODE_ENV>.ts`, which `loadConfig` merges (`config/load-config.ts:92`), and it pulls
 * every module the config imports — database drivers included — into a Worker bundle that works
 * today.
 *
 * A string entry names the module instead. The build emits a static import for it; the local server
 * imports the same module, so ONE declaration serves both and they cannot disagree.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  resolvePluginSpecifiers,
  UnresolvablePluginSpecifierError,
} from '../../packages/theo/src/config/resolve-plugin-specifiers.js'

const PLUGIN_SOURCE = `export default { name: 'from-module', register() {} }\n`

function projectWith(file: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'theo-plugin-spec-'))
  writeFileSync(join(dir, file), source)
  return dir
}

describe('a string entry is imported; everything else is passed through', () => {
  it('test_a_string_entry_becomes_the_modules_default_export', async () => {
    const cwd = projectWith('my-plugin.mjs', PLUGIN_SOURCE)

    const resolved = await resolvePluginSpecifiers(['./my-plugin.mjs'], cwd)

    expect(resolved).toHaveLength(1)
    expect((resolved[0] as { name: string }).name).toBe('from-module')
  })

  it('test_a_constructed_plugin_is_returned_untouched', async () => {
    const inline = { name: 'inline', register() {} }

    // Identity, not equality: the object the app constructed is the object that must be registered,
    // because a plugin closes over state its hooks then read.
    expect((await resolvePluginSpecifiers([inline], process.cwd()))[0]).toBe(inline)
  })

  it('test_order_is_preserved_across_both_kinds', async () => {
    const cwd = projectWith('my-plugin.mjs', PLUGIN_SOURCE)
    const inline = { name: 'inline', register() {} }

    // Plugin order is hook order. A resolver that ran the imports concurrently and collected them
    // as they settled would reorder the lifecycle by module size.
    const resolved = await resolvePluginSpecifiers(['./my-plugin.mjs', inline], cwd)

    expect(resolved.map((p) => (p as { name: string }).name)).toEqual(['from-module', 'inline'])
  })
})

describe('a specifier that cannot be resolved is named, not skipped', () => {
  it('test_a_missing_module_names_the_specifier_and_its_index', async () => {
    const cwd = projectWith('unrelated.mjs', '')

    // Skipping it would leave an app running with one fewer plugin than it declared, and nothing
    // saying so — the failure this whole issue is about, reproduced at the door.
    await expect(resolvePluginSpecifiers(['./nope.mjs'], cwd)).rejects.toThrow(
      UnresolvablePluginSpecifierError,
    )
    await expect(resolvePluginSpecifiers(['./nope.mjs'], cwd)).rejects.toThrow(/plugins\[0\]/)
  })

  it('test_a_module_with_no_default_export_says_so_rather_than_registering_undefined', async () => {
    const cwd = projectWith('no-default.mjs', 'export const notDefault = 1\n')

    await expect(resolvePluginSpecifiers(['./no-default.mjs'], cwd)).rejects.toThrow(
      /default export/,
    )
  })
})
