// This module READS credentials; it contains none. The filename matches the repository's
// secret-pattern gate (`credentials*`), so it is flagged on every diff that touches it — verified
// on 2026-08-08: no key material, no tokens, no PEM blocks. Every `apiKey` here is a parameter name
// or a type field, and the only long literal is a class name. //
// Keep it that way: values belong in the store the SDK writes at 0600, never in source.
import {
  authFilePath as storeAuthFilePath,
  AuthProvider,
  CredentialError,
  credentialHome as storeCredentialHome,
} from '@theokit/agents/auth'
import { isTransientError } from '@theokit/agents'
import {
  CredentialNotFoundError,
  DEFAULT_PROVIDERS,
  providerFromApiKeyPrefix,
  resolveAgentCredential,
} from '@theokit/agents/auth'
import type { SourceOrigin } from '@theokit/agents/auth'
import type { CredentialProviderDescriptor as ProviderDescriptor } from '@theokit/agents/auth'

import { OPENAI_OAUTH_CONFIG, credentialStore } from './oauth-config.js'

const PROVIDERS = ['openrouter', 'anthropic', 'openai'] as const
export type Provider = (typeof PROVIDERS)[number]
export const PROVIDER_NAMES: readonly Provider[] = PROVIDERS

/**
 * The provider table, DERIVED from the framework's defaults instead of hand-written.
 *
 * Three tables lived here (`PREFIXES`, `PREFIXES_BY_LENGTH`, `ENV_KEYS`) saying what every terminal
 * agent app says. `@theokit/agents@9.2.0` ships them as `DEFAULT_PROVIDERS`, so this file narrows
 * that list to the providers this product supports rather than restating their env vars, prefixes
 * and precedence.
 *
 * The narrowing is the app policy that genuinely belongs here; the mechanism is not.
 */
const DESCRIPTORS: readonly ProviderDescriptor[] = DEFAULT_PROVIDERS.filter(
  (d): d is ProviderDescriptor => (PROVIDERS as readonly string[]).includes(d.name),
)

/**
 * A prefix a descriptor still states. The framework's defaults carry none since they come from the
 * SDK provider table: the SDK's `providerFromApiKeyPrefix` is then the only judge of a key's vendor.
 */
const PREFIXES: Readonly<Partial<Record<Provider, string>>> = Object.fromEntries(
  DESCRIPTORS.flatMap((d) => (d.keyPrefix ? [[d.name, d.keyPrefix]] : [])),
) as Partial<Record<Provider, string>>

export function credentialHome(home: string, env: Record<string, string | undefined> = {}): string {
  return storeCredentialHome(credentialStore(home), env)
}

export const authFilePath = (home: string, env: Record<string, string | undefined> = {}): string =>
  storeAuthFilePath(credentialStore(home), env)

/**
 * B-034 — returns the auth home and no longer WRITES it into the caller's environment.
 *
 * This was `env.THEOKIT_AUTH_HOME ??= credentialHome(home, env)`: a getter that mutated its
 * argument. A caller passing `process.env` had the process environment changed as a side effect of
 * asking a question, and a caller passing a scoped environment had it silently widened.
 */
export function ensureAuthHome(env: Record<string, string | undefined>, home: string): string {
  return env.THEOKIT_AUTH_HOME ?? credentialHome(home, env)
}

/**
 * Point the SDK's credential store at THIS product's, by WRITING the variable the SDK reads.
 *
 * The SDK's OAuth store is `<home>/.theokit/auth.json` and ours is `<home>/.theocode/auth.json`.
 * The only seam between them is `THEOKIT_AUTH_HOME`, which the SDK treats as the store DIRECTORY
 * (`credentialHome` returns the override verbatim, ignoring its own `dirName`). Unset, the SDK's
 * `openai-chatgpt` provider looks in a file this product never writes and reports "no ChatGPT
 * credential found" for a credential that is sitting on disk.
 *
 * It exists because the two surfaces had two idioms for one fact and only one of them worked.
 * B-034 correctly stopped `ensureAuthHome` from mutating its argument — a getter with a side effect
 * — but the CLI's bootstrap kept calling it as though it still did, and DISCARDED the return. So
 * the CLI never set the variable: measured 2026-08-25, `theocode run` failed on a ChatGPT sign-in
 * while the TUI, which writes the variable itself, answered normally on the same credential.
 *
 * Naming the writing half separately is the point. `ensureAuthHome` ANSWERS where the store is;
 * this one INSTALLS it. A caller cannot silently get the first when it meant the second, which is
 * exactly the mistake that shipped.
 */
export function installAuthHome(env: Record<string, string | undefined>, home: string): string {
  const resolved = ensureAuthHome(env, home)
  env.THEOKIT_AUTH_HOME = resolved
  return resolved
}

export { CredentialError }

export class MissingCredentialError extends CredentialError {
  override readonly name = 'MissingCredentialError'
  readonly attempts: readonly string[]
  constructor(message: string, attempts: readonly string[]) {
    super(message)
    this.attempts = attempts
  }
}

/**
 * Deliberately NARROWER than the SDK's `ResolvedCredential`, which is otherwise identical.
 *
 * The SDK generalises to `provider: string` on purpose — it has no list of providers to know. This
 * application does, so it narrows to `Provider` and gets exhaustiveness on every switch over it.
 * That is a refinement, not a duplicated declaration, and it is recorded here because a surface
 * review reads the two shapes as the same fact written twice (finding SAC-07).
 *
 * The half of that finding which WAS a real gap — `@theokit/agents/auth` not re-exporting the OAuth
 * engine — is fixed upstream and released in `@theokit/agents@7.4.0`.
 */
export interface ResolvedCredential {
  kind: 'api' | 'oauth'
  provider: Provider
  apiKey: string
  /** Where it came from, as data: the framework's own origin, never a flattened string. */
  source: SourceOrigin
  inferred: boolean
  expiresAt?: number
}

/**
 * The resolution chain — the framework's since `@theokit/agents@9.2.1`.
 *
 * ~165 lines lived here: the declared-provider pin, the env precedence walk, the file reader with
 * its Zod schemas, the key↔provider coherence check and the attempts list. None of it was about this
 * product; all of it was the policy every terminal agent app needs and none could import, because
 * the framework shipped the PIECES (store at 0600, device flow, refresh, `writeCredential`) and not
 * the ASSEMBLY.
 *
 * `resolveAgentCredential` is that assembly. What stays here is genuinely ours:
 *
 *  - the `Provider` union (this build supports three, and the narrowing buys exhaustiveness),
 *  - the variable NAME that pins one (`THEOCODE_PROVIDER` — products disagree on it),
 *  - `MissingCredentialError`, because callers already catch it by type.
 *
 * The shapes differ in two places and are adapted rather than propagated: `kind` is `api` here and
 * `api-key` there, and `source` is the SDK's flat string only at the refresh boundary, where it is
 * flattened for the SDK and the typed origin is restored afterwards.
 */
/**
 * Refuse a key whose prefix contradicts its declared provider, on the WRITE path.
 *
 * The read path gets this from the framework (`keyPrefix` on the descriptor). Writing is where the
 * mistake originates — `theocode auth login --provider anthropic` with an OpenAI key — and catching
 * it here means the bad pair never reaches disk.
 */
export function assertPairMatches(provider: Provider, apiKey: string, where: string): void {
  const expected = PREFIXES[provider]
  if (expected !== undefined) {
    if (apiKey.startsWith(expected)) return
    throw new CredentialError(
      `${where}: the key declared for provider "${provider}" does not start with "${expected}". ` +
        `Either the provider or the key is wrong; sending it would fail mid-request.`,
    )
  }
  // Every provider this product supports is one the SDK knows, so a key it cannot attribute to the
  // chosen provider (another vendor's, or none it recognises) is a paste into the wrong place.
  const inferred = providerFromApiKeyPrefix(apiKey)
  if (inferred === provider) return
  const looksLike =
    inferred === undefined ? 'a key of no vendor the SDK knows' : `a "${inferred}" key`
  throw new CredentialError(
    `${where}: the key declared for provider "${provider}" is not a "${provider}" key; it looks like ${looksLike}. ` +
      `Either the provider or the key is wrong; sending it would fail mid-request.`,
  )
}

function toLocalKind(kind: 'api-key' | 'oauth'): 'api' | 'oauth' {
  return kind === 'api-key' ? 'api' : 'oauth'
}

/** The SDK's refresh API carries the origin as a flat string; flatten it for that call only. */
function toSdkSource(source: SourceOrigin): string {
  if (source.kind === 'env') return source.varName
  if (source.kind === 'file') return source.path
  return source.provider
}

export function resolveCredential(opts: {
  env: Record<string, string | undefined>
  home: string | undefined
  model?: string | undefined
}): ResolvedCredential {
  const { env, home, model } = opts
  try {
    const resolved = resolveAgentCredential({
      env,
      providers: DESCRIPTORS,
      // The variable NAME is this product's; the refuse-to-fall-back semantics are the framework's.
      declaredProviderEnvVar: 'THEOCODE_PROVIDER',
      // The `openai-chatgpt/` route is the framework's to answer: stored OpenAI login, never a key.
      ...(model === undefined ? {} : { model }),
      ...(home === undefined ? {} : { home, store: credentialStore(home) }),
    })
    return {
      kind: toLocalKind(resolved.kind),
      provider: resolved.provider as Provider,
      apiKey: resolved.apiKey,
      source: resolved.source,
      inferred: resolved.inferred,
    }
  } catch (err) {
    // Re-typed, not re-worded: callers catch `MissingCredentialError` by type, and the framework's
    // message already carries the attempts list this product used to build by hand.
    if (err instanceof CredentialNotFoundError) {
      throw new MissingCredentialError(
        `${err.message}\n\nSet one of those environment variables, or create the credential file:\n` +
          `  ${home !== undefined ? authFilePath(home, env) : '~/.theocode/auth.json'}\n` +
          `  {"provider": "openrouter", "api_key": "sk-or-..."}   (mode 0600)`,
        err.attempts,
      )
    }
    throw err
  }
}

function classifyRefreshFailure(err: unknown): {
  readonly transient: boolean
  readonly cause: unknown
} {
  return { transient: isTransientError(err), cause: err }
}

export async function resolveFreshCredential(opts: {
  env: Record<string, string | undefined>
  home: string | undefined
  model?: string | undefined
  fetch?: typeof fetch
  now?: () => number
  timeoutMs?: number
}): Promise<ResolvedCredential> {
  const resolved = resolveCredential({ env: opts.env, home: opts.home, model: opts.model })
  if (resolved.kind !== 'oauth' || opts.home === undefined) return resolved
  if (resolved.provider !== 'openai') return resolved
  const baseFetch = opts.fetch ?? fetch
  const timeoutMs = opts.timeoutMs ?? 30_000
  const boundedFetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    baseFetch(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    })) as typeof fetch
  let fresh: Awaited<ReturnType<AuthProvider['ensureFresh']>>
  try {
    fresh = await new AuthProvider(OPENAI_OAUTH_CONFIG, credentialStore(opts.home)).ensureFresh(
      { ...resolved, source: toSdkSource(resolved.source) },
      { fetch: boundedFetch, now: opts.now ?? Date.now },
      opts.env,
    )
  } catch (err) {
    const { transient } = classifyRefreshFailure(err)
    if (!transient) throw err
    return resolved
  }
  return { ...fresh, provider: resolved.provider, source: resolved.source }
}

export async function resolveCredentialForModel(
  model: string | undefined,
  opts: {
    env: Record<string, string | undefined>
    home: string | undefined
    fetch?: typeof fetch
    now?: () => number
    timeoutMs?: number
  },
): Promise<ResolvedCredential> {
  return resolveFreshCredential({ ...opts, model })
}
