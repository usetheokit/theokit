/**
 * Standalone consumer check (#2276): runs against the registry install in this directory, never the
 * repository workspace. From this directory: `pnpm install --frozen-lockfile && pnpm exec vitest run`.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const here = dirname(dirname(fileURLToPath(import.meta.url)))
const installed = createRequire(join(here, 'package.json'))

const auth = await import('@theokit/agents/auth')
const {
  loginWithApiKey,
  ensureFreshCredential,
  refreshOAuthTokens,
  persistOAuthTokens,
  readStoredOAuth,
} = auth

const config = {
  provider: 'acme',
  authorizeEndpoint: 'https://acme.test/authorize',
  tokenEndpoint: 'https://acme.test/token',
  clientId: 'client',
  scopes: ['read'],
  redirectUri: 'http://localhost/cb',
}

let home
let store
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-standalone-'))
  store = { home, dirName: 'acme', fileName: 'auth.json' }
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

const tokenFetch = (calls) => async (url, init) => {
  calls.push({ url: String(url), body: String(init?.body) })
  return new globalThis.Response(
    JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  )
}

describe('standalone @theokit/agents install', () => {
  it('resolves @theokit/agents from this directory, as the pinned registry release', () => {
    const pkgPath = installed.resolve('@theokit/agents/package.json')
    expect(pkgPath.startsWith(here + sep)).toBe(true)
    expect(pkgPath).toContain(`${sep}node_modules${sep}`)
    const declared = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).devDependencies[
      '@theokit/agents'
    ]
    expect(JSON.parse(readFileSync(pkgPath, 'utf8')).version).toBe(declared)
  })

  it('loginWithApiKey stores a key and refuses to overwrite it', () => {
    const out = loginWithApiKey('sk-ant-test-key', store, { provider: 'anthropic' })
    expect(out.provider).toBe('anthropic')
    expect(JSON.parse(readFileSync(out.path, 'utf8'))).toMatchObject({
      provider: 'anthropic',
      api_key: 'sk-ant-test-key',
    })
    expect(() => loginWithApiKey('sk-ant-test-key', store, { provider: 'anthropic' })).toThrow(
      auth.CredentialExistsError,
    )
  })

  it('refreshOAuthTokens exchanges a refresh token through the injected fetch', async () => {
    const calls = []
    const tokens = await refreshOAuthTokens(config, 'old-refresh', {
      fetch: tokenFetch(calls),
      now: () => 1_000,
    })
    expect(tokens).toMatchObject({
      access: 'new-access',
      refresh: 'new-refresh',
      expires: 1_000 + 3_600_000,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(config.tokenEndpoint)
    expect(calls[0].body).toContain('old-refresh')
  })

  it('ensureFreshCredential refreshes a stale oauth credential and persists the new tokens', async () => {
    persistOAuthTokens(
      'acme',
      { access: 'old-access', refresh: 'old-refresh', expires: 500 },
      store,
      {},
    )
    const calls = []
    const resolved = {
      kind: 'oauth',
      provider: 'acme',
      apiKey: 'old-access',
      source: 'stored',
      inferred: false,
      expiresAt: 500,
    }
    const fresh = await ensureFreshCredential(
      resolved,
      { config, store, env: {} },
      { fetch: tokenFetch(calls), now: () => 1_000 },
    )
    expect(fresh.apiKey).toBe('new-access')
    expect(calls).toHaveLength(1)
    expect(readStoredOAuth(store, {})).toMatchObject({
      access: 'new-access',
      refresh: 'new-refresh',
    })
  })
})
