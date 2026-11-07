import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  persistOAuthTokens,
  readStoredOAuth,
  type CredentialStoreConfig,
  type OAuthProviderConfig,
  type ResolvedCredential,
} from '@theokit/sdk/auth'
import { afterEach, describe, expect, it } from 'vitest'

import { AuthProvider } from '../../src/auth/auth-provider.js'

/**
 * #1286 — a consumer that hands the access token to a long-running process needs a token that outlives
 * the process, so it must be able to refresh EARLY. Passing an earlier `expiresAt` cannot do it: the
 * re-read under the lock (which is what makes the double-checked locking work) replaces the caller's
 * value with the file's. `refreshBeforeMs` is applied after that re-read.
 *
 * Runs the real SDK against a store in a temporary folder; only the token endpoint is faked.
 */

const NOW = 1_800_000_000_000
const DAY = 86_400_000
const CONFIG: OAuthProviderConfig = {
  provider: 'openai',
  authorizeEndpoint: 'https://auth.example/authorize',
  tokenEndpoint: 'https://auth.example/token',
  clientId: 'cid',
  scopes: ['openid'],
  redirectUri: 'http://localhost/cb',
}

const homes: string[] = []
function store(): CredentialStoreConfig {
  const home = mkdtempSync(join(tmpdir(), 'auth-margin-'))
  homes.push(home)
  const config = { home, dirName: '.cred', fileName: 'auth.json' }
  // The store refuses a folder others can read; make it the way a real home would be.
  persistOAuthTokens('openai', { access: 'seed', refresh: 'seed', expires: NOW }, config, {})
  chmodSync(join(home, '.cred'), 0o700)
  return config
}
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

function stored(config: CredentialStoreConfig, msLeft: number, access = 'stored-access') {
  persistOAuthTokens(
    'openai',
    { access, refresh: 'stored-refresh', expires: NOW + msLeft },
    config,
    {},
  )
}

/** A token endpoint that counts its calls and hands out a token good for ten days. */
function tokenEndpoint() {
  let calls = 0
  const fetch = (async () => {
    calls += 1
    return new Response(
      JSON.stringify({
        access_token: 'renewed-access',
        refresh_token: 'rotated',
        expires_in: 864_000,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as unknown as typeof globalThis.fetch
  return { deps: { fetch, now: () => NOW }, calls: () => calls }
}

const resolved = (access: string, expiresAt: number): ResolvedCredential => ({
  kind: 'oauth',
  provider: 'openai',
  apiKey: access,
  source: 'test',
  inferred: false,
  expiresAt,
})

describe('#1286 — AuthProvider refreshes early when asked to, deciding on the value it re-read', () => {
  it('without the option, a token with an hour left is used as it is', async () => {
    const config = store()
    stored(config, 3_600_000)
    const endpoint = tokenEndpoint()

    const fresh = await new AuthProvider(CONFIG, config).ensureFresh(
      resolved('stored-access', NOW + 3_600_000),
      endpoint.deps,
      {},
    )

    expect(endpoint.calls()).toBe(0)
    expect(fresh.apiKey).toBe('stored-access')
  })

  it('renews a token that has less than refreshBeforeMs left, and keeps the rotated refresh token', async () => {
    const config = store()
    stored(config, 3_600_000)
    const endpoint = tokenEndpoint()

    const fresh = await new AuthProvider(CONFIG, config, { refreshBeforeMs: 2 * DAY }).ensureFresh(
      resolved('stored-access', NOW + 3_600_000),
      endpoint.deps,
      {},
    )

    expect(endpoint.calls()).toBe(1)
    expect(fresh.apiKey).toBe('renewed-access')
    expect(fresh.expiresAt).toBe(NOW + 864_000_000)
    expect(readStoredOAuth(config, {})).toMatchObject({
      access: 'renewed-access',
      refresh: 'rotated',
    })
  })

  it('leaves a token with more than the margin left alone, and reports its real expiry', async () => {
    const config = store()
    stored(config, 3 * DAY)
    const endpoint = tokenEndpoint()

    const fresh = await new AuthProvider(CONFIG, config, { refreshBeforeMs: 2 * DAY }).ensureFresh(
      resolved('stored-access', NOW + 3 * DAY),
      endpoint.deps,
      {},
    )

    expect(endpoint.calls()).toBe(0)
    expect(fresh.expiresAt).toBe(NOW + 3 * DAY)
  })

  it('decides on the file, not on what the caller read before the lock', async () => {
    const config = store()
    // The caller read the token while it still had days left; by the time it holds the lock the file
    // says otherwise. The margin applies to the file's value.
    stored(config, 3_600_000)
    const endpoint = tokenEndpoint()

    await new AuthProvider(CONFIG, config, { refreshBeforeMs: 2 * DAY }).ensureFresh(
      resolved('stored-access', NOW + 5 * DAY),
      endpoint.deps,
      {},
    )

    expect(endpoint.calls()).toBe(1)
  })

  it('does not renew again what another process renewed while this one waited', async () => {
    const config = store()
    // The caller still holds the old, nearly expired token; another process already wrote a new one.
    stored(config, 10 * DAY, 'renewed-elsewhere')
    const endpoint = tokenEndpoint()

    const fresh = await new AuthProvider(CONFIG, config, { refreshBeforeMs: 2 * DAY }).ensureFresh(
      resolved('old-access', NOW + 60_000),
      endpoint.deps,
      {},
    )

    expect(endpoint.calls()).toBe(0)
    expect(fresh.apiKey).toBe('renewed-elsewhere')
    expect(fresh.expiresAt).toBe(NOW + 10 * DAY)
  })

  it("still adds the SDK's one-minute skew on top of the margin", async () => {
    const config = store()
    stored(config, 2 * DAY + 30_000)
    const endpoint = tokenEndpoint()

    await new AuthProvider(CONFIG, config, { refreshBeforeMs: 2 * DAY }).ensureFresh(
      resolved('stored-access', NOW + 2 * DAY + 30_000),
      endpoint.deps,
      {},
    )

    expect(endpoint.calls()).toBe(1)
  })

  it('refuses a margin that is not a finite number of milliseconds at or above zero', () => {
    const config = store()
    for (const refreshBeforeMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new AuthProvider(CONFIG, config, { refreshBeforeMs })).toThrow(/refreshBeforeMs/)
    }
  })
})
