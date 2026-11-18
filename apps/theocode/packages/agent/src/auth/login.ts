import { existsSync } from 'node:fs'

import {
  CODEX_PROVIDER,
  CredentialExistsError,
  loginWithApiKey,
  loginWithDevice,
  logout as logoutStore,
  providerFromApiKeyPrefix,
} from '@theokit/agents/auth'
import type { AuthMethod, DeviceAuthProvider } from '@theokit/agents/auth'

import {
  CredentialError,
  assertPairMatches,
  authFilePath,
  PROVIDER_NAMES,
  type Provider,
} from './credentials.js'
import { credentialStore } from './oauth-config.js'

export interface LoginResult {
  provider: Provider
  path: string
}

export function login(
  apiKey: string,
  home: string,
  opts: { provider?: Provider; env?: Record<string, string | undefined>; overwrite?: boolean } = {},
): LoginResult {
  const key = apiKey.trim()
  if (key.length === 0) {
    throw new CredentialError('no API key was provided — the input was empty')
  }

  // The framework infers from every prefix it knows; this product supports three providers, so a
  // key it files under another one is as unplaceable here as one it cannot place at all.
  const inferred = providerFromApiKeyPrefix(key)
  const provider = opts.provider ?? (isProvider(inferred) ? inferred : undefined)
  if (provider === undefined) {
    throw new CredentialError(
      'cannot tell which provider this key belongs to. Pass the provider explicitly.',
    )
  }

  // Refuse a key that contradicts the chosen provider before anything reaches the store.
  assertPairMatches(provider, key, 'the credential being written')

  try {
    return loginWithApiKey(key, credentialStore(home), {
      provider,
      overwrite: opts.overwrite,
      env: opts.env ?? {},
    }) as LoginResult
  } catch (err) {
    // The framework says "pass overwrite"; the CLI has no such option, so keep this product's words.
    if (err instanceof CredentialExistsError) throw new CredentialError(existsMessage(err.path))
    throw err
  }
}

function existsMessage(target: string): string {
  return `a credential already exists at ${target}. Run logout first, or pass overwrite to replace it.`
}

function isProvider(name: string | undefined): name is Provider {
  return name !== undefined && (PROVIDER_NAMES as readonly string[]).includes(name)
}

function refuseIfExists(
  home: string,
  env: Record<string, string | undefined>,
  overwrite?: boolean,
): void {
  const target = authFilePath(home, env)
  if (existsSync(target) && overwrite !== true) {
    throw new CredentialError(existsMessage(target))
  }
}

export interface OAuthLoginResult {
  provider: Provider
  path: string
  accountId?: string
}

export async function oauthDeviceLogin(
  provider: Provider,
  home: string,
  hooks: { onPrompt: (p: { userCode: string; verificationUri: string }) => void },
  deps?: {
    fetch?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    now?: () => number
    env?: Record<string, string | undefined>
    overwrite?: boolean
  },
): Promise<OAuthLoginResult> {
  const target = providerFor(provider)
  const method = target.methods.find((m) => m.type === 'oauth')
  if (method === undefined) {
    throw new CredentialError(
      `provider "${provider}" does not offer an OAuth device login. Use an API key (login) instead.`,
    )
  }
  const r = await loginWithMethod(target, method, home, hooks, deps)
  return { provider, path: r.path, accountId: r.accountId }
}

const PROVIDERS: Readonly<Record<string, DeviceAuthProvider>> = { openai: CODEX_PROVIDER }

function providerFor(name: string): DeviceAuthProvider {
  const p = PROVIDERS[name]
  if (p === undefined) {
    throw new CredentialError(
      `provider "${name}" does not offer an OAuth device login. Use an API key (login) instead.`,
    )
  }
  return p
}

export function methodsFor(provider: DeviceAuthProvider | string): readonly AuthMethod[] {
  return typeof provider === 'string' ? providerFor(provider).methods : provider.methods
}

export function knownProviders(): readonly string[] {
  return Object.keys(PROVIDERS)
}

async function loginWithMethod(
  provider: DeviceAuthProvider,
  method: AuthMethod,
  home: string,
  hooks: { onPrompt: (p: { userCode: string; verificationUri: string }) => void },
  deps?: {
    fetch?: typeof fetch
    sleep?: (ms: number) => Promise<void>
    now?: () => number
    env?: Record<string, string | undefined>
    overwrite?: boolean
  },
): Promise<{ path: string; accountId?: string }> {
  const env = deps?.env ?? {}
  refuseIfExists(home, env, deps?.overwrite)
  return loginWithDevice(provider, method, credentialStore(home), hooks, {
    deps: { fetch: deps?.fetch, sleep: deps?.sleep, now: deps?.now },
    env,
  })
}

export function logout(home: string, env: Record<string, string | undefined> = {}): boolean {
  return logoutStore(credentialStore(home), env)
}
