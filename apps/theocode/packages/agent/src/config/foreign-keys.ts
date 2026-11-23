/**
 * The keys Claude Code's `settings.json` defines that this product does not implement.
 *
 * ## Why this list exists rather than "ignore anything unknown"
 *
 * Both config schemas here are `.strict()`, so an unknown key throws naming itself. That is the
 * behaviour worth keeping: it catches `sandbox_mdoe` at the moment it is written rather than months
 * later when someone notices the sandbox never changed.
 *
 * But it cannot survive contact with a real Claude Code `settings.json`. Pasting one in — which is
 * the whole point of reading that filename — would refuse to start over `spinnerTipsEnabled`.
 *
 * So there are three groups, not two: ours (parsed), theirs (recognised, ignored, and REPORTED),
 * and neither (rejected). A key we ignore has to be named as ignored; a config that silently
 * accepts anything teaches people it is being read when it is not.
 *
 * ## Why not a heuristic
 *
 * "camelCase is theirs, snake_case is ours" was considered and rejected by measurement of its
 * failure mode: `sandboxMode` — the camelCase typo of one of OUR keys — would be silently ignored
 * instead of caught, which is the exact defect strictness exists to prevent. An explicit list makes
 * that typo land in the third group, where it belongs.
 *
 * The cost is drift: when Claude Code adds a key, a user pasting it gets an error naming the key.
 * That is the honest failure — it says what happened and where — and it is repaired by adding one
 * line here.
 *
 * Source: `code.claude.com/docs/en/settings-reference`, read 2026-09-07.
 */
export const FOREIGN_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  'advisorModel', 'agent', 'agentPushNotifEnabled', 'allowAllClaudeAiMcps', 'allowedChannelPlugins',
  'allowedHttpHookUrls', 'allowedMcpServers', 'allowManagedHooksOnly', 'allowManagedMcpServersOnly',
  'allowManagedPermissionRulesOnly', 'alwaysThinkingEnabled', 'apiKeyHelper', 'askUserQuestionTimeout',
  'attribution', 'autoCompactEnabled', 'autoCompactWindow', 'autoConnectIde',
  'autoContinueAtUsageLimit', 'autoInstallIdeExtension', 'autoMemoryDirectory', 'autoMemoryEnabled',
  'autoMode', 'autoScrollEnabled', 'autoUpdatesChannel', 'availableModels', 'awaySummaryEnabled',
  'awsAuthRefresh', 'awsCredentialExport', 'axScreenReader', 'bashOutputMaxChars',
  'blockedMarketplaces', 'browserExternalPageTools', 'channelsEnabled', 'claudeMd',
  'claudeMdExcludes', 'cleanupPeriodDays', 'companyAnnouncements', 'crossSessionInbound',
  'defaultShell', 'deniedMcpServers', 'desktopSessionCleanupPeriodDays', 'dialogExpiry', 'diffTool',
  'disableAgentView', 'disableAllHooks', 'disableArtifact', 'disableAutoMode',
  'disableBrowserExternalNavigation', 'disableBundledSkills', 'disableClaudeAiConnectors',
  'disableCommandPluginSources', 'disableDeepLinkRegistration', 'disableDesktopLocalSessions',
  'disabledMcpjsonServers', 'disableMobileSimulatorTools', 'disableRemoteControl',
  'disableSideloadFlags', 'disableSkillShellExecution', 'disableWorkflows', 'editorMode',
  'effortLevel', 'emojiCompletionEnabled', 'enableAllProjectMcpServers', 'enableArtifact',
  'enabledMcpjsonServers', 'enabledPlugins', 'enableWorkflows', 'enforceAvailableModels', 'env',
  'externalEditorContext', 'extraKnownMarketplaces', 'fallbackModel', 'fastMode',
  'fastModePerSessionOptIn', 'feedbackDrafts', 'feedbackSurveyRate', 'fileCheckpointingEnabled',
  'fileSuggestion', 'footerLinksRegexes', 'forceLoginGatewayUrl', 'forceLoginMethod',
  'forceLoginOrgUUID', 'forceRemoteSettingsRefresh', 'gcpAuthRefresh', 'httpHookAllowedEnvVars',
  'includeCoAuthoredBy', 'includeGitInstructions', 'inputNeededNotifEnabled', 'isolatePeerMachines',
  'keybindingFlavor', 'language', 'managedSourcesBehavior', 'minimumVersion', 'modelOverrides',
  'modelPicker', 'modelPricing', 'modelSettings', 'otelHeadersHelper',
  'parentSettingsBehavior', 'permissionExplainerEnabled', 'permissions', 'plansDirectory',
  'pluginConfigs', 'pluginSuggestionMarketplaces', 'pluginTrustMessage', 'policyHelper',
  'preferredNotifChannel', 'prefersReducedMotion', 'processWrapper', 'promptCacheTtl',
  'promptSuggestionEnabled', 'prUrlTemplate', 'remoteControlAtStartup', 'requiredMaximumVersion',
  'requiredMinimumVersion', 'respectGitignore', 'respondToBashCommands', 'sandbox',
  'showClearContextOnPlanAccept', 'showThinkingSummaries', 'showTurnDuration',
  'skillListingBudgetFraction', 'skillListingMaxDescChars', 'skillOverrides',
  'skipAutoPermissionPrompt', 'skipDangerousModePermissionPrompt', 'skipWebFetchPreflight',
  'spellcheck', 'spinnerTipsEnabled', 'spinnerTipsOverride', 'spinnerVerbs', 'sshConfigs',
  'sshHostAllowlist', 'statusLine', 'strictKnownMarketplaces', 'strictPluginOnlyCustomization',
  'subagentPromptCacheTtl', 'ultracode', 'workflowSizeGuideline',
])
