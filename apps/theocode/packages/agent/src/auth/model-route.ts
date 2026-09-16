import type { ResolvedCredential } from './credentials.js'

const CHATGPT_PREFIX = 'openai-chatgpt/'

function isRouteChatGPT(
  cred: Pick<ResolvedCredential, 'kind' | 'provider'> | { error: Error },
): boolean {
  return !('error' in cred) && cred.kind === 'oauth' && cred.provider === 'openai'
}

export function routeToCredential(
  cred: Pick<ResolvedCredential, 'kind' | 'provider'> | { error: Error },
  configModel: string,
): string {
  if (!isRouteChatGPT(cred)) return configModel
  const nu = configModel.includes('/')
    ? configModel.slice(configModel.lastIndexOf('/') + 1)
    : configModel
  return `${CHATGPT_PREFIX}${nu}`
}
