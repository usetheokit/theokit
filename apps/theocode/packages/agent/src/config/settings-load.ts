/**
 * Finding, reading and reporting on `settings.json` — the disk half of configuration.
 *
 * Split out of `config.ts` when that file crossed its line budget. The division is not arbitrary:
 * `config.ts` owns the SCHEMA and the pure fold across layers; this file owns WHERE the files are
 * and what each one carried that the schema never saw.
 */
import { dirname } from 'node:path'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import process from 'node:process'

import { CONFIG_SCHEMA_KEYS, ConfigError } from './config-contract.js'
import { DEFAULT_HOME_DIR, LEGACY_HOME_DIR, homeStateDir } from './home-dir.js'
import { readManagedSettingsTranslated } from './managed-settings.js'
import { settingsReadFrom, settingsReadOptions } from './settings-json.js'
import {
  SettingsFileError,
  readSettingsFile,
  settingsCandidates,
  translateSettingsDocument,
} from '@theokit/agents/config'
import type {
  PermissionRule,
  SettingsFileRead,
  SettingsCandidate as FrameworkCandidate,
} from '@theokit/agents/config'

/**
 * Read one `settings.json`, translate the foreign dialect out of it, and hand back what the schema
 * can parse. Foreign keys are dropped and REPORTED — `translateSettings` returns them by name, and
 * `doctor` is where they surface; dropping them without a record would teach an operator that a
 * setting is read when it is not.
 */
function readSettingsIfPresent(candidate: SettingsCandidate): unknown | null {
  const read = readCandidate(candidate)
  return read === null ? null : settingsReadFrom(read, candidate.hooksDelivery).values
}

/**
 * One candidate through the framework reader, or `null` when the file is absent. A file that cannot
 * be read or parsed is a `ConfigError`; one that parses to something other than an object is an
 * empty layer (the framework skips it, and the file still counts as the scope's first).
 */
function readCandidate(candidate: SettingsCandidate): SettingsFileRead | null {
  try {
    const read = readSettingsFile(candidate, {
      ...settingsReadOptions(CONFIG_SCHEMA_KEYS, dirname(candidate.path)),
      throwOnMalformed: true,
    })
    if (read !== undefined) return read
  } catch (err) {
    if (err instanceof SettingsFileError) throw new ConfigError(err.message)
    throw err
  }
  if (!existsSync(candidate.path)) return null
  return translateSettingsDocument({}, candidate, settingsReadOptions(CONFIG_SCHEMA_KEYS))
}

/**
 * `config.toml` was replaced by `settings.json`, and a replacement that leaves the old file in place
 * without saying so is the worst outcome available: the operator's settings simply stop applying,
 * with no error, and the product looks like it lost their configuration. So a stranded `config.toml`
 * REFUSES TO START, and the refusal carries the conversion command rather than only the diagnosis.
 *
 * PER SCOPE, not globally. The first version asked "is there a settings.json anywhere?", which meant
 * a user-level `settings.json` silenced a stranded project-level `config.toml` — the project's whole
 * configuration dropped, with no error, which is the exact silence this refusal exists to break.
 * A scope has migrated when ITS OWN settings file is there.
 *
 * Once that file exists the refusal lifts for that scope, and the leftover is reported by `doctor`
 * instead of blocking every run.
 */
export function refuseStrandedToml(
  scope: string,
  tomls: readonly string[],
  foundSettings: boolean,
): void {
  if (foundSettings) return
  const stranded = tomls.filter((p) => existsSync(p))
  if (stranded.length === 0) return
  throw new ConfigError(
    `${stranded.join(', ')} is no longer read — the ${scope} configuration file is now ` +
      'settings.json, in the same directory. Convert it with `theocode migrate-config`, ' +
      'or delete it if it is obsolete.',
  )
}

/**
 * Where each file layer may live, ours before theirs, declared ONCE. `loadConfig` reads from these
 * lists and `settingsReport` walks the same ones — a reporter with its own copy would eventually
 * describe files the loader does not read, which is the failure mode of every diagnostic that
 * recomputes what it reports on.
 */
/**
 * One candidate file, and WHO runs the hooks in it (#151).
 *
 * The delivery is a property of the PATH, not of the product, and it was measured per path rather
 * than assumed: `hookConfigCandidates` in the SDK reads three filenames from every config root, and
 * `theokitConfigRoot(cwd)` is unconditionally one of them — but `loadHookConfig(this.cwd, …)` is
 * CWD-ONLY, so the user level is in nobody's candidates but ours. That asymmetry is why a rule like
 * "any path containing .theokit" would be wrong: `~/.theokit/settings.json` is safe and
 * `<project>/.theokit/settings.json` is not.
 */
export interface SettingsCandidate {
  readonly path: string
  readonly foreignRoot: boolean
  readonly hooksDelivery: 'ours' | 'refuse' | 'sdk' | 'inert'
}

export function layerCandidates(opts: {
  projectDir: string
  userDir: string
  env: Record<string, string | undefined>
}): { user: SettingsCandidate[]; project: SettingsCandidate[]; projectLocal: SettingsCandidate[] } {
  // THEOKIT_HOME may be absolute, so the state dir is its own base with an empty own root.
  const home = settingsCandidates({
    cwd: opts.projectDir,
    home: homeStateDir(opts.env, opts.userDir),
    ownRoot: '',
    foreignRoot: false,
  }).user
  const user = settingsCandidates({
    cwd: opts.projectDir,
    home: opts.userDir,
    ownRoot: LEGACY_HOME_DIR,
  }).user
  const project = settingsCandidates({
    cwd: opts.projectDir,
    home: opts.userDir,
    ownRoot: [DEFAULT_HOME_DIR, LEGACY_HOME_DIR],
  }).project
  // The legacy root has no project-local file.
  const projectLocal = settingsCandidates({
    cwd: opts.projectDir,
    home: opts.userDir,
    ownRoot: DEFAULT_HOME_DIR,
  }).projectLocal
  // The SDK reads hooks from the PROJECT's `.theokit/` (its filebase) and `.claude/` (its compat
  // adapter) — never from the user's home. See `SettingsCandidate`.
  const sdk = (c: FrameworkCandidate, ownDelivery: 'ours' | 'refuse'): SettingsCandidate => ({
    ...c,
    hooksDelivery: c.foreignRoot ? 'sdk' : ownDelivery,
  })
  return {
    user: [
      ...home.map((c) => ({ ...c, hooksDelivery: 'ours' as const })),
      { ...user[0]!, hooksDelivery: 'ours' },
      // Foreign vocabulary, but nothing runs its hooks: `loadHookConfig` never sees the user level.
      { ...user[1]!, hooksDelivery: 'inert' },
    ],
    project: [
      sdk(project[0]!, 'refuse'),
      { ...project[1]!, hooksDelivery: 'ours' },
      sdk(project[2]!, 'refuse'),
    ],
    projectLocal: projectLocal.map((c) => sdk(c, 'refuse')),
  }
}

export interface SettingsFileReport {
  readonly path: string
  /** Claude Code settings this product recognises and does not implement. */
  readonly ignored: readonly string[]
  /** Keys in neither vocabulary, tolerated because the file is under the foreign root. */
  readonly unrecognised: readonly string[]
  /** Hooks that could not be translated, each with its reason. */
  readonly droppedHooks: readonly string[]
  /**
   * Permission entries this runtime could not render, each with its reason.
   *
   * Separate from `ignored`, and the distinction is the operator's: `ignored` names a setting this
   * product chose not to implement, this names one it implements and could not express. An operator
   * reading the first goes looking for a feature; one reading the second goes looking at their line.
   */
  readonly unsupportedPermissions: readonly string[]
  /**
   * The rules this file's `permissions` block became, for the engine that enforces them.
   *
   * #736 — the block was translated and then dropped here: `reportOne` kept `unsupportedPermissions`,
   * which is the COMPLAINT, and discarded `permissionRules`, which is the POLICY. An operator's `deny`
   * was parsed, reported as translated, and enforced by nobody.
   *
   * Measured 2026-09-17 beside Claude Code on byte-identical configuration: it refused a
   * `Read(./off-limits.txt)` deny rule; this product answered with the file's contents.
   */
  readonly permissionRules: readonly PermissionRule[]
}

/**
 * What each `settings.json` actually read carried that this product did NOT act on.
 *
 * The contract this satisfies: a key we ignore must be nameable. A configuration file that silently
 * accepts anything teaches an operator that a setting is read when it is not, and the cost lands
 * later, on a behaviour they configured and never got.
 */
/**
 * One candidate's report, or the reason there is none.
 *
 * `'skip'` — the file does not exist; the next candidate in the scope may still be read.
 * `'stop'` — the file exists and is malformed JSON; the scope ends with no report. The loader
 * already refuses on malformed JSON with the file named, and a diagnostic that threw here would
 * fail on exactly the input it exists to explain.
 *
 * Extracted so the loop below can state first-existing-wins ONCE: the previous shape expressed
 * "malformed ends the scope" and "only the first is read" with the same `break` keyword in one
 * body, which is where a future edit goes wrong.
 */
function reportOne(candidate: SettingsCandidate): SettingsFileReport | 'skip' | 'stop' {
  const path = candidate.path
  let raw: SettingsFileRead | null
  try {
    raw = readCandidate(candidate)
  } catch {
    return 'stop'
  }
  if (raw === null) return 'skip'
  try {
    const read = settingsReadFrom(raw, candidate.hooksDelivery)
    return {
      path,
      ignored: read.ignored,
      unrecognised: read.unrecognised,
      droppedHooks: read.droppedHooks,
      unsupportedPermissions: read.unsupportedPermissions.map((u) => `${u.entry} — ${u.reason}`),
      permissionRules: read.permissionRules,
    }
  } catch (err) {
    // #151 — a refused `hooks` key throws. A DIAGNOSTIC must survive the state it exists to
    // describe: reporting the refusal is more use than inheriting it.
    return {
      path,
      ignored: [],
      unrecognised: [],
      droppedHooks: [(err as Error).message],
      unsupportedPermissions: [],
      permissionRules: [],
    }
  }
}

export function settingsReport(opts: {
  projectDir?: string
  userDir?: string
  env?: Record<string, string | undefined>
  /** Where to look for the managed file; defaults to the platform paths Claude Code uses. */
  managedPaths?: readonly string[]
}): SettingsFileReport[] {
  const env = opts.env ?? process.env
  const candidates = layerCandidates({
    projectDir: opts.projectDir ?? process.cwd(),
    userDir: opts.userDir ?? homedir(),
    env,
  })
  const out: SettingsFileReport[] = []
  for (const list of [candidates.user, candidates.project, candidates.projectLocal]) {
    for (const candidate of list) {
      const result = reportOne(candidate)
      if (result === 'skip') continue
      if (result !== 'stop') out.push(result)
      break // first existing candidate wins — the report describes what the loader used
    }
  }
  // #1908 — the organisation's managed file, which outranks the rest, listed with its path.
  const managed = readManagedSettingsTranslated({
    ...(opts.managedPaths === undefined ? {} : { paths: opts.managedPaths }),
  })
  if (managed !== null) {
    out.push({
      path: managed.path,
      ignored: managed.ignored,
      unrecognised: managed.unrecognised,
      droppedHooks: managed.droppedHooks,
      unsupportedPermissions: managed.unsupportedPermissions.map((u) => `${u.entry} — ${u.reason}`),
      permissionRules: managed.permissionRules,
    })
  }
  return out
}

/** The first of `candidates` that exists, ours before theirs. */
export function firstSettings(candidates: readonly SettingsCandidate[]): unknown | null {
  for (const candidate of candidates) {
    const read = readSettingsIfPresent(candidate)
    if (read !== null) return read
  }
  return null
}
