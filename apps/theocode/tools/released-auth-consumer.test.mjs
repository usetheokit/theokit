/**
 * #2243 — a consumer outside this checkout can use the released `@theokit/agents` auth APIs.
 *
 * The workspace tests resolve `@theokit/agents` through a symlink to `packages/agents`, which proves
 * nothing about the PUBLISHED artifact. This installs the exact version TheoCode's manifest pins
 * into an empty temp directory with npm, checks that the result is a real registry install (not a
 * link back into this repo), and drives `loginWithApiKey`, `ensureFreshCredential` and
 * `refreshOAuthTokens` through the published `@theokit/agents/auth` entry point. Credentials live in
 * the temp directory and HTTP is a stub, so nothing touches `$HOME` or the network beyond the install.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
/* global Response */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const THEOCODE = join(HERE, '..')

/** Every TheoCode manifest that declares the framework. */
const MANIFESTS = [
  'package.json',
  ...['agent', 'cli', 'shared', 'tui'].map((p) => `packages/${p}/package.json`),
]

const declared = MANIFESTS.map((m) => {
  const json = JSON.parse(readFileSync(join(THEOCODE, m), 'utf8'))
  const spec = { ...json.dependencies, ...json.devDependencies }['@theokit/agents']
  // `workspace:<exact>` links to this checkout in development and publishes as `<exact>`.
  return { manifest: m, spec, version: String(spec).replace(/^workspace:/, '') }
})

let root
let auth

describe('released @theokit/agents auth APIs, from a standalone consumer install', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'theocode-released-auth-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
    )
    // `--ignore-scripts`: nothing here needs a native build, and the install should not run any.
    execFileSync(
      'npm',
      [
        'install',
        '--no-audit',
        '--no-fund',
        '--ignore-scripts',
        `@theokit/agents@${declared[0].version}`,
      ],
      { cwd: root, stdio: 'pipe' },
    )
    // A module that lives in the consumer and uses the bare specifier, so Node resolves it through
    // the published `exports` map exactly as a real consumer's would.
    const entry = join(root, 'consumer.mjs')
    writeFileSync(entry, "export * from '@theokit/agents/auth'\n")
    return import(pathToFileURL(entry).href).then((m) => {
      auth = m
    })
  }, 240_000)

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })

  it('every TheoCode manifest pins one exact released version, not workspace:*', () => {
    for (const { manifest, spec } of declared) {
      expect(spec, manifest).toMatch(/^(workspace:)?\d+\.\d+\.\d+$/)
    }
    expect(new Set(declared.map((d) => d.version)).size).toBe(1)
  })

  it('resolves the pinned version as a registry copy, not a link into the repository', () => {
    const dir = realpathSync(join(root, 'node_modules/@theokit/agents'))
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    expect(pkg.version).toBe(declared[0].version)
    expect(relative(realpathSync(tmpdir()), dir).startsWith('..')).toBe(false)
    expect(dir.split(sep)).toContain('node_modules')
  })

  it('exposes the three APIs on the published ./auth entry point', () => {
    expect(typeof auth.loginWithApiKey).toBe('function')
    expect(typeof auth.ensureFreshCredential).toBe('function')
    expect(typeof auth.refreshOAuthTokens).toBe('function')
  })

  it('loginWithApiKey stores the key in the consumer store and refuses to overwrite it', () => {
    const store = { home: join(root, 'home-login'), dirName: '.consumer', fileName: 'auth.json' }
    mkdirSync(store.home, { recursive: true })
    const { provider, path } = auth.loginWithApiKey('sk-ant-test-key', store, {
      provider: 'anthropic',
    })
    expect(provider).toBe('anthropic')
    expect(path.startsWith(store.home)).toBe(true)
    expect(JSON.stringify(JSON.parse(readFileSync(path, 'utf8')))).toContain('sk-ant-test-key')
    expect(() => auth.loginWithApiKey('sk-ant-other', store, { provider: 'anthropic' })).toThrow(
      auth.CredentialExistsError,
    )
  })

  const config = {
    provider: 'acme',
    authorizeEndpoint: 'https://idp.example/authorize',
    tokenEndpoint: 'https://idp.example/token',
    clientId: 'client-1',
    scopes: ['openid'],
    redirectUri: 'http://localhost/cb',
  }
  const NOW = 1_700_000_000_000
  const stub = () => {
    const calls = []
    const fetch = async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? '') })
      return new Response(
        JSON.stringify({
          access_token: 'NEW_ACCESS',
          refresh_token: 'NEW_REFRESH',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    return { calls, deps: { fetch, now: () => NOW } }
  }

  it('refreshOAuthTokens exchanges a refresh token at the token endpoint', async () => {
    const { calls, deps } = stub()
    const tokens = await auth.refreshOAuthTokens(config, 'OLD_REFRESH', deps)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(config.tokenEndpoint)
    expect(calls[0].body).toContain('OLD_REFRESH')
    expect(tokens.access).toBe('NEW_ACCESS')
    expect(tokens.refresh).toBe('NEW_REFRESH')
    expect(tokens.expires).toBe(NOW + 3600 * 1000)
  })

  it('ensureFreshCredential refreshes an expired credential and persists the result', async () => {
    const store = { home: join(root, 'home-refresh'), dirName: '.consumer', fileName: 'auth.json' }
    const path = auth.persistOAuthTokens(
      'acme',
      { access: 'OLD_ACCESS', refresh: 'OLD_REFRESH', expires: NOW - 1000 },
      store,
    )
    const resolved = {
      kind: 'oauth',
      provider: 'acme',
      apiKey: 'OLD_ACCESS',
      source: 'file',
      inferred: false,
      expiresAt: NOW - 1000,
    }
    const { calls, deps } = stub()
    const fresh = await auth.ensureFreshCredential(resolved, { config, store }, deps)
    expect(calls).toHaveLength(1)
    expect(fresh.apiKey).toBe('NEW_ACCESS')
    expect(JSON.parse(readFileSync(path, 'utf8')).refresh).toBe('NEW_REFRESH')

    // A credential that is still valid is returned without any HTTP.
    const valid = { ...fresh, expiresAt: NOW + 3_600_000 }
    const again = stub()
    const same = await auth.ensureFreshCredential(valid, { config, store }, again.deps)
    expect(again.calls).toHaveLength(0)
    expect(same.apiKey).toBe(valid.apiKey)
  })
})
