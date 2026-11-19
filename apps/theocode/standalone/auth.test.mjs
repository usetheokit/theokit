// Runs against the registry-installed `@theokit/agents`, never the repository's workspace copy.
/* global Response */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  ensureFreshCredential,
  loginWithApiKey,
  readAuthFile,
  refreshOAuthTokens,
  persistOAuthTokens,
} from '@theokit/agents/auth'

const here = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'theocode-standalone-'))
after(() => rmSync(home, { recursive: true, force: true }))

const store = { home, dirName: 'theocode', fileName: 'auth.json' }
const config = {
  provider: 'openai',
  authorizeEndpoint: 'https://auth.example.test/authorize',
  tokenEndpoint: 'https://auth.example.test/token',
  clientId: 'client-id',
  scopes: ['openid'],
  redirectUri: 'http://localhost/callback',
}
const NOW = 1_000_000

const tokenFetch = (calls) => async (url, init) => {
  calls.push({ url: String(url), body: String(init?.body) })
  return new Response(
    JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

describe('standalone install', () => {
  it('resolves @theokit/agents from this directory node_modules, not the workspace', () => {
    const require = createRequire(join(here, 'package.json'))
    const pkgJson = realpathSync(require.resolve('@theokit/agents/package.json'))
    assert.ok(pkgJson.startsWith(join(realpathSync(here), 'node_modules') + sep), pkgJson)
    assert.equal(
      readJson(pkgJson).version,
      readJson(join(here, 'package.json')).dependencies['@theokit/agents'],
    )
  })

  it('has no workspace: specifier in the manifest or lockfile', () => {
    for (const f of ['package.json', 'pnpm-lock.yaml']) {
      assert.ok(!readFileSync(join(here, f), 'utf8').includes('workspace:'), f)
    }
  })

  it('pins the framework packages to the versions in released.json, at registry versions', () => {
    const declared = readJson(join(here, 'package.json')).dependencies
    const released = readJson(join(here, 'released.json'))
    for (const [name, version] of Object.entries(released)) {
      assert.equal(declared[name], version, name)
      assert.match(version, /^\d+\.\d+\.\d+$/, name)
    }
    assert.match(declared['@theokit/sdk'], /^\d+\.\d+\.\d+/)
  })
})

describe('released auth API', () => {
  it('loginWithApiKey stores a key and refuses to overwrite', () => {
    const r = loginWithApiKey('sk-test-key', store, { provider: 'openai', env: {} })
    assert.equal(r.provider, 'openai')
    assert.ok(r.path.startsWith(home))
    assert.equal(readAuthFile(store, {}) !== undefined, true)
    assert.throws(() => loginWithApiKey('sk-other', store, { provider: 'openai', env: {} }))
  })

  it('refreshOAuthTokens exchanges a refresh token', async () => {
    const calls = []
    const tokens = await refreshOAuthTokens(config, 'old-refresh', {
      fetch: tokenFetch(calls),
      now: () => NOW,
    })
    assert.equal(tokens.access, 'new-access')
    assert.equal(tokens.refresh, 'new-refresh')
    assert.equal(calls[0].url, config.tokenEndpoint)
    assert.match(calls[0].body, /refresh_token=old-refresh/)
  })

  it('ensureFreshCredential refreshes a stale OAuth credential and persists it', async () => {
    persistOAuthTokens(
      'openai',
      { access: 'stale', refresh: 'old-refresh', expires: NOW - 1 },
      store,
      {},
    )
    const calls = []
    const resolved = {
      kind: 'oauth',
      provider: 'openai',
      apiKey: 'stale',
      source: 'file',
      inferred: false,
      expiresAt: NOW - 1,
    }
    const fresh = await ensureFreshCredential(
      resolved,
      { config, store, env: {} },
      { fetch: tokenFetch(calls), now: () => NOW },
    )
    assert.equal(fresh.apiKey, 'new-access')
    assert.equal(calls.length, 1)
    const stored = JSON.parse(readFileSync(join(home, 'theocode', 'auth.json'), 'utf8'))
    assert.equal(stored.access, 'new-access')
    assert.equal(stored.refresh, 'new-refresh')
  })

  it('ensureFreshCredential leaves a valid credential alone', async () => {
    const calls = []
    const resolved = {
      kind: 'oauth',
      provider: 'openai',
      apiKey: 'ok',
      source: 'file',
      inferred: false,
      expiresAt: NOW + 10_000_000,
    }
    const same = await ensureFreshCredential(
      resolved,
      { config, store, env: {} },
      { fetch: tokenFetch(calls), now: () => NOW },
    )
    assert.equal(same.apiKey, 'ok')
    assert.equal(calls.length, 0)
  })
})
