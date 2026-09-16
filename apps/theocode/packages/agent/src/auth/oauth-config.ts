import { CODEX_PROVIDER } from '@theokit/agents/auth'
import type { CredentialStoreConfig, OAuthProviderConfig } from '@theokit/agents/auth'

import { ENV_HOME } from '../config/index.js'

const REL_DIR = '.theocode'
const REL_FILE = 'auth.json'
const HOME_ENV = ENV_HOME

export const OPENAI_OAUTH_CONFIG: OAuthProviderConfig = CODEX_PROVIDER.oauth

export function credentialStore(home: string): CredentialStoreConfig {
  return { home, dirName: REL_DIR, fileName: REL_FILE, homeEnvVar: HOME_ENV }
}
