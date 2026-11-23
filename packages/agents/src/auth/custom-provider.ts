import { Provider } from '@theokit/sdk'
import type { Plugin, ProviderProfile } from '@theokit/sdk'

import type { CustomProviderConfig } from './resolve-credential.js'

/**
 * The SDK provider plugin for an operator-configured OpenAI-compatible endpoint: the same
 * {@link CustomProviderConfig} `resolveAgentCredential` reads its key from, so the plugin and the
 * credential never disagree about which variable holds the key.
 */
export function customProviderPlugin(config: CustomProviderConfig): Plugin {
  const profile: ProviderProfile = {
    name: config.name,
    apiMode: 'chat_completions',
    envVars: [config.keyEnv],
    authType: 'api_key',
    baseUrl: config.baseUrl.replace(/\/+$/, ''),
    fallbackModels: [],
  }
  return Provider.create(profile)
}
