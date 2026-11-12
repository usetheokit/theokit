import { isTransientError } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { AuthProvider, RefreshFailure } from '../../src/auth-entry.js'

const CONFIG = {
  provider: 'openai',
  authorizeEndpoint: 'https://auth.example/authorize',
  tokenEndpoint: 'https://auth.example/token',
  clientId: 'cid',
  scopes: ['openid'],
  redirectUri: 'http://localhost/cb',
}

async function failWith(err: Error): Promise<unknown> {
  const home = mkdtempSync(join(tmpdir(), 'refresh-failure-'))
  const store = { home, dirName: '.rf', fileName: 'auth.json' }
  mkdirSync(join(home, '.rf'), { recursive: true })
  writeFileSync(
    join(home, '.rf', 'auth.json'),
    JSON.stringify({ type: 'oauth', provider: 'openai', access: 'old', refresh: 'r', expires: 1 }),
    { mode: 0o600 },
  )
  const stale = {
    kind: 'oauth' as const,
    provider: 'openai',
    apiKey: 'old',
    source: 'file',
    inferred: false,
    expiresAt: 1,
  }
  try {
    const p = new AuthProvider(CONFIG, store)
      .ensureFresh(stale, {
        fetch: (async () => {
          throw err
        }) as typeof fetch,
        now: () => Date.now(),
      })
      .catch((e: unknown) => e)
    return await p
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

describe('RefreshFailure is typed', () => {
  it('a transient refresh failure satisfies isTransientError', async () => {
    const e = (await failWith(new Error('connect ECONNRESET'))) as RefreshFailure
    expect(e).toBeInstanceOf(RefreshFailure)
    expect(e).toBeInstanceOf(TheokitAgentError)
    expect(isTransientError(e)).toBe(true)
    expect(e.code).toBe('oauth_refresh_failed')
    expect(e.transient).toBe(true)
    // The SDK wraps the fetch error in its own error before this layer classifies it; that error
    // (which names the original failure) is what `cause` carries.
    expect((e.cause as Error).message).toContain('ECONNRESET')
  })

  it('invalid_grant is not transient', async () => {
    const e = (await failWith(new Error('400 invalid_grant'))) as RefreshFailure
    expect(e).toBeInstanceOf(RefreshFailure)
    expect(isTransientError(e)).toBe(false)
    expect(e.isRetryable).toBe(false)
  })
})
