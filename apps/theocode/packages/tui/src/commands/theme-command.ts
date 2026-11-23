/**
 * `/theme` — reporting the colour decision, and now changing it.
 *
 * Codex offers `/theme` as a live picker. This one used to REFUSE every argument, because the base
 * was resolved once at module load and handed to the provider as a constant — a command that
 * accepted `light` and left the terminal exactly as it was would have been read as "applied", and
 * the next thing that user reported was the colour as a rendering bug. `theme-session.tsx` removed
 * that constraint by putting a one-slot override in front of the environment's answer, so the
 * refusal has nothing left to protect and the command switches.
 *
 * What survives from the refusing version is the shape of its honesty. An unknown word is still
 * turned down by NAMING the vocabulary rather than being dropped, and the report still says which
 * input decided the colour — including a `THEOCODE_THEME` value that was thrown away to get there.
 *
 * The switch is REMEMBERED (#72), and the message says which of the two happened. It used to be
 * session-only, on the argument that a durable preference belongs in `THEOCODE_THEME` "where it can
 * be reviewed". That argument was about reviewability, and a file this command writes is at least as
 * reviewable as an environment variable — more so, because the operator does not have to first learn
 * the variable exists and then edit a shell profile. What survives is the honesty: the toast names
 * the file, says the variable still overrides it, and says plainly when the write did not land.
 */
import { homedir } from 'node:os'

import type { ToastPayload } from '../screen-types.js'
import { listCustomThemes, loadCustomTheme } from '../theme/custom-theme.js'
import { THEME_BASES, type ThemeBase, type ThemeResolution } from '../theme/theme-base.js'
import { sessionThemeLabel, setSessionTheme, setSessionThemeBase } from '../theme/theme-session.js'
import { THEME_RESOLUTION } from '../theme/theme.js'

/**
 * Their prefix, not one invented here. Their docs say a custom theme "appears as `custom:<slug>`
 * where `<slug>` is the filename without `.json`"; reading their directory in their format and then
 * naming the result differently would make the two halves disagree for no gain.
 */
const CUSTOM_PREFIX = 'custom:'

/**
 * `/theme custom:<slug>`.
 *
 * A slug with no file is REFUSED rather than falling back to a base. An operator who typed a slug is
 * asking for that theme; repainting to `dark` and reporting success is the shape that gets read as
 * a rendering bug rather than as a missing file.
 */
function selectCustom(
  slug: string,
  setToast: (toast: ToastPayload) => void,
  home: string,
): void {
  const loaded = loadCustomTheme(slug, home)
  if (loaded === null) {
    const available = listCustomThemes(home).map((t) => `${CUSTOM_PREFIX}${t.slug}`)
    setToast({
      message:
        `no custom theme "${slug}" under ~/.claude/themes/` +
        (available.length > 0 ? ` — found ${available.join(', ')}` : ''),
      variant: 'error',
    })
    return
  }
  setSessionTheme(loaded.prop, `${CUSTOM_PREFIX}${slug}`)
  // Six of their ~40 tokens map onto this product's theme. Saying which parts of the file did not
  // arrive is the other half of accepting it at all — the alternative teaches the operator that a
  // theme they wrote is fully in force when a sixth of it is.
  const lost =
    loaded.notApplied.length > 0 ? ` — not applied: ${loaded.notApplied.join('; ')}` : ''
  setToast({
    message: `theme: ${loaded.name} (${CUSTOM_PREFIX}${slug}), this session${lost}`,
    variant: 'success',
  })
}

/**
 * How the active theme reads: the base being drawn, what decided it, and the value thrown away.
 *
 * Shared with the `theme` row of `/status` rather than written twice. The rejected-value clause is
 * the half that would drift: the resolver falls back silently so a typo cannot end the session, and
 * these two lines are the only places that turn that fallback back into something a user can see.
 *
 * `override` is a SECOND fact, not a replacement for the first, so the line carries both. "It is
 * light" and "the terminal would have given you dark" answer different questions, and collapsing
 * them would leave a user who has forgotten they typed `/theme` unable to tell a session override
 * from an environment they need to go and fix.
 *
 * #14 — `override` is a LABEL (`string`), not a `ThemeBase`. It was the narrower type, fed by an
 * accessor that returned `undefined` after `/theme custom:<slug>`, so the one selection this line
 * exists to announce was the one it could not carry.
 */
export function themeResolutionLine(resolution: ThemeResolution, override?: string): string {
  const rejected =
    resolution.invalid === undefined
      ? ''
      : ` — ignored THEOCODE_THEME=${resolution.invalid}, expected ${THEME_BASES.join(' | ')}`
  const environment = `${resolution.base} (${resolution.source})${rejected}`
  if (override === undefined) return environment
  return `${override} (/theme, this session) — the environment resolves ${environment}`
}

/** Said on the branches that did not switch: the answer to "so how do I change it?" is one line. */
const HOW_TO_CHANGE =
  `/theme ${THEME_BASES.join(' | ')} switches this session; ` +
  'set THEOCODE_THEME to the same values to make it the default at launch'

/**
 * `/theme` reports; `/theme <base>` switches; `/theme <anything else>` is refused by name.
 *
 * The refusal is `error` rather than `info` and the switch is `success` rather than either: the
 * variant is the only part of a toast read at a glance, and an informational tone on an unperformed
 * action is exactly what makes a no-op look like it worked.
 */
export function handleTheme(
  arg: string,
  setToast: (toast: ToastPayload) => void,
  /**
   * Injected, and REQUIRED — not defaulted to the real writer.
   *
   * It did write into the operator's real home, once: with a default, three existing call sites kept
   * the two-argument form and running the suite left a `tui-theme` file on the machine of whoever
   * ran it, silently changing the colour they would see at the next launch. A default seam is a seam
   * you have to remember; a required one is one the compiler asks about.
   */
  persist: (base: ThemeBase) => boolean,
  describeStore: () => string,
  /** Injected so the suite never reads — or reports on — the machine's real `~/.claude/themes/`. */
  home: string = homedir(),
): void {
  const requested = arg.trim()
  if (requested.length === 0) {
    // The custom themes are listed here because nothing else tells an operator which slugs exist;
    // a feature discoverable only by reading the source is a feature nobody uses.
    // #14 — the one in FORCE is excluded. It is already named at the head of this line as the
    // active theme, and repeating it after "also" offers the operator a switch to where they
    // already are — the report contradicting itself in a single sentence.
    const active = sessionThemeLabel()
    const custom = listCustomThemes(home)
      .map((t) => `${CUSTOM_PREFIX}${t.slug}`)
      .filter((label) => label !== active)
    const also = custom.length > 0 ? ` — also ${custom.join(', ')}` : ''
    setToast({
      message: `theme: ${themeResolutionLine(THEME_RESOLUTION, active)} — ${HOW_TO_CHANGE}${also}`,
      variant: 'info',
    })
    return
  }
  if (requested.toLowerCase().startsWith(CUSTOM_PREFIX)) {
    selectCustom(requested.slice(CUSTOM_PREFIX.length), setToast, home)
    return
  }
  // Lower-cased before the lookup because `DARK` is the value, typed the way a shell exports it.
  // Calling it an unknown word would send the user to fix a spelling that is already right.
  const wanted = requested.toLowerCase()
  const known = THEME_BASES.find((base) => base === wanted)
  if (known === undefined) {
    setToast({
      message: `"${requested}" is not a theme — expected ${THEME_BASES.join(' | ')}`,
      variant: 'error',
    })
    return
  }
  setSessionThemeBase(known)
  // #72 — the switch is remembered. Reported honestly on both branches rather than promised: a
  // failed write still leaves the session switched, and telling the operator it will persist when it
  // will not is the one outcome worse than not persisting at all.
  const kept = persist(known)
  setToast({
    message: kept
      ? `theme: ${known} — remembered for next launch too (${describeStore()}); THEOCODE_THEME still overrides it`
      : `theme: ${known} — this session only; ${describeStore()} could not be written`,
    variant: 'success',
  })
}
