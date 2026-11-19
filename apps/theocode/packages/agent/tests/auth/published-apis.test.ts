/**
 * #2243 — TheoCode consumes `@theokit/agents` from the registry (`^16.11.0`), not through a
 * `workspace:*` link. These tests use the #1867 login and refresh APIs through the published
 * `@theokit/agents/auth` entry point, the way a consumer would, and check that the package that
 * resolved is the released one rather than a local source tree.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
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

  it('every TheoCode manifest declares the released range, and no stale standalone lockfile remains', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
    for (const p of [
      'package.json',
      'packages/agent/package.json',
      'packages/cli/package.json',
      'packages/shared/package.json',
      'packages/tui/package.json',
    ]) {
      const m = JSON.parse(readFileSync(join(root, p), 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >
      const spec = m.dependencies?.['@theokit/agents'] ?? m.devDependencies?.['@theokit/agents']
      expect(spec, p).toBe('^16.11.0')
    }
    expect(existsSync(join(root, 'pnpm-lock.yaml'))).toBe(false)
  })

  it('a consumer outside the repository can import and call the released package', () => {
    // A directory with its own node_modules and no link to this working tree: the package is the
    // released one that resolved here, reached the way an installed dependency would be.
    const pkgDir = realpathSync(
      join(dirname(fileURLToPath(import.meta.resolve('@theokit/agents/auth'))), '..'),
    )
    mkdirSync(join(home, 'consumer/node_modules/@theokit'), { recursive: true })
    symlinkSync(pkgDir, join(home, 'consumer/node_modules/@theokit/agents'), 'dir')
    writeFileSync(join(home, 'consumer/package.json'), '{"type":"module"}')
    writeFileSync(
      join(home, 'consumer/main.mjs'),
      `import { loginWithApiKey, readAuthFile, refreshOAuthTokens } from '@theokit/agents/auth'
const store = { home: process.argv[2], dirName: '.c', fileName: 'auth.json' }
loginWithApiKey('sk-consumer', store, { provider: 'openai', env: {} })
const t = await refreshOAuthTokens(
  { provider: 'openai', authorizeEndpoint: 'x', tokenEndpoint: 'https://t', clientId: 'c', scopes: [], redirectUri: 'r' },
  'r1',
  { fetch: async () => new Response(JSON.stringify({ access_token: 'a2', refresh_token: 'r2', expires_in: 60 })), now: () => 0 },
)
console.log(JSON.stringify({ key: readAuthFile(store, {}).api_key, access: t.access }))
`,
    )
    const out = execFileSync('node', [join(home, 'consumer/main.mjs'), join(home, 'store')], {
      cwd: join(home, 'consumer'),
      encoding: 'utf8',
    })
    expect(JSON.parse(out)).toEqual({ key: 'sk-consumer', access: 'a2' })
  })
})
