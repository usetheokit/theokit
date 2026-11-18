import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { persistOAuthTokens } from '@theokit/sdk/auth'
import { AuthProvider } from '../../src/auth/auth-provider.js'

// Real SDK refresh (no mock): the SDK re-wraps fetch errors by message, which is what these pin.
let home: string
const store = () => ({ home, dirName: '.app', fileName: 'auth.json' }) as never
const CONFIG = { tokenEndpoint: 'https://auth.example/token', clientId: 'cid' } as never
const stale = () =>
  ({
    kind: 'oauth',
    provider: 'openai',
    apiKey: 'STORED',
    source: 'file',
    inferred: false,
    expiresAt: 1,
  }) as never

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'auth-transport-'))
  persistOAuthTokens('openai', { access: 'STORED', refresh: 'R', expires: 1 }, store(), {})
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

const useStored = (extra = {}) =>
  new AuthProvider(CONFIG, store(), { onTransientFailure: 'use-stored', ...extra })

describe('AuthProvider transport failures through the real SDK refresh', () => {
  it('a hanging fetch times out and use-stored returns the stored credential', async () => {
    const f = (() => new Promise<Response>(() => {})) as typeof fetch
    const r = await useStored({ requestTimeoutMs: 20 }).ensureFresh(stale(), {
      fetch: f,
      now: () => 1_000_000,
    })
    expect(r.apiKey).toBe('STORED')
  })

  it('a stalled response body is cut off by the deadline', async () => {
    let calls = 0
    const f = (async () => {
      calls++
      return { ok: true, status: 200, json: () => new Promise(() => {}) } as unknown as Response
    }) as typeof fetch
    const r = await useStored({ requestTimeoutMs: 20 }).ensureFresh(stale(), {
      fetch: f,
      now: () => 1_000_000,
    })
    expect(r.apiKey).toBe('STORED')
    expect(calls).toBe(3)
  })

  it('TypeError: fetch failed is transient: use-stored returns, default throws a transient RefreshFailure', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed', { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
    }) as typeof fetch
    const deps = { fetch: f, now: () => 1_000_000 }
    expect((await useStored().ensureFresh(stale(), deps)).apiKey).toBe('STORED')
    await expect(
      new AuthProvider(CONFIG, store()).ensureFresh(stale(), deps),
    ).rejects.toMatchObject({ name: 'RefreshFailure', transient: true })
  })

  it('invalid_grant still throws with use-stored', async () => {
    const f = (async () =>
      ({ ok: false, status: 400, json: async () => ({}) }) as unknown as Response) as typeof fetch
    await expect(
      useStored({ requestTimeoutMs: 1000 }).ensureFresh(stale(), {
        fetch: f,
        now: () => 1_000_000,
      }),
    ).rejects.toMatchObject({ name: 'RefreshFailure' })
  })
})
