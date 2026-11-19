import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  builtinSecretStores,
  resolveSecretRefs,
  SecretReferenceError,
  type SecretStore,
} from '../../src/auth-entry.js'

const dirs: string[] = []
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'secret-refs-'))
  dirs.push(d)
  return d
}

describe('resolveSecretRefs', () => {
  it('runs op with the inherited process environment', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'op'), '#!/bin/sh\nprintf "%s" "$OP_TEST_INHERITED"\n')
    chmodSync(join(dir, 'op'), 0o755)
    vi.stubEnv('PATH', `${dir}:${process.env.PATH ?? ''}`)
    vi.stubEnv('OP_TEST_INHERITED', 'inherited-token')
    const result = await resolveSecretRefs({ KEY: 'op://v/i/f' })
    expect(result.env.KEY).toBe('inherited-token')
  })

  it('each builtin store resolves its reference', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'secret.txt'), 'from-file\n')
    writeFileSync(join(dir, 'op'), '#!/bin/sh\nprintf "from-op:%s" "$3"\n')
    chmodSync(join(dir, 'op'), 0o755)
    const fetchFake = vi.fn(async () => Response.json({ data: { data: { key: 'from-vault' } } }))
    vi.stubGlobal('fetch', fetchFake)
    const result = await resolveSecretRefs({
      PATH: `${dir}:${process.env.PATH ?? ''}`,
      BASE: 'from-env',
      A: 'secretref:env:BASE',
      B: `secretref:file:${join(dir, 'secret.txt')}`,
      C: 'op://v/i/f',
      D: 'secretref:vault:secret/data/x#key',
      VAULT_ADDR: 'https://vault.test/',
      VAULT_TOKEN: 't',
      PLAIN: 'keep',
    })
    expect(result.env).toMatchObject({
      A: 'from-env',
      B: 'from-file',
      C: 'from-op:op://v/i/f',
      D: 'from-vault',
      PLAIN: 'keep',
    })
    expect(fetchFake).toHaveBeenCalledWith('https://vault.test/v1/secret/data/x', {
      headers: { 'X-Vault-Token': 't' },
    })
    expect([...result.values].sort((a, b) => a.localeCompare(b))).toEqual([
      'from-env',
      'from-file',
      'from-op:op://v/i/f',
      'from-vault',
    ])
  })

  it('a store failure throws SecretReferenceError naming the variable and the store', async () => {
    const store: SecretStore = {
      kind: 'stub',
      matches: (r) => r.startsWith('stub:'),
      read: () => Promise.reject(new Error('boom hunter2', { cause: 'hunter2' })),
    }
    const error = await resolveSecretRefs({ TOKEN: 'stub:x' }, [store]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SecretReferenceError)
    const e = error as SecretReferenceError
    expect(e.variable).toBe('TOKEN')
    expect(e.store).toBe('stub')
    expect(e.message).toContain('TOKEN')
    expect(e.message).toContain('stub')
    expect(e.message).not.toContain('hunter2')
    expect(e.cause).toBeUndefined()
  })

  it('a custom store error is never kept as the cause, even one that looks harmless', async () => {
    const store: SecretStore = {
      kind: 'stub',
      matches: (r) => r.startsWith('stub:'),
      read: () => Promise.reject(new Error('connection refused')),
    }
    const error = await resolveSecretRefs({ T: 'stub:x' }, [store]).catch((e: unknown) => e)
    expect((error as SecretReferenceError).cause).toBeUndefined()
  })

  it('omits the cause when a custom store error carries a secret unknown to the resolver', async () => {
    const leaked = 'unknown-secret-xyz'
    const failures: Error[] = [
      new Error(`denied ${leaked}`),
      Object.assign(new Error('denied'), { response: { headers: { authorization: leaked } } }),
      new Error('denied', { cause: new Error(leaked) }),
    ]
    for (const failure of failures) {
      const store: SecretStore = {
        kind: 'stub',
        matches: (r) => r.startsWith('stub:'),
        read: () => Promise.reject(failure),
      }
      const error = (await resolveSecretRefs({ T: 'stub:x' }, [store]).catch(
        (e: unknown) => e,
      )) as SecretReferenceError
      expect(error).toBeInstanceOf(SecretReferenceError)
      expect(error.cause).toBeUndefined()
      expect(error.message).not.toContain(leaked)
    }
  })

  it('a builtin failure never retains stderr or other text from the underlying error', async () => {
    const leaked = 'stderr-secret-qrs'
    const dir = tmp()
    const bin = join(dir, 'op')
    writeFileSync(bin, `#!/bin/sh\necho ${leaked} >&2\nexit 1\n`)
    chmodSync(bin, 0o755)
    const error = (await resolveSecretRefs(
      { K: 'op://v/i/f', PATH: `${dir}:${process.env.PATH ?? ''}` },
      [builtinSecretStores[2]!],
    ).catch((e: unknown) => e)) as SecretReferenceError
    expect(error).toBeInstanceOf(SecretReferenceError)
    const seen = JSON.stringify(Object.getOwnPropertyNames(error.cause ?? {}))
    const chain: unknown[] = []
    for (let c: unknown = error; c instanceof Error; c = c.cause) chain.push(c)
    for (const c of chain) {
      const e = c as Error
      expect(e.message).not.toContain(leaked)
      expect(e.stack ?? '').not.toContain(leaked)
      expect(JSON.stringify(e, Object.getOwnPropertyNames(e))).not.toContain(leaked)
    }
    expect(seen).not.toContain(leaked)
  })

  it('a builtin failure keeps the underlying error as the cause', async () => {
    const error = (await resolveSecretRefs({ K: 'secretref:file:/nonexistent/zzz' }).catch(
      (e: unknown) => e,
    )) as SecretReferenceError
    expect((error.cause as Error).cause).toMatchObject({ code: 'ENOENT' })
  })

  it('a builtin failure names the variable and store', async () => {
    const error = await resolveSecretRefs({ K: 'secretref:file:/nonexistent/zzz' }).catch(
      (e: unknown) => e,
    )
    expect(error).toMatchObject({ variable: 'K', store: 'file' })
  })

  it('a reference that resolves to an empty string is refused', async () => {
    await expect(resolveSecretRefs({ A: 'secretref:env:MISSING' })).rejects.toBeInstanceOf(
      SecretReferenceError,
    )
  })

  it('a caller store is consulted for its own prefix', async () => {
    const store: SecretStore = {
      kind: 'mine',
      matches: (r) => r.startsWith('mine:'),
      read: async (r) => `got-${r.slice(5)}`,
    }
    const result = await resolveSecretRefs({ A: 'mine:1', B: 'secretref:env:A' }, [
      store,
      ...builtinSecretStores,
    ])
    expect(result.env.A).toBe('got-1')
    expect(result.env.B).toBe('mine:1')
  })

  it('refs maps names to store kinds and never to values', async () => {
    const result = await resolveSecretRefs({ S: 's3cret', A: 'secretref:env:S', P: 'plain' })
    expect(result.refs).toEqual({ A: 'env' })
    expect(JSON.stringify(result.refs)).not.toContain('s3cret')
  })

  it('keeps a lone trailing carriage return and strips only a trailing CRLF', async () => {
    const dir = tmp()
    writeFileSync(join(dir, 'lone'), 'abc\r')
    writeFileSync(join(dir, 'crlf'), 'abc\r\n')
    const result = await resolveSecretRefs({
      A: `secretref:file:${join(dir, 'lone')}`,
      B: `secretref:file:${join(dir, 'crlf')}`,
    })
    expect(result.env.A).toBe('abc\r')
    expect(result.env.B).toBe('abc')
  })

  it('records a variable named __proto__ in refs and env as an own property', async () => {
    const env = JSON.parse('{"__proto__":"secretref:env:S","S":"v"}') as Record<string, string>
    const result = await resolveSecretRefs(env)
    expect(Object.hasOwn(result.refs, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(result.refs, '__proto__')?.value).toBe('env')
    expect(Object.getOwnPropertyDescriptor(result.env, '__proto__')?.value).toBe('v')
  })

  it('a store whose matches throws becomes a SecretReferenceError without the cause', async () => {
    const store: SecretStore = {
      kind: 'bad',
      matches: () => {
        throw new Error('leak hunter2')
      },
      read: async () => 'x',
    }
    const error = await resolveSecretRefs({ T: 'anything' }, [store]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SecretReferenceError)
    const e = error as SecretReferenceError
    expect(e).toMatchObject({ variable: 'T', store: 'bad' })
    expect(e.message).not.toContain('hunter2')
    expect(e.cause).toBeUndefined()
  })
})
