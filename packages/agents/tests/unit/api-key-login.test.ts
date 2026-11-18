import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CredentialError,
  CredentialExistsError,
  loginWithApiKey,
  logout,
  ProviderPrefixMismatchError,
} from '../../src/auth-entry.js'

let home: string
const store = () =>
  ({ home, dirName: '.app', fileName: 'auth.json', homeEnvVar: 'APP_HOME' }) as never
const KEY = 'sk-or-v1-abcdef0123456789'

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'api-key-login-'))
})
afterEach(() => rmSync(home, { recursive: true, force: true }))

describe('loginWithApiKey', () => {
  it('infers the provider from the prefix and writes the file', () => {
    const r = loginWithApiKey(`  ${KEY}\n`, store())
    expect(r.provider).toBe('openrouter')
    expect(r.path).toBe(join(home, '.app', 'auth.json'))
    expect(readFileSync(r.path, 'utf8')).toContain(KEY)
  })

  it('refuses an existing credential without overwrite', () => {
    const { path } = loginWithApiKey(KEY, store())
    let err: unknown
    try {
      loginWithApiKey(KEY, store())
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(CredentialExistsError)
    expect(err).toBeInstanceOf(CredentialError)
    expect((err as CredentialExistsError).code).toBe('credential_exists')
    expect((err as Error).message).toContain(path)
    expect((err as Error).message).not.toContain(KEY)
    expect(loginWithApiKey(KEY, store(), { overwrite: true }).path).toBe(path)
  })

  it('refuses an empty key', () => {
    expect(() => loginWithApiKey('   ', store())).toThrow(CredentialError)
  })

  it('refuses an unknown prefix with no provider', () => {
    expect(() => loginWithApiKey('nonsense-key', store())).toThrow(CredentialError)
  })

  it('refuses a key whose prefix contradicts the provider', () => {
    let err: unknown
    try {
      loginWithApiKey(KEY, store(), { provider: 'anthropic' })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ProviderPrefixMismatchError)
    expect((err as Error).message).not.toContain(KEY)
  })
})

describe('logout', () => {
  it('returns false when there is no file and true after removing one', () => {
    expect(logout(store())).toBe(false)
    loginWithApiKey(KEY, store())
    expect(logout(store())).toBe(true)
    expect(logout(store())).toBe(false)
  })

  it('honours the env-selected store path', () => {
    const other = mkdtempSync(join(tmpdir(), 'api-key-login-env-'))
    try {
      const r = loginWithApiKey(KEY, store(), { env: { APP_HOME: other } })
      writeFileSync(join(home, 'unrelated'), '')
      expect(logout(store(), { APP_HOME: other })).toBe(true)
      expect(r.path.startsWith(home)).toBe(false)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })
})
