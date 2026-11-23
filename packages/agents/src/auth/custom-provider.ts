import { Provider } from '@theokit/sdk'
import type { Plugin, ProviderProfile } from '@theokit/sdk'

import type { CustomProviderConfig } from './resolve-credential.js'

function withoutTrailingSlashes(url: string): string {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end -= 1
  return url.slice(0, end)
}

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
    baseUrl: withoutTrailingSlashes(config.baseUrl),
    fallbackModels: [],
  }
  return Provider.create(profile)
}
