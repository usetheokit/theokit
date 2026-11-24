/**
 * Row builders for the checks every agent app's doctor repeats: credential state, wired
 * capabilities, ignored settings, and leftover files. The status rules live here so they do not
 * drift between apps; the wording that names the app (the remedy) is the caller's.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { Check, SecretPresence } from './diagnose.js'

/** A credential's state: what {@link SecretPresence} reports, plus an expired one. */
export type CredentialState = SecretPresence | 'expired'

/** What one settings file contained that was not honoured. */
export interface SettingsFileReport {
  readonly path: string
  /** Keys that are known but not implemented. */
  readonly ignored: readonly string[]
  /** Keys that are not recognised at all. */
  readonly unrecognised: readonly string[]
  /** Hooks that could not be translated. */
  readonly droppedHooks: readonly string[]
  /** Permission entries that are not supported. */
  readonly unsupportedPermissions?: readonly string[]
}

function credential(
  state: CredentialState,
  options: { name?: string; remedy?: string } = {},
): Check {
  const name = options.name ?? 'credential'
  const remedy = options.remedy === undefined ? '' : `: ${options.remedy}`
  switch (state) {
    case 'present':
      return { name, status: 'ok', detail: 'present' }
    case 'expired':
      return { name, status: 'warn', detail: `expired; a refresh may still renew it${remedy}` }
    case 'unreadable':
      return { name, status: 'fail', detail: `present but unreadable${remedy}` }
    case 'absent':
      return { name, status: 'fail', detail: `absent${remedy}` }
  }
}

function capability(
  name: string,
  wired: { active: readonly string[]; suppressedByTrust: boolean },
): Check {
  const active = wired.active
  if (!wired.suppressedByTrust) {
    return { name, status: 'ok', detail: active.length > 0 ? active.join(', ') : 'none' }
  }
  if (active.length > 0) {
    return {
      name,
      status: 'warn',
      detail: `${active.join(', ')} active; the project's entries were withheld because the directory is not trusted`,
    }
  }
  return { name, status: 'warn', detail: 'withheld because the directory is not trusted' }
}

function settingsReport(reports: readonly SettingsFileReport[]): Check[] {
  const lines: string[] = []
  for (const r of reports) {
    const parts: string[] = []
    if (r.ignored.length > 0) parts.push(`not implemented: ${r.ignored.join(', ')}`)
    if (r.unrecognised.length > 0) parts.push(`unrecognised: ${r.unrecognised.join(', ')}`)
    if (r.droppedHooks.length > 0) parts.push(`hooks not translated: ${r.droppedHooks.join(', ')}`)
    const perms = r.unsupportedPermissions ?? []
    if (perms.length > 0) parts.push(`permissions not supported: ${perms.join(', ')}`)
    if (parts.length > 0) lines.push(`${r.path} (${parts.join('; ')})`)
  }
  if (lines.length === 0) return []
  return [{ name: 'settings', status: 'warn', detail: lines.join(' | ') }]
}

function leftovers(name: string, paths: readonly string[], hint?: string): Check[] {
  if (paths.length === 0) return []
  const tail = hint === undefined ? '' : `; ${hint}`
  return [{ name, status: 'warn', detail: `${paths.join(', ')} no longer read${tail}` }]
}

function skillNamesIn(root: string): string[] {
  let entries: string[]
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the roots are the caller's own skills directories; reading them is the check.
    entries = readdirSync(root)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return entries.filter((entry) => {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the roots are the caller's own skills directories; reading them is the check.
      return statSync(join(root, entry, 'SKILL.md')).isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  })
}

/**
 * Compare the skills a config declares with the ones on disk. `roots` are skills directories; a
 * skill is a subdirectory holding a `SKILL.md`. A missing root is ordinary; other read errors throw.
 * Which roots count as foreign or bundled stays the caller's. `undeclared` and `missing` carry the
 * names themselves, so a caller never has to parse `detail`.
 */
function skillsInventory(options: {
  declared: readonly string[]
  roots: readonly string[]
}): Check & {
  /** Names on disk and not declared, sorted. */
  readonly undeclared: readonly string[]
  /** Names declared and not on disk, sorted. */
  readonly missing: readonly string[]
} {
  const name = 'skills'
  const onDisk = new Set(options.roots.flatMap(skillNamesIn))
  const declared = new Set(options.declared)
  const undeclared = [...onDisk].filter((n) => !declared.has(n)).sort((a, b) => a.localeCompare(b))
  const missing = [...declared].filter((n) => !onDisk.has(n)).sort((a, b) => a.localeCompare(b))
  if (undeclared.length === 0 && missing.length === 0) {
    return {
      name,
      status: 'ok',
      detail: `${String(declared.size)} declared, all on disk`,
      undeclared,
      missing,
    }
  }
  const parts: string[] = []
  if (undeclared.length > 0) parts.push(`on disk, not declared: ${undeclared.join(', ')}`)
  if (missing.length > 0) parts.push(`declared, not on disk: ${missing.join(', ')}`)
  return { name, status: 'warn', detail: parts.join('; '), undeclared, missing }
}

export const checks = { credential, capability, settingsReport, leftovers, skillsInventory }
