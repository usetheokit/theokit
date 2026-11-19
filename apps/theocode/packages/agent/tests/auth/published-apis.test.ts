/**
 * #2243 — TheoCode consumes `@theokit/agents` from the registry (`^16.11.0`), not through a
 * `workspace:*` link. These tests use the #1867 login and refresh APIs through the published
 * `@theokit/agents/auth` entry point, the way a consumer would, and check that the package that
 * resolved is the released one rather than a local source tree.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CredentialExistsError,
  ensureFreshCredential,
  loginWithApiKey,
  readStoredOAuth,
  refreshOAuthTokens,
  persistOAuthTokens,
  readAuthFile,
} from '@theokit/agents/auth'

const store = (home: string) => ({ home, dirName: '.theocode', fileName: 'auth.json' })
const oauth = {
  provider: 'openai',
  authorizeEndpoint: 'https://auth.example/authorize',
  tokenEndpoint: 'https://auth.example/token',
  clientId: 'client',
  scopes: ['openid'],
  redirectUri: 'http://localhost/cb',
}
const tokenResponse = (body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-published-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

function resolvedVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.resolve('@theokit/agents/auth')))
  while (dir !== dirname(dir)) {
    const file = join(dir, 'package.json')
    if (existsSync(file)) {
      const m = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version: string }
      if (m.name === '@theokit/agents') return m.version
    }
    dir = dirname(dir)
  }
  throw new Error('@theokit/agents package.json not found')
}

describe('@theokit/agents released auth APIs', () => {
  it('resolves a released version, at least 16.11.0', () => {
    const [major = 0, minor = 0] = resolvedVersion().split('.').map(Number)
    expect(major > 16 || (major === 16 && minor >= 11)).toBe(true)
  })

  it('loginWithApiKey stores a key, infers nothing it was not given, and refuses to overwrite', () => {
    const cfg = store(home)
    const env = {}
    const { path } = loginWithApiKey('  sk-test-key  ', cfg, { provider: 'openai', env })
    expect(readAuthFile(cfg, env)).toMatchObject({ api_key: 'sk-test-key' })
    expect(() => loginWithApiKey('sk-other', cfg, { provider: 'openai', env })).toThrow(
      CredentialExistsError,
    )
    expect(readFileSync(path, 'utf8')).not.toContain('sk-other')
  })

  it('refreshOAuthTokens exchanges a refresh token for new tokens', async () => {
    const tokens = await refreshOAuthTokens(oauth, 'old-refresh', {
      fetch: tokenResponse({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
      now: () => 1_000,
    })
    expect(tokens).toMatchObject({ access: 'new-access', refresh: 'new-refresh' })
    expect(tokens.expires).toBeGreaterThan(1_000)
  })

  it('ensureFreshCredential refreshes an expired credential and persists the rotation', async () => {
    const cfg = store(home)
    const env = {}
    persistOAuthTokens('openai', { access: 'stale', refresh: 'old-refresh', expires: 10 }, cfg, env)
    const fresh = await ensureFreshCredential(
      {
        kind: 'oauth',
        provider: 'openai',
        apiKey: 'stale',
        source: 'file',
        inferred: false,
        expiresAt: 10,
      },
      { config: oauth, store: cfg, env },
      {
        fetch: tokenResponse({
          access_token: 'rotated',
          refresh_token: 'rotated-refresh',
          expires_in: 3600,
        }),
        now: () => 1_000_000,
      },
    )
    expect(fresh.apiKey).toBe('rotated')
    expect(readStoredOAuth(cfg, env)).toMatchObject({
      access: 'rotated',
      refresh: 'rotated-refresh',
    })
  })
})
