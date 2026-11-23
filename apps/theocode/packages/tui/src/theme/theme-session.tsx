/**
 * `/theme <base>` — repainting the running frame, for this session only.
 *
 * The base used to be a module constant: `theme.ts` resolved the environment at import and `App`
 * handed the result to `<TheoTUIProvider>` as a fixed prop, so nothing typed after startup could
 * change a colour. `/theme light` therefore had to be refused out loud, which is honest and still
 * leaves a light-terminal user editing an environment variable and relaunching to see the frame
 * they wanted.
 *
 * The seam is the base, not the theme. `resolveThemeBase` is already a pure function of the
 * environment, so the only thing this module adds is a value that can sit IN FRONT of its answer —
 * a toolkit `createThemeController` holding the whole theme prop, handed to the provider as
 * `controller` so React learns about the write. TheoCode keeps no external store of its own.
 *
 * The OVERRIDE is per-session; the CHOICE is not, since #72. This paragraph used to read "NOT
 * PERSISTED, deliberately", borrowing `memory-switch.ts`'s argument that a durable preference
 * belongs somewhere reviewable rather than in a switch someone flipped once and forgot. `/theme`
 * reversed that and the comment did not follow: `handleTheme` calls `persist(known)` ->
 * `storeThemeBase()`, `storedThemeBase()` comes back as the `stored` source of `resolveThemeBase`,
 * and `theme-store.ts` records the reversal in its own words. A stale argument is the load-bearing
 * kind of stale comment — it is what a maintainer would cite when deciding whether persistence
 * belongs here, and it argued against shipped behaviour.
 *
 * What survives is the reviewability the old argument was really about: the file is named in the
 * toast, `THEOCODE_THEME` still outranks it, and `/theme` and `/status` both report when an
 * override is in force — so it is never a silent divergence from what the environment says.
 * A CUSTOM theme is the exception and is genuinely session-only: `storeThemeBase` takes a
 * `ThemeBase`, and there is nowhere for a slug to go.
 *
 * `NO_COLOR` outranks the override. `TheoTUIProvider` returns the no-colour theme whenever the
 * variable is non-empty, whatever this slot holds, so `handleTheme` refuses colour selections while
 * it is set and says why (`/theme no-color` is still accepted) instead of reporting a switch the
 * frame would never show.
 */
import type { ReactElement, ReactNode } from 'react'

import { TheoTUIProvider, createThemeController } from '@theokit/tui'

import type { TheoThemeProp } from '@theokit/tui'

import type { ThemeBase } from './theme-base.js'
import { THEME_RESOLUTION, THEMES } from './theme.js'

/**
 * The controller holds a whole THEME PROP (a built-in, or a custom theme's base plus override),
 * built once at selection: the provider memoizes on the IDENTITY of the prop.
 */
const initialTheme = (): TheoThemeProp => THEMES[THEME_RESOLUTION.base]
const controller = createThemeController(initialTheme())

/**
 * What `/theme` selected, for `/status` and for `/theme`'s own report: a base name, or
 * `custom:<slug>`. `undefined` while the environment still decides.
 *
 * #14 — this used to sit beside a narrower accessor that answered only "which of the three built-in
 * bases", so after `/theme custom:midnight` the reports described the environment's answer while
 * the frame was drawn in the operator's own file. One selection, one fact, no second accessor.
 */
let sessionLabelValue: string | undefined

export function sessionThemeLabel(): string | undefined {
  return sessionLabelValue
}

/**
 * Switch the base and tell the frame.
 *
 * The notification is load-bearing: without it the next render would pick the new base up by
 * accident and the one after it would not — a UI that repaints on unrelated keystrokes is read as
 * a rendering bug rather than as a command.
 */
export function setSessionThemeBase(base: ThemeBase): void {
  sessionLabelValue = base
  setSessionTheme(THEMES[base])
}

/**
 * Switch to a whole theme prop — the path a custom theme takes.
 *
 * `label` is what `/status` and `/theme` report; a custom theme passes `custom:<slug>`.
 */
export function setSessionTheme(prop: TheoThemeProp, label?: string): void {
  if (label !== undefined) sessionLabelValue = label
  controller.set(prop)
}

/** The provider, driven by the controller, so a switch reaches `useTheoTheme()` in a child. */
export function ThemedSurface({ children }: { children: ReactNode }): ReactElement {
  return <TheoTUIProvider controller={controller}>{children}</TheoTUIProvider>
}

/** Test-only: drop the override so each test starts from the environment's answer. */
export function resetSessionThemeForTest(): void {
  controller.set(initialTheme())
  sessionLabelValue = undefined
}

/** Test-only: the shared controller, so a test can spy on `subscribe` to see the unsubscribe. */
export function themeControllerForTest(): typeof controller {
  return controller
}
