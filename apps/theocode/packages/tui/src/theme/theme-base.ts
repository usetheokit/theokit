/**
 * B-073 — where the theme base comes from.
 *
 * It was the literal `'dark'` in `theme.ts`, while the toolkit's type admits three values. A
 * light-terminal user had no recourse and `no-color` was unreachable, which is the value that
 * matters most: a piped, logged or screen-reader-driven terminal wants no escape codes at all.
 *
 * Resolved from the ENVIRONMENT rather than from `config.toml`. The theme is a surface concern and
 * `AgentConfig` is the agent's contract — adding a key there would push a rendering preference
 * through the layer boundary `rules/architecture.md` § 1 draws, for a value the agent never reads.
 *
 * `NO_COLOR` is reused, not invented (parsimony ladder rung 3): it already works across tools, so a
 * user who set it once is served here with one branch.
 */

export const THEME_BASES = ['dark', 'light', 'no-color'] as const

export type ThemeBase = (typeof THEME_BASES)[number]

/** Unchanged from the literal it replaces — an upgrade must not repaint anyone's terminal. */
export const DEFAULT_THEME_BASE: ThemeBase = 'dark'

export interface ThemeResolution {
  readonly base: ThemeBase
  /** Which input decided it — reported so `/status` can answer "why is it this colour?". */
  readonly source: 'NO_COLOR' | 'THEOCODE_THEME' | 'stored' | 'default'
  /**
   * The rejected value, when `THEOCODE_THEME` held something outside the vocabulary. Present so the
   * caller can SAY so: falling back silently after being asked for `drak` is the swallowed error
   * `rules/error-handling.md` § 2 forbids. It is returned rather than thrown because a typo in a
   * cosmetic knob must not end the session.
   */
  readonly invalid?: string
}

/** The answer once both environment signals have declined: the stored preference, or the default. */
function fallback(stored?: ThemeBase): ThemeResolution {
  return stored === undefined
    ? { base: DEFAULT_THEME_BASE, source: 'default' }
    : { base: stored, source: 'stored' }
}

function parseThemeBase(input: string): ThemeBase | null {
  const v = input.trim().toLowerCase()
  return (THEME_BASES as readonly string[]).includes(v) ? (v as ThemeBase) : null
}

/**
 * Resolve the theme base, most specific signal first.
 *
 * `NO_COLOR` outranks the product's own knob deliberately: it is an accessibility signal from the
 * environment, and a user who wants colour back unsets it rather than reconciling two settings.
 * Per no-color.org it is the PRESENCE of a non-empty value that carries the meaning, never the
 * value itself.
 */
export function resolveThemeBase(
  env: Readonly<Record<string, string | undefined>>,
  /**
   * What `/theme` last stored (#72). Below both environment signals: someone who exports a variable
   * for this invocation is addressing this invocation, and a stored preference that silently won
   * would make the variable inert — the same precedence `THEOKIT_HOME` has over `home_dir`.
   */
  stored?: ThemeBase,
): ThemeResolution {
  const noColor = env.NO_COLOR
  if (noColor !== undefined && noColor !== '') {
    return { base: 'no-color', source: 'NO_COLOR' }
  }

  const requested = env.THEOCODE_THEME
  if (requested !== undefined && requested.trim() !== '') {
    const parsed = parseThemeBase(requested)
    if (parsed !== null) return { base: parsed, source: 'THEOCODE_THEME' }
    // The rejected value travels with whatever decides instead. Dropping it here would hide the typo
    // the user needs to see, and hiding it is what turns a silent fallback into a reported bug.
    return { ...fallback(stored), invalid: requested }
  }

  return fallback(stored)
}
