import { homeStateDir } from '@theocode/agent/config'

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { THEME_BASES, type ThemeBase } from './theme-base.js'

/**
 * Where the operator's colour preference is kept (#72).
 *
 * Under the unified state directory, beside `tui-session` and `tui-goal.json` — the convention this
 * surface already uses for its own durable state. NOT in `config.toml`: `theme-base.ts` records why,
 * and that reason is unchanged. The theme is a rendering concern and `AgentConfig` is the agent's
 * contract; a key there would push a surface preference through the layer boundary
 * `rules/architecture.md` § 1 draws, for a value the agent never reads.
 *
 * What DID change is the position that durability belongs to `THEOCODE_THEME` alone. That argument
 * was about reviewability, and this file is at least as reviewable as an environment variable — more
 * so, because it is written by the command the operator actually typed, rather than by a line they
 * must first learn exists and then add to a shell profile.
 */
export function themeStorePath(
  home: string = homedir(),
  env: Record<string, string | undefined> = process.env,
): string {
  return join(homeStateDir(env, home), 'tui-theme')
}

/**
 * The stored base, or `undefined` when there is none and when what is there is not one.
 *
 * `undefined` rather than the default on both paths, and the distinction is load-bearing: returning
 * `'dark'` would make the resolver report `stored` as the source for a preference nobody expressed.
 *
 * An unreadable or corrupt file is ignored rather than fatal. A cosmetic preference must never be
 * able to stop a session from starting — the same call `resolveThemeBase` makes for a typo in
 * `THEOCODE_THEME`.
 */
export function storedThemeBase(
  home: string = homedir(),
  env: Record<string, string | undefined> = process.env,
): ThemeBase | undefined {
  let raw: string
  try {
    raw = readFileSync(themeStorePath(home, env), 'utf8')
  } catch {
    return undefined
  }
  const value = raw.trim().toLowerCase()
  return (THEME_BASES as readonly string[]).includes(value) ? (value as ThemeBase) : undefined
}

/**
 * Write the preference, replacing whatever was there.
 *
 * Returns whether it landed, so `/theme` can tell the operator the truth about durability instead of
 * promising it. A failed write is not thrown for the same reason a corrupt read is not: the switch
 * itself already worked for this session, and ending the session over the memo would be worse than
 * the memo being lost.
 */
export function storeThemeBase(
  base: ThemeBase,
  home: string = homedir(),
  env: Record<string, string | undefined> = process.env,
): boolean {
  const path = themeStorePath(home, env)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${base}\n`)
    return true
  } catch {
    return false
  }
}
