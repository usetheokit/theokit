import { resolvePlatforms } from './channels/platforms.js'
import type { ControlPlaneSettings } from './control-plane/settings.js'
import type { ToolSettings } from './tools/tool-settings.js'
import { eventSecrets, type EventSettings } from './triggers/trigger-settings.js'

/** What the secrets list is read from: the environment and an import's own values. */
export interface SecretSources {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly importedSecrets?: readonly string[]
}

/**
 * Every configured value TheoClaw keeps out of what it prints and replies: the channel
 * credentials, both model keys, both bearer tokens, the tools', the import's and the triggers' values
 * (B-397: each trigger secret and approved hook fingerprint). One list,
 * read once at start, for the output mask and the reply masks alike (B-398 FR-008).
 */
export function processSecrets(
  sources: SecretSources,
  settings: Pick<ControlPlaneSettings, 'controlToken' | 'webchatToken'>,
  tools: Pick<ToolSettings, 'secrets'>,
  events?: EventSettings,
): string[] {
  const { env } = sources
  const keys = [env.THEOKIT_API_KEY, env.OPENROUTER_API_KEY]
    .map((value) => (value ?? '').trim())
    .filter((value) => value !== '')
  const tokens = [settings.controlToken, settings.webchatToken].filter((token) => token !== undefined)
  return [...resolvePlatforms(env).secrets, ...keys, ...tokens, ...tools.secrets, ...(sources.importedSecrets ?? []), ...(events === undefined ? [] : eventSecrets(events))]
}
