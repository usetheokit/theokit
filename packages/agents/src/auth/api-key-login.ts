import { existsSync, unlinkSync } from 'node:fs'

import {
  authFilePath,
  CredentialError,
  providerFromApiKeyPrefix,
  writeCredential,
} from '@theokit/sdk/auth'
import type { CredentialStoreConfig } from '@theokit/sdk/auth'

import { ProviderPrefixMismatchError } from './resolve-credential.js'

/** Raised when a credential file already exists and `overwrite` was not set. */
export class CredentialExistsError extends CredentialError {
  override readonly name: string = 'CredentialExistsError'
  readonly code = 'credential_exists'
  constructor(readonly path: string) {
    super(`a credential already exists at ${path}; pass overwrite to replace it`)
  }
}

/**
 * Store an API key. Trims it, infers the provider from its prefix when none is given, refuses a key
 * whose prefix contradicts the declared provider, and refuses to replace an existing file unless
 * `overwrite` is set. Returns the provider and the file path — never the key.
 */
export function loginWithApiKey(
  apiKey: string,
  store: CredentialStoreConfig,
  options: {
    provider?: string
    overwrite?: boolean
    env?: Record<string, string | undefined>
  } = {},
): { provider: string; path: string } {
  const key = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (key.length === 0) throw new CredentialError('refusing to store an empty API key')
  const inferred = providerFromApiKeyPrefix(key)
  const provider = options.provider ?? inferred
  if (provider === undefined) {
    throw new CredentialError(
      'cannot tell the provider from the key prefix; pass the provider explicitly',
    )
  }
  if (inferred !== undefined && inferred !== provider) {
    throw new ProviderPrefixMismatchError(
      provider,
      '',
      '',
      `the key declared for provider "${provider}" has the prefix of provider "${inferred}"`,
    )
  }
  const env = options.env ?? {}
  const existing = authFilePath(store, env)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the SDK-derived credential path
  if (options.overwrite !== true && existsSync(existing)) throw new CredentialExistsError(existing)
  const path = writeCredential({ provider, apiKey: key }, store, env)
  return { provider, path }
}

/** Remove the credential file. `true` if one was removed, `false` if there was none (also on a race). */
export function logout(
  store: CredentialStoreConfig,
  env: Record<string, string | undefined> = {},
): boolean {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the SDK-derived credential path
    unlinkSync(authFilePath(store, env))
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
