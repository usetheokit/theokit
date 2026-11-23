import { modelForCredential } from '@theokit/agents/auth'

import type { ResolvedCredential } from './credentials.js'

export function routeToCredential(
  cred: Pick<ResolvedCredential, 'kind' | 'provider'> | { error: Error },
  configModel: string,
): string {
  return 'error' in cred ? configModel : modelForCredential(cred, configModel)
}
