import { describe, expect, it, vi } from 'vitest'

/**
 * M60 — `AuthProvider` unifies the SDK's free OAuth-lifecycle functions into one OO contract. Two
 * properties are pinned:
 *  1. PARITY / delegation (Rung 9) — each method forwards verbatim to the SDK function, threading the
 *     held `config`+`store`, so login → persist → refresh produces identical state.
 *  2. SECRET-SAFETY (hard rule) — the wrapper never logs or otherwise emits token material.
 */

const h = vi.hoisted(() => ({
  ensure: [] as unknown[][],
  device: [] as unknown[][],
  persist: [] as unknown[][],
}))

vi.mock('@theokit/sdk/auth', () => ({
  ensureFreshCredential: vi.fn(async (resolved: unknown, opts: unknown, deps: unknown) => {
    h.ensure.push([resolved, opts, deps])
    return {
      provider: 'openai',
      accessToken: 'FRESH_SECRET_ACCESS',
      refreshToken: 'SECRET_REFRESH',
    }
  }),
  openaiDeviceLogin: vi.fn(async (config: unknown, deps: unknown, hooks: unknown) => {
    h.device.push([config, deps, hooks])
    return {
      accessToken: 'LOGIN_SECRET_ACCESS',
      refreshToken: 'LOGIN_SECRET_REFRESH',
      accountId: 'acct_1',
    }
  }),
  persistOAuthTokens: vi.fn((provider: string, tokens: unknown, store: unknown, env: unknown) => {
    h.persist.push([provider, tokens, store, env])
    return '/home/u/.agent-builder/auth.json'
  }),
}))

const { AuthProvider } = await import('../../src/auth/auth-provider.js')

const CONFIG = { tokenUrl: 'https://auth.example/token', clientId: 'cid' } as never
const STORE = { home: '/home/u', relDir: '.agent-builder', relFile: 'auth.json' } as never

describe('M60 — AuthProvider delegates the OAuth lifecycle to the SDK (Rung 9) and never leaks tokens', () => {
  it('deviceLogin forwards (deviceConfig, deps, hooks) verbatim and returns the SDK tokens', async () => {
    h.device.length = 0
    const deviceConfig = { deviceCodeUrl: 'https://auth.example/dc' } as never
    const deps = { fetch, sleep: async () => {}, now: () => 0 } as never
    const hooks = { onPrompt: () => {} } as never
    const tokens = await new AuthProvider(CONFIG, STORE).deviceLogin(deviceConfig, deps, hooks)
    expect(h.device).toHaveLength(1)
    expect(h.device[0]).toEqual([deviceConfig, deps, hooks])
    expect(tokens).toEqual({
      accessToken: 'LOGIN_SECRET_ACCESS',
      refreshToken: 'LOGIN_SECRET_REFRESH',
      accountId: 'acct_1',
    })
  })

  it('persist threads the HELD store + forwards (provider, tokens, env) and returns the SDK path', () => {
    h.persist.length = 0
    const tokens = { accessToken: 'A', refreshToken: 'R', accountId: 'x' } as never
    const env = { AGENT_BUILDER_HOME: '/home/u' }
    const path = new AuthProvider(CONFIG, STORE).persist('openai', tokens, env)
    expect(h.persist).toHaveLength(1)
    expect(h.persist[0]).toEqual(['openai', tokens, STORE, env]) // held store passed, not re-derived
    expect(path).toBe('/home/u/.agent-builder/auth.json')
  })

  it('ensureFresh splits opts into the SDK 2nd/3rd args with the HELD config+store', async () => {
    h.ensure.length = 0
    const resolved = {
      provider: 'openai',
      accessToken: 'OLD',
      refreshToken: 'R',
      expiresAt: 1,
    } as never
    const now = () => 123
    const fresh = await new AuthProvider(CONFIG, STORE).ensureFresh(
      resolved,
      { fetch, now },
      { X: '1' },
    )
    expect(h.ensure).toHaveLength(1)
    const [gotResolved, gotOpts, gotDeps] = h.ensure[0]
    expect(gotResolved).toBe(resolved)
    expect(gotOpts).toEqual({ config: CONFIG, store: STORE, env: { X: '1' } }) // held config+store + env
    expect(gotDeps).toEqual({ fetch, now }) // http deps passed through untouched
    expect(fresh).toMatchObject({ provider: 'openai' })
  })

  it('SECRET-SAFETY: a full login → persist → refresh cycle emits NO token material to the console', async () => {
    const spies = ['log', 'warn', 'error', 'info', 'debug'].map((k) =>
      vi.spyOn(console, k as 'log').mockImplementation(() => {}),
    )
    try {
      const ap = new AuthProvider(CONFIG, STORE)
      const tokens = await ap.deviceLogin(
        { deviceCodeUrl: 'u' } as never,
        { fetch, sleep: async () => {}, now: () => 0 } as never,
        { onPrompt: () => {} } as never,
      )
      ap.persist('openai', tokens, {})
      await ap.ensureFresh(
        { provider: 'openai', accessToken: 'OLD', refreshToken: 'R', expiresAt: 1 } as never,
        { fetch, now: () => 0 },
        {},
      )
      const emitted = spies.flatMap((s) => s.mock.calls.flat().map((a) => JSON.stringify(a)))
      for (const secret of [
        'LOGIN_SECRET_ACCESS',
        'LOGIN_SECRET_REFRESH',
        'FRESH_SECRET_ACCESS',
        'SECRET_REFRESH',
      ]) {
        expect(
          emitted.some((line) => line.includes(secret)),
          `token "${secret}" must never reach the console`,
        ).toBe(false)
      }
    } finally {
      spies.forEach((s) => s.mockRestore())
    }
  })
})
