import { describe, expect, it, vi } from 'vitest'

import { integrateStudio } from '../../packages/theo/src/vite-plugin/integrate-studio.js'

/**
 * theokit#133 — Studio is mounted on the dev server, and its absence costs nothing.
 *
 * `@theokit/studio` shipped a Vite plugin that serves `/_studio` + `/_studio/api/*`, proven
 * end-to-end on the Studio side, and it was simply never registered here — so `/_studio` 404'd in a
 * real `theokit dev` and the M1 DoD ("reflection endpoint ON theokit's dev server") stayed open.
 *
 * ## What is pinned, and why these three cases
 *
 * The issue proposed a hard `dependencies` entry. This mounts Studio the way the repo already mounts
 * `@theokit/ui` — optional, detected, absent ⇒ no-op — because a hard dependency makes every
 * deployed app download a development UI it never runs.
 *
 * That choice creates exactly one new way to be wrong, and it is the third test: a package that is
 * INSTALLED but does not export what we call must be LOUD. Silence there would report "Studio is
 * broken" as "Studio is not installed" and send the user looking in the wrong repo.
 */
describe('theokit#133 — Studio mounting', () => {
  it('test_the_plugin_is_mounted_when_the_package_is_present', async () => {
    const studioPlugin = { name: '@theokit/studio' }
    const plugins = await integrateStudio(async () => ({ theokitStudio: () => studioPlugin }))
    expect(plugins, 'Studio is installed but was not mounted — /_studio still 404s').toHaveLength(1)
    expect(plugins[0]?.name).toBe('@theokit/studio')
    // Dev-only is enforced HERE, not trusted from the plugin: mounting a development UI on a
    // production build is a security surface, and this is the layer that knows the mode.
    expect(plugins[0]?.apply, 'Studio would be mounted on a production build').toBe('serve')
  })

  it('test_an_app_without_studio_pays_nothing', async () => {
    // The back-compat floor for every app that never asked for Studio. Absence must be a silent
    // no-op, not a warning on every `theokit dev` about an optional dev tool.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missing = async (): Promise<never> => {
      throw new Error("Cannot find module '@theokit/studio/plugin'")
    }

    expect(await integrateStudio(missing)).toEqual([])
    expect(warn, 'a missing OPTIONAL package warned on boot — that is noise').not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('test_an_INSTALLED_but_wrong_shaped_package_is_LOUD', async () => {
    // The failure mode the optional wiring introduces. A version skew that drops or renames
    // `theokitStudio` must not look like "not installed": the two have completely different fixes,
    // and the silent path would send the user to the wrong repo entirely.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await integrateStudio(async () => ({}))).toEqual([])
    expect(
      warn,
      'a broken Studio install was indistinguishable from an absent one',
    ).toHaveBeenCalled()
    expect(String(warn.mock.calls[0]?.[0])).toContain('theokitStudio')
    warn.mockRestore()
  })
})
