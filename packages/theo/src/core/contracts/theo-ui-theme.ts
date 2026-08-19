/**
 * The `@theokit/ui` theme name — a contract shared by the config schema, the entry generators and
 * the Vite plugin's detector.
 *
 * It lives in `core/contracts/` because those three sit in different modules that may not depend on
 * one another: `config/` and `router/` are allowed to reach into `core/` only. Before this file the
 * union was written out separately in all three places, and all three drifted from what the design
 * system actually ships.
 */

/**
 * Theme names `@theokit/ui` ships today — an autocomplete hint, NOT the accepted set.
 *
 * The accepted set used to be exactly `'violet-forge' | 'noir' | 'paper'`, and two of those three
 * were never real: the design system has no `noir` and no `paper`. So the only value config
 * validation accepted was the default, and every genuine theme — plus anything from
 * `defineTheme()` — was rejected.
 *
 * A closed union here is a copy of another package's catalogue; it rots the moment that package
 * ships a theme. This list is therefore advisory, and {@link TheoUiTheme} stays open. The
 * authoritative list is `builtinThemes`, exported by `@theokit/ui`.
 */
export type BuiltinThemeName =
  | 'violet-forge'
  | 'falcon-red'
  | 'classic-paper'
  | 'aurora-terminal'
  | 'vercel-mono'
  | 'github-dark'
  | 'dracula'
  | 'one-dark'
  | 'anthropic-style'
  | 'openai-style'
  | 'linear-glass'

/**
 * A theme name. Built-ins autocomplete; a custom theme from `defineTheme()` is equally valid.
 *
 * `(string & {})` is the idiomatic way to keep literal suggestions on an open union — without it
 * TypeScript widens the whole type to `string` and the hints disappear.
 */
export type TheoUiTheme = BuiltinThemeName | (string & {})

/** How fonts are delivered — bundled with the app, or fetched from a CDN. */
export type TheoUiFonts = 'bundled' | 'cdn'

/**
 * The shape a theme name must have — mirrors the pattern `@theokit/ui`'s `ThemeProvider` enforces
 * before it writes `[data-theme="<name>"]`.
 *
 * Validating here is not cosmetic. The value is interpolated into the generated entry
 * (`defaultTheme: '<name>'`) and into a CSS selector, so an unchecked name is a code-injection
 * vector — and anything this rejects would be rejected by the provider anyway, so the developer
 * gets the error at config time instead of at render time.
 */
export const THEME_NAME_PATTERN = /^[a-z][a-z0-9-]*$/
