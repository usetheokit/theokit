import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'

type Env = Readonly<Record<string, string | undefined>>

/** The stores a reference can name; tests inject stand-ins, the process uses the real ones. */
export interface SecretStores {
  /** Runs the 1Password CLI broker: `op read <reference>`; returns stdout. */
  readonly broker?: (reference: string) => Promise<string>
  /** Reads a file. Default: `readFileSync`. */
  readonly readFile?: (path: string) => string
  /** Used for Vault. Default: global `fetch`. */
  readonly fetchImpl?: typeof fetch
}

export interface ResolvedSecrets {
  /** The environment with every reference replaced by its value. */
  readonly env: Record<string, string | undefined>
  /** Each resolved value, for the masks. */
  readonly values: string[]
  /** Variable name -> store kind; never a value. */
  readonly refs: Record<string, string>
}

const PREFIX = 'secretref:'

/** The kind of store a value names, or undefined for a plain value. */
export function secretRefKind(value: string): 'env' | 'file' | 'op' | 'vault' | undefined {
  if (value.startsWith(`${PREFIX}env:`)) return 'env'
  if (value.startsWith(`${PREFIX}file:`)) return 'file'
  if (value.startsWith('op://')) return 'op'
  if (value.startsWith(`${PREFIX}vault:`)) return 'vault'
  return undefined
}

function opBroker(reference: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('op', ['read', '--no-newline', reference], { timeout: 15_000 }, (error, stdout) => (error ? reject(new Error('1Password broker failed')) : resolve(stdout)))
  })
}

/** `secretref:vault:<path>#<field>`: KV v2 at `$VAULT_ADDR/v1/<path>` using `VAULT_TOKEN`. */
async function vaultRead(spec: string, env: Env, fetchImpl: typeof fetch): Promise<string> {
  const [path, field] = spec.split('#')
  const addr = env.VAULT_ADDR?.replace(/\/+$/, '')
  if (!path || !field || !addr || !env.VAULT_TOKEN) throw new Error('Vault needs path#field, VAULT_ADDR and VAULT_TOKEN')
  const response = await fetchImpl(`${addr}/v1/${path.replace(/^\/+/, '')}`, { headers: { 'X-Vault-Token': env.VAULT_TOKEN } })
  if (!response.ok) throw new Error(`Vault answered ${response.status}`)
  const body = (await response.json()) as { data?: { data?: Record<string, unknown> } & Record<string, unknown> }
  const data = body.data?.data ?? body.data
  const value = data?.[field]
  if (typeof value !== 'string') throw new Error('Vault field missing')
  return value
}

/**
 * Replaces every environment value that names a secret by reference (`secretref:env:NAME`,
 * `secretref:file:PATH`, `op://vault/item/field`, `secretref:vault:PATH#FIELD`) with the value
 * read from its store, once at start. A failure names the variable and the store, never a value.
 */
export async function resolveSecretRefs(env: Env, stores: SecretStores = {}): Promise<ResolvedSecrets> {
  const out: Record<string, string | undefined> = { ...env }
  const values: string[] = []
  const refs: Record<string, string> = {}
  for (const [name, raw] of Object.entries(env)) {
    const kind = raw === undefined ? undefined : secretRefKind(raw.trim())
    if (raw === undefined || kind === undefined) continue
    const ref = raw.trim()
    let value: string
    try {
      if (kind === 'env') value = env[ref.slice(`${PREFIX}env:`.length)] ?? ''
      else if (kind === 'file') value = (stores.readFile ?? ((p) => readFileSync(p, 'utf8')))(ref.slice(`${PREFIX}file:`.length)).replace(/\r?\n$/, '')
      else if (kind === 'op') value = (await (stores.broker ?? opBroker)(ref)).replace(/\r?\n$/, '')
      else value = await vaultRead(ref.slice(`${PREFIX}vault:`.length), env, stores.fetchImpl ?? fetch)
    } catch (error) {
      throw new Error(`${name}: secret reference (${kind}) could not be resolved: ${error instanceof Error ? error.message.split('\n')[0] : 'failed'}`)
    }
    if (value === '') throw new Error(`${name}: secret reference (${kind}) resolved to an empty value`)
    out[name] = value
    values.push(value)
    refs[name] = kind
  }
  return { env: out, values, refs }
}
