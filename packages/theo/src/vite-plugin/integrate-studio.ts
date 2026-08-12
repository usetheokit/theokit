import type { Plugin } from 'vite'

/**
 * theokit#133 — mount TheoKit Studio at `/_studio` on the dev server.
 *
 * `@theokit/studio` ships a Vite plugin that serves the reflection API (`/_studio/api/*` — agents,
 * tools, skills, workflows, health) and the SPA. It was proven end-to-end on the Studio side and
 * simply never registered here, so `/_studio` answered 404 in a real `theokit dev` and the M1 DoD
 * ("reflection endpoint ON theokit's dev server") stayed open.
 *
 * ## Optional and detected, not a hard dependency
 *
 * The issue proposed `dependencies += "@theokit/studio"`. This mounts it the way the repo already
 * mounts `@theokit/ui` instead — optional peer, dynamic import, absence is a no-op (ADR-0018 /
 * ADR-0020 established that shape). A hard dependency would make every deployed app download a
 * development UI it never runs, to serve a route that only exists in dev.
 *
 * The cost of the softer wiring is that `/_studio` silently does not exist when the package is not
 * installed. That is deliberate and symmetric with `@theokit/ui`: an app that did not ask for Studio
 * should not be told about it on every boot.
 *
 * ## Dev only
 *
 * `apply: 'serve'` is enforced HERE rather than trusted from the plugin: mounting a development UI
 * on a production build is a security surface, not a papercut, and this is the layer that knows
 * which mode it is in.
 */
interface StudioModule {
  theokitStudio?: () => Plugin
}

/**
 * The real import, injectable so tests can exercise all three branches.
 *
 * A seam rather than a module mock, because `@theokit/studio` is an OPTIONAL peer and is therefore
 * NOT installed in this repo — and vitest cannot mock a specifier it cannot resolve. Testing the
 * "package present" and "package malformed" branches has no other route. Mirrors `loadSwc` in
 * `@theokit/http`'s swc loader, which is injectable for the same reason.
 */
type StudioImporter = () => Promise<StudioModule>

export async function integrateStudio(
  // The specifier is resolved at RUNTIME, not by `tsc`: `@theokit/studio` is an optional peer, so
  // it is absent from this repo and a static import would fail the typecheck for every consumer who
  // never installs it. The `catch` above is the real contract — absence is a supported state.
  importStudio: StudioImporter = () =>
    import(/* @vite-ignore */ '@theokit/studio' + '/plugin') as Promise<StudioModule>,
): Promise<Plugin[]> {
  let mod: StudioModule | undefined
  try {
    mod = await importStudio()
  } catch {
    // Not installed — the normal case for an app that never asked for Studio. Silent by design:
    // a boot-time notice about an optional dev tool is noise on every single `theokit dev`.
    return []
  }

  if (typeof mod.theokitStudio !== 'function') {
    // Installed but NOT shaped as expected — a version skew, and the one case that must be loud.
    // Silence here would present "Studio is broken" as "Studio is not installed", which sends the
    // user looking in the wrong place entirely (error-handling.md § 2).
    console.warn(
      '[theokit] @theokit/studio is installed but does not export `theokitStudio()` from ' +
        '`@theokit/studio/plugin`. /_studio will not be served. Check the installed version.',
    )
    return []
  }

  const plugin = mod.theokitStudio()
  // The Studio plugin guards itself (`next()` for anything outside `/_studio`), so ordering against
  // the other middlewares does not matter.
  return [{ ...plugin, apply: 'serve' }]
}
