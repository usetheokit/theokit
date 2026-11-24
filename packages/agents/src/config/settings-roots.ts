/**
 * Read a settings file under an own root and a foreign (Claude Code) root.
 *
 * An app with its own config root (`.myapp/settings.json`) usually also honours `.claude/`. The own
 * file is read strictly: an unknown key stays in `values` so the caller's strict schema rejects it by
 * name. The foreign file is read tolerantly: a key the app does not implement is reported in
 * `ignored` (known to Claude Code) or `unrecognised` (not known), never silently absorbed.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { PermissionRule } from '@theokit/sdk'

import { FOREIGN_KEY_DECISIONS } from './settings-file.js'
import { permissionRulesFromSettings } from './settings-permissions.js'
import type { PermissionsBlock } from './settings-permissions.js'

export { FOREIGN_KEY_DECISIONS }

/** The keys Claude Code's `settings.json` defines, for classifying a foreign file's keys. */
export const CLAUDE_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  'advisorModel',
  'agent',
  'agentPushNotifEnabled',
  'allowAllClaudeAiMcps',
  'allowedChannelPlugins',
  'allowedHttpHookUrls',
  'allowedMcpServers',
  'allowManagedHooksOnly',
  'allowManagedMcpServersOnly',
  'allowManagedPermissionRulesOnly',
  'alwaysThinkingEnabled',
  'apiKeyHelper',
  'askUserQuestionTimeout',
  'attribution',
  'autoCompactEnabled',
  'autoCompactWindow',
  'autoConnectIde',
  'autoContinueAtUsageLimit',
  'autoInstallIdeExtension',
  'autoMemoryDirectory',
  'autoMemoryEnabled',
  'autoMode',
  'autoScrollEnabled',
  'autoUpdatesChannel',
  'availableModels',
  'awaySummaryEnabled',
  'awsAuthRefresh',
  'awsCredentialExport',
  'axScreenReader',
  'bashOutputMaxChars',
  'blockedMarketplaces',
  'browserExternalPageTools',
  'channelsEnabled',
  'claudeMd',
  'claudeMdExcludes',
  'cleanupPeriodDays',
  'companyAnnouncements',
  'crossSessionInbound',
  'defaultShell',
  'deniedMcpServers',
  'desktopSessionCleanupPeriodDays',
  'dialogExpiry',
  'diffTool',
  'disableAgentView',
  'disableAllHooks',
  'disableArtifact',
  'disableAutoMode',
  'disableBrowserExternalNavigation',
  'disableBundledSkills',
  'disableClaudeAiConnectors',
  'disableCommandPluginSources',
  'disableDeepLinkRegistration',
  'disableDesktopLocalSessions',
  'disabledMcpjsonServers',
  'disableMobileSimulatorTools',
  'disableRemoteControl',
  'disableSideloadFlags',
  'disableSkillShellExecution',
  'disableWorkflows',
  'editorMode',
  'effortLevel',
  'emojiCompletionEnabled',
  'enableAllProjectMcpServers',
  'enableArtifact',
  'enabledMcpjsonServers',
  'enabledPlugins',
  'enableWorkflows',
  'enforceAvailableModels',
  'env',
  'externalEditorContext',
  'extraKnownMarketplaces',
  'fallbackModel',
  'fastMode',
  'fastModePerSessionOptIn',
  'feedbackDrafts',
  'feedbackSurveyRate',
  'fileCheckpointingEnabled',
  'fileSuggestion',
  'footerLinksRegexes',
  'forceLoginGatewayUrl',
  'forceLoginMethod',
  'forceLoginOrgUUID',
  'forceRemoteSettingsRefresh',
  'gcpAuthRefresh',
  'httpHookAllowedEnvVars',
  'includeCoAuthoredBy',
  'includeGitInstructions',
  'inputNeededNotifEnabled',
  'isolatePeerMachines',
  'keybindingFlavor',
  'language',
  'managedSourcesBehavior',
  'minimumVersion',
  'modelOverrides',
  'modelPicker',
  'modelPricing',
  'modelSettings',
  'otelHeadersHelper',
  'parentSettingsBehavior',
  'permissionExplainerEnabled',
  'permissions',
  'plansDirectory',
  'pluginConfigs',
  'pluginSuggestionMarketplaces',
  'pluginTrustMessage',
  'policyHelper',
  'preferredNotifChannel',
  'prefersReducedMotion',
  'processWrapper',
  'promptCacheTtl',
  'promptSuggestionEnabled',
  'prUrlTemplate',
  'remoteControlAtStartup',
  'requiredMaximumVersion',
  'requiredMinimumVersion',
  'respectGitignore',
  'respondToBashCommands',
  'sandbox',
  'showClearContextOnPlanAccept',
  'showThinkingSummaries',
  'showTurnDuration',
  'skillListingBudgetFraction',
  'skillListingMaxDescChars',
  'skillOverrides',
  'skipAutoPermissionPrompt',
  'skipDangerousModePermissionPrompt',
  'skipWebFetchPreflight',
  'spellcheck',
  'spinnerTipsEnabled',
  'spinnerTipsOverride',
  'spinnerVerbs',
  'sshConfigs',
  'sshHostAllowlist',
  'statusLine',
  'strictKnownMarketplaces',
  'strictPluginOnlyCustomization',
  'subagentPromptCacheTtl',
  'ultracode',
  'workflowSizeGuideline',
])

export interface SettingsCandidate {
  readonly path: string
  readonly foreignRoot: boolean
}

export interface SettingsCandidates {
  readonly user: readonly SettingsCandidate[]
  readonly project: readonly SettingsCandidate[]
  readonly projectLocal: readonly SettingsCandidate[]
}

/** Per scope, the ordered candidate paths: the own root before the foreign root. */
export function settingsCandidates(input: {
  readonly cwd: string
  readonly home: string
  /** One own root, or several in precedence order (each wins over the ones after it). */
  readonly ownRoot: string | readonly string[]
  readonly foreignRoot?: string | false
}): SettingsCandidates {
  const foreign = input.foreignRoot ?? '.claude'
  const own = typeof input.ownRoot === 'string' ? [input.ownRoot] : input.ownRoot
  const roots: { root: string; foreignRoot: boolean }[] = [
    ...own.map((root) => ({ root, foreignRoot: false })),
    ...(foreign === false ? [] : [{ root: foreign, foreignRoot: true }]),
  ]
  const scope = (base: string, file: string): readonly SettingsCandidate[] =>
    roots.map((r) => ({ path: join(base, r.root, file), foreignRoot: r.foreignRoot }))
  return {
    user: scope(input.home, 'settings.json'),
    project: scope(input.cwd, 'settings.json'),
    projectLocal: scope(input.cwd, 'settings.local.json'),
  }
}

export interface SettingsFileRead {
  readonly path: string
  /** Own keys, renamed per `renames`. In an own-root file this also holds unknown keys. */
  readonly values: Record<string, unknown>
  /** Known foreign keys not implemented here, plus `$schema` and `_`-prefixed keys. */
  readonly ignored: readonly string[]
  /** Keys neither own nor known to Claude Code; foreign file only. */
  readonly unrecognised: readonly string[]
  readonly permissionRules: readonly PermissionRule[]
  readonly unsupportedPermissions: readonly { readonly entry: string; readonly reason: string }[]
  /** Raw `hooks`; pass to `parseClaudeHooks` for the foreign dialect. */
  readonly hooks?: unknown
}

export interface ReadSettingsFileOptions {
  readonly ownKeys: readonly string[]
  readonly renames?: Readonly<Record<string, string>>
  readonly baseDir?: string
  readonly specifierArg?: Readonly<Record<string, string>>
  readonly toolAliases?: Readonly<Record<string, string>>
  readonly onWarn?: (message: string) => void
  /** Throw on a file that exists and is not valid JSON, instead of warning and skipping it. */
  readonly throwOnMalformed?: boolean
}

/** A settings file that exists and cannot be read or parsed; thrown under `throwOnMalformed`. */
export class SettingsFileError extends Error {
  override readonly name = 'SettingsFileError'
  constructor(
    readonly path: string,
    /** `unreadable`: the file could not be read; `malformed`: it was read and is not JSON. */
    readonly kind: 'unreadable' | 'malformed',
    readonly detail: string,
  ) {
    super(
      kind === 'malformed'
        ? `malformed JSON at ${path}: ${detail}`
        : `cannot read ${path}: ${detail}`,
    )
  }
}

/**
 * A `permissions` value that is not an object is treated as absent, not cast. Within it, each of
 * `allow`/`deny`/`ask` is kept only when every entry is a string; any other list is dropped whole.
 */
function asPermissionsBlock(value: unknown): PermissionsBlock | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const block = value as Record<string, unknown>
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((e) => typeof e === 'string') ? [...(v as string[])] : undefined
  const allow = strings(block['allow'])
  const deny = strings(block['deny'])
  const ask = strings(block['ask'])
  return {
    ...(allow === undefined ? {} : { allow }),
    ...(deny === undefined ? {} : { deny }),
    ...(ask === undefined ? {} : { ask }),
  }
}

function isConvention(key: string): boolean {
  return key === '$schema' || key.startsWith('_')
}

function isKnownForeign(key: string): boolean {
  return (
    CLAUDE_SETTINGS_KEYS.has(key) || Object.hasOwn(FOREIGN_KEY_DECISIONS, key) || isConvention(key)
  )
}

function parseFile(
  path: string,
  warn: (m: string) => void,
  throwOnMalformed = false,
): Record<string, unknown> | undefined {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- path built from the caller's roots and a fixed filename
  if (!existsSync(path)) return undefined
  let text: string
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- same path, existence-checked above
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if (throwOnMalformed) throw new SettingsFileError(path, 'unreadable', (error as Error).message)
    warn(`${path} could not be parsed (${(error as Error).message}) — it is NOT being applied.`)
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    if (throwOnMalformed) throw new SettingsFileError(path, 'malformed', (error as Error).message)
    warn(`${path} could not be parsed (${(error as Error).message}) — it is NOT being applied.`)
    return undefined
  }
  {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warn(`${path} is not a JSON object — it is NOT being applied.`)
      return undefined
    }
    return parsed as Record<string, unknown>
  }
}

/** Read one candidate. `undefined` when the file is absent, or exists and cannot be parsed (warned). */
export function readSettingsFile(
  candidate: SettingsCandidate,
  options: ReadSettingsFileOptions,
): SettingsFileRead | undefined {
  const raw = parseFile(
    candidate.path,
    options.onWarn ?? (() => undefined),
    options.throwOnMalformed,
  )
  if (raw === undefined) return undefined
  return translateSettingsDocument(raw, candidate, options)
}

/**
 * Translate an already-parsed settings document the way `readSettingsFile` does a file: the same
 * rename, permission and own/ignored/unrecognised split, for a caller that holds the JSON in memory.
 */
export function translateSettingsDocument(
  raw: Record<string, unknown>,
  candidate: SettingsCandidate,
  options: ReadSettingsFileOptions,
): SettingsFileRead {
  const own = new Set(options.ownKeys)
  const values: Record<string, unknown> = {}
  const ignored: string[] = []
  const unrecognised: string[] = []
  let permissionRules: readonly PermissionRule[] = []
  let unsupportedPermissions: readonly { readonly entry: string; readonly reason: string }[] = []
  let hooks: unknown
  let hasHooks = false

  for (const [rawKey, value] of Object.entries(raw)) {
    const key = options.renames?.[rawKey] ?? rawKey
    if (key === 'permissions') {
      const translated = permissionRulesFromSettings(asPermissionsBlock(value), {
        ...(options.specifierArg === undefined ? {} : { specifierArg: options.specifierArg }),
        ...(options.baseDir === undefined ? {} : { baseDir: options.baseDir }),
        ...(options.toolAliases === undefined ? {} : { toolAliases: options.toolAliases }),
      })
      permissionRules = translated.rules
      unsupportedPermissions = translated.unsupported.map((u) => ({
        entry: u.entry,
        reason: u.reason,
      }))
    } else if (key === 'hooks') {
      hooks = value
      hasHooks = true
    } else if (own.has(key)) {
      values[key] = value
    } else if (isKnownForeign(key)) {
      ignored.push(key)
    } else if (candidate.foreignRoot) {
      unrecognised.push(key)
    } else {
      values[key] = value
    }
  }

  return {
    path: candidate.path,
    values,
    ignored,
    unrecognised,
    permissionRules,
    unsupportedPermissions,
    ...(hasHooks ? { hooks } : {}),
  }
}

/** The first candidate that yields a file; later candidates are not read. */
export function firstSettingsFile(
  candidates: readonly SettingsCandidate[],
  options: ReadSettingsFileOptions,
): SettingsFileRead | undefined {
  for (const candidate of candidates) {
    const read = readSettingsFile(candidate, options)
    if (read !== undefined) return read
  }
  return undefined
}

/**
 * The rules of several settings reads as one list: every `deny` first, then the rest
 * (`ask` and `allow`) in read order. The engine is first-match-wins, so a deny in any layer beats an allow in
 * any other, whichever file came first.
 */
export function permissionRulesFromLayers(
  reads: readonly (Pick<SettingsFileRead, 'permissionRules'> | undefined)[],
): PermissionRule[] {
  const all = reads.flatMap((read) => read?.permissionRules ?? [])
  return [...all.filter((r) => r.action === 'deny'), ...all.filter((r) => r.action !== 'deny')]
}

/** Where an administrator deploys `managed-settings.json`: Claude Code's three platform paths. */
export const MANAGED_SETTINGS_PATHS: readonly string[] = [
  '/Library/Application Support/ClaudeCode/managed-settings.json',
  '/etc/claude-code/managed-settings.json',
  join('C:\\', 'ProgramData', 'ClaudeCode', 'managed-settings.json'),
]

export interface ReadManagedSettingsOptions {
  /** Paths to try in order; defaults to the three platform paths. */
  readonly paths?: readonly string[]
  /** Keys that count as this app's own; the rest are reported as ignored or unrecognised. */
  readonly ownKeys: readonly string[]
  readonly renames?: Readonly<Record<string, string>>
  readonly specifierArg?: Readonly<Record<string, string>>
  readonly toolAliases?: Readonly<Record<string, string>>
  readonly onWarn?: (message: string) => void
}

/**
 * The first existing `managed-settings.json`, read as a foreign-dialect document for the caller's
 * key set. A file that exists and does not parse is warned about and ends the search (the policy in
 * it is not applied, and a lower-priority path must not stand in for it); `undefined` when absent.
 */
export function readManagedSettings(
  options: ReadManagedSettingsOptions,
): SettingsFileRead | undefined {
  for (const path of options.paths ?? MANAGED_SETTINGS_PATHS) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed platform paths or the caller's list
    if (!existsSync(path)) continue
    return readSettingsFile(
      { path, foreignRoot: true },
      {
        ownKeys: options.ownKeys,
        baseDir: dirname(path),
        ...(options.renames === undefined ? {} : { renames: options.renames }),
        ...(options.specifierArg === undefined ? {} : { specifierArg: options.specifierArg }),
        ...(options.toolAliases === undefined ? {} : { toolAliases: options.toolAliases }),
        ...(options.onWarn === undefined ? {} : { onWarn: options.onWarn }),
      },
    )
  }
  return undefined
}
