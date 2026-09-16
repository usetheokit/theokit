/**
 * Custom themes — Claude Code's `~/.claude/themes/*.json`, read into this product's theme.
 *
 * Format measured against `code.claude.com/docs/en/terminal-config.md` on 2026-09-07:
 * `{ name?, base?, overrides? }`, with six base names, roughly forty flat colour tokens and five
 * colour notations.
 *
 * ## The two vocabularies do not line up, and this file says so out loud
 *
 * Theirs is ~40 flat tokens (`claude`, `rate_limit_fill`, `briefLabelYou`, eight subagent colours,
 * seven rainbow tokens). The toolkit's is structured: `{ accent, status, diff, role, code,
 * toolStatus }`. SIX tokens map with confidence, and they are the six below.
 *
 * Everything else — an unmapped token, a base variant this product has no equivalent for, a colour
 * notation it cannot render — is REPORTED BY NAME. A theme that silently applies a sixth of itself
 * is the same defect as a config key that is silently ignored: the operator sees their file was
 * accepted and concludes the rest arrived.
 *
 * ## Why the colour notation is filtered rather than forwarded
 *
 * Their docs allow `#rrggbb`, `#rgb`, `rgb(r,g,b)`, `ansi256(n)` and `ansi:<name>`. The toolkit
 * takes a `string` and renders it through ink. Hex is known to work; the other three were not
 * measured here, and forwarding an unverified notation produces either a wrong colour or none, with
 * nothing said. Naming them costs the operator one line and tells them the truth.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'

import type { TheoThemeOverride } from '@theokit/tui'

import { DEFAULT_THEME_BASE, type ThemeBase } from './theme-base.js'

/** Their base names, and the light/dark axis each one carries. */
const BASE_AXIS: Readonly<Record<string, ThemeBase>> = {
  dark: 'dark',
  light: 'light',
  'dark-daltonized': 'dark',
  'light-daltonized': 'light',
  'dark-ansi': 'dark',
  'light-ansi': 'light',
}

/** The base names this product reproduces exactly. The rest keep the axis and lose the variant. */
const EXACT_BASES = new Set(['dark', 'light'])

/** Their token, and where it lives in the toolkit's structured override. */
const TOKEN_HOME: Readonly<Record<string, readonly [keyof TheoThemeOverride, string]>> = {
  claude: ['accent', ''],
  error: ['status', 'error'],
  success: ['status', 'success'],
  warning: ['status', 'warning'],
  diffAdded: ['diff', 'addedBg'],
  diffRemoved: ['diff', 'removedBg'],
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export interface CustomThemeListing {
  readonly slug: string
  readonly name: string
}

export interface LoadedCustomTheme {
  readonly slug: string
  readonly name: string
  readonly prop: { base: ThemeBase; override?: TheoThemeOverride }
  /** What the file asked for and this product did not do, each with the value that was refused. */
  readonly notApplied: readonly string[]
}

function themesDir(home: string): string {
  return join(home, '.claude', 'themes')
}

function readTheme(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    // Per file, never per directory: one unreadable theme must not take the operator's others away.
    return null
  }
}

export function listCustomThemes(home: string = homedir()): CustomThemeListing[] {
  const dir = themesDir(home)
  if (!existsSync(dir)) return []
  let entries: string[]
  try {
    entries = readdirSync(dir).sort()
  } catch {
    return []
  }
  const out: CustomThemeListing[] = []
  for (const entry of entries) {
    if (extname(entry) !== '.json') continue
    const parsed = readTheme(join(dir, entry))
    if (parsed === null) continue
    const slug = basename(entry, '.json')
    out.push({ slug, name: typeof parsed['name'] === 'string' ? parsed['name'] : slug })
  }
  return out
}

function resolveBase(raw: unknown, notApplied: string[]): ThemeBase {
  if (typeof raw !== 'string') return DEFAULT_THEME_BASE
  const axis = BASE_AXIS[raw]
  if (axis === undefined) {
    notApplied.push(`base "${raw}" is not a Claude Code base name — using ${DEFAULT_THEME_BASE}`)
    return DEFAULT_THEME_BASE
  }
  if (!EXACT_BASES.has(raw)) {
    // The axis is kept on purpose. Falling back to the default would repaint a light-terminal user's
    // screen over an accessibility variant this product cannot reproduce — a strictly worse answer
    // than the nearest base plus an honest line about what was lost.
    notApplied.push(`base "${raw}" has no equivalent here — using "${axis}", its light/dark axis`)
  }
  return axis
}

/** Write one accepted token where it lives: a root field, or a leaf inside one. */
function placeToken(
  override: Record<string, unknown>,
  home: readonly [field: string, leaf: string],
  value: string,
): void {
  const [field, leaf] = home
  if (leaf === '') override[field] = value
  else override[field] = { ...(override[field] as object | undefined), [leaf]: value }
}

function applyOverrides(raw: unknown, notApplied: string[]): TheoThemeOverride | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const override: Record<string, unknown> = {}
  for (const [token, value] of Object.entries(raw as Record<string, unknown>)) {
    const home = TOKEN_HOME[token]
    if (home === undefined) {
      notApplied.push(`token "${token}" has no equivalent in this product's theme`)
      continue
    }
    if (typeof value !== 'string' || !HEX.test(value)) {
      notApplied.push(`token "${token}": ${String(value)} — only #rgb and #rrggbb are rendered here`)
      continue
    }
    placeToken(override, home, value)
  }
  return Object.keys(override).length > 0 ? (override as TheoThemeOverride) : undefined
}

/** The theme named by `slug`, or null when no file declares it. */
export function loadCustomTheme(slug: string, home: string = homedir()): LoadedCustomTheme | null {
  const path = join(themesDir(home), `${slug}.json`)
  if (!existsSync(path)) return null
  const parsed = readTheme(path)
  if (parsed === null) return null

  const notApplied: string[] = []
  const base = resolveBase(parsed['base'], notApplied)
  const override = applyOverrides(parsed['overrides'], notApplied)
  return {
    slug,
    name: typeof parsed['name'] === 'string' ? parsed['name'] : slug,
    prop: { base, ...(override !== undefined ? { override } : {}) },
    notApplied,
  }
}
