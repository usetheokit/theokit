/**
 * Resolve secret references in an environment, once at start.
 *
 * A value of the form `secretref:env:NAME`, `secretref:file:PATH`, `op://vault/item/field` or
 * `secretref:vault:PATH#FIELD` is replaced by what its store returns. The result carries the
 * resolved values (for output masks) and a map of variable name to store kind, never a value.
 */
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import { TheokitAgentError } from '@theokit/sdk/errors'

type Env = Readonly<Record<string, string | undefined>>

export interface SecretStore {
  /** `'env' | 'file' | 'op' | 'vault'` or a caller's own. */
  readonly kind: string
  matches(reference: string): boolean
  read(reference: string, env: Env): Promise<string>
}

/** A failure raised by a built-in store; its message is fixed text and cannot carry a value. */
class BuiltinStoreFailure extends Error {
  override readonly name = 'BuiltinStoreFailure'
}

export class SecretReferenceError extends TheokitAgentError {
  override readonly name = 'SecretReferenceError'

  constructor(
    message: string,
    readonly variable: string,
    readonly store: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
  }
}

const PREFIX = 'secretref:'
const OP_TIMEOUT_MS = 15_000
const trimNewline = (value: string): string => {
  if (value.endsWith('\r\n')) return value.slice(0, -2)
  return value.endsWith('\n') ? value.slice(0, -1) : value
}

const readOwn = (env: Env, name: string): string | undefined =>
  Object.hasOwn(env, name) ? env[name] : undefined

const setOwn = (target: Record<string, unknown>, name: string, value: unknown): void => {
  Object.defineProperty(target, name, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  })
}

const envStore: SecretStore = {
  kind: 'env',
  matches: (reference) => reference.startsWith(`${PREFIX}env:`),
  read: (reference, env) =>
    Promise.resolve(readOwn(env, reference.slice(`${PREFIX}env:`.length)) ?? ''),
}

const fileStore: SecretStore = {
  kind: 'file',
  matches: (reference) => reference.startsWith(`${PREFIX}file:`),
  async read(reference) {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- the path is the operator's reference
      return trimNewline(await readFile(reference.slice(`${PREFIX}file:`.length), 'utf8'))
    } catch {
      throw new BuiltinStoreFailure('file could not be read')
    }
  },
}

const opStore: SecretStore = {
  kind: 'op',
  matches: (reference) => reference.startsWith('op://'),
  read: (reference, env) =>
    new Promise((resolve, reject) => {
      // The CLI needs the process's own PATH, HOME and 1Password auth variables; the supplied
      // configuration is layered on top.
      const childEnv = {
        ...process.env,
        ...Object.fromEntries(
          Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      }
      execFile(
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- `op` is the 1Password CLI, looked up on the caller's PATH by design
        'op',
        ['read', '--no-newline', reference],
        { timeout: OP_TIMEOUT_MS, env: childEnv },
        (error, stdout) => {
          if (error) reject(new BuiltinStoreFailure('1Password CLI failed'))
          else resolve(trimNewline(stdout))
        },
      )
    }),
}

const vaultStore: SecretStore = {
  kind: 'vault',
  matches: (reference) => reference.startsWith(`${PREFIX}vault:`),
  async read(reference, env) {
    const [path, field] = reference.slice(`${PREFIX}vault:`.length).split('#')
    let addr = env.VAULT_ADDR
    while (addr?.endsWith('/')) addr = addr.slice(0, -1)
    const token = env.VAULT_TOKEN
    if (!path || !field || !addr || !token) {
      throw new BuiltinStoreFailure('Vault needs path#field, VAULT_ADDR and VAULT_TOKEN')
    }
    let response: Response
    try {
      response = await fetch(`${addr}/v1/${path.replace(/^\/+/, '')}`, {
        headers: { 'X-Vault-Token': token },
      })
    } catch {
      throw new BuiltinStoreFailure('Vault request failed')
    }
    if (!response.ok) throw new BuiltinStoreFailure(`Vault answered ${response.status}`)
    let body: { data?: { data?: Record<string, unknown> } & Record<string, unknown> }
    try {
      body = (await response.json()) as typeof body
    } catch {
      throw new BuiltinStoreFailure('Vault answer was not JSON')
    }
    const value = (body.data?.data ?? body.data)?.[field]
    if (typeof value !== 'string') throw new BuiltinStoreFailure('Vault field missing')
    return value
  },
}

export const builtinSecretStores: readonly SecretStore[] = [
  envStore,
  fileStore,
  opStore,
  vaultStore,
]

function findStore(
  stores: readonly SecretStore[],
  reference: string,
  variable: string,
): SecretStore | undefined {
  for (const candidate of stores) {
    try {
      if (candidate.matches(reference)) return candidate
    } catch {
      // A caller's exception may carry the value; name only the variable and the store.
      throw new SecretReferenceError(
        `${variable}: secret store (${candidate.kind}) failed while matching the reference`,
        variable,
        candidate.kind,
      )
    }
  }
  return undefined
}

/**
 * Replaces every value of `env` that is a reference to a store with the value read from it.
 * References are read from the input `env` and are not resolved recursively. A failure throws
 * `SecretReferenceError` naming the variable and the store; an empty result is refused.
 */
export async function resolveSecretRefs(
  env: Env,
  stores: readonly SecretStore[] = builtinSecretStores,
): Promise<{
  env: Record<string, string | undefined>
  values: string[]
  refs: Record<string, string>
}> {
  const out: Record<string, string | undefined> = { ...env }
  const values: string[] = []
  const refs: Record<string, string> = {}
  for (const [name, raw] of Object.entries(env)) {
    if (raw === undefined) continue
    const reference = raw.trim()
    const store = findStore(stores, reference, name)
    if (store === undefined) continue
    let value: string
    try {
      value = await store.read(reference, env)
    } catch (error) {
      // Only our own fixed-text failures are safe to quote or keep; a caller store's error may
      // carry the value in its message, properties or nested cause.
      const known = error instanceof BuiltinStoreFailure
      const detail = known ? `: ${error.message}` : ''
      throw new SecretReferenceError(
        `${name}: secret reference (${store.kind}) could not be resolved${detail}`,
        name,
        store.kind,
        known ? { cause: error } : undefined,
      )
    }
    if (typeof value !== 'string' || value === '') {
      throw new SecretReferenceError(
        `${name}: secret reference (${store.kind}) resolved to an empty value`,
        name,
        store.kind,
      )
    }
    setOwn(out, name, value)
    values.push(value)
    setOwn(refs, name, store.kind)
  }
  return { env: out, values, refs }
}
