import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * M79 — "given an env, a home and a model, WHICH credential do I use, and WHERE did it come from?"
 *
 * ## The gap this closes
 *
 * The genuinely hard half was already supplied: RFC 8628 device flow, refresh under a cross-process
 * lock, persistence, account-id extraction. The half every consumer meets FIRST was answered twice
 * inside the framework and exposed neither time — `resolveProvider()` locked behind
 * `internal-api.ts`, and `resolveCredential` deliberately withheld from `@theokit/agents/auth`.
 *
 * The "app policy" framing defends **which** providers exist. It does not defend the precedence
 * chain, the prefix↔provider consistency check, or the provenance record: those are mechanism. A
 * consumer forced to rewrite mechanism wrote a 70-line dotenv parser for the single question "shell
 * or `.env`?".
 *
 * ## Why the descriptors are a PARAMETER, and why this name is safe here
 *
 * Two functions already share the name `resolveCredential` with divergent semantics — sync vs async,
 * throws vs `undefined`, reads env vs does not, infers the provider vs refuses — which is exactly
 * why `auth-entry.ts` withholds the SDK's. A third under the same name in the same scope would
 * invite importing the wrong one.
 *
 * Taking the descriptor list as an ARGUMENT is what makes this one distinguishable at the call site
 * rather than by luck: it is the only one whose signature says which providers it is talking about.
 * The SDK's symbol stays unexported from this subpath, so only one is reachable.
 */

/** Where a credential came from — data, so provenance is formatting rather than parsing. */
export type SourceOrigin =
  | { readonly kind: 'env'; readonly varName: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'oauth'; readonly provider: string }

/** One provider the app is willing to use. WHICH providers exist stays app policy. */
export interface ProviderDescriptor {
  /** Name used in provenance, telemetry and messages. */
  readonly name: string
  /** Environment variable carrying the API key. */
  readonly envKey: string
  /** Lower wins. Declared, so the caller's array order is not a hidden second policy. */
  readonly priority: number
  /** Model-id prefix this provider claims (`openai/`). Absent ⇒ it claims none. */
  readonly modelPrefix?: string
}

/**
 * The answer, with its provenance attached.
 *
 * NOT called `ResolvedCredential`: the SDK already publishes a type under that name from this same
 * subpath, and the collision surfaced the moment this shipped. Two shapes sharing one name in one
 * scope is the failure this whole milestone is about — so the name says what it is, a resolution.
 */
export interface CredentialResolution {
  readonly kind: 'api-key' | 'oauth'
  readonly provider: string
  readonly apiKey: string
  readonly source: SourceOrigin
  /**
   * Whether the resolver PICKED the provider rather than the caller naming it.
   *
   * Without this, "why is it calling Anthropic?" has no answer in the data — the caller cannot tell
   * a user's explicit choice from a precedence fallback.
   */
  readonly inferred: boolean
}

/** Raised when the model's prefix names a provider that has no credential. */
export class ProviderPrefixMismatchError extends TheokitAgentError {
  override readonly name = 'ProviderPrefixMismatchError'
  constructor(provider: string, envKey: string, model: string) {
    super(
      `model "${model}" names provider "${provider}", but no credential for it was found. Set ` +
        `${envKey}, or drop the prefix to let the resolver pick by precedence. Falling back to ` +
        `another provider would send the request to a model you did not ask for — and bill you for it.`,
    )
  }
}

export interface ResolveCredentialInput {
  /** The environment as the process sees it — already loaded, already interpolated. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Directory whose `.env` is consulted for PROVENANCE only. Omitted ⇒ everything reads as shell. */
  readonly home?: string
  /** The providers this app accepts. App policy, hence a parameter. */
  readonly providers: readonly ProviderDescriptor[]
  /** Model id, when known. Its prefix is checked against the resolved provider. */
  readonly model?: string
}

/**
 * The names a `.env` file DECLARES — never their values.
 *
 * This is the parsimony that keeps it from being a dotenv parser (rung 1: the value half does not
 * need to exist). Provenance needs the set of declared names; the value in play is always the one
 * already in `env`, because the loader settled interpolation, quoting and overrides long before this
 * runs. Re-deriving it here would be a second, divergent answer to a question already answered.
 */
function declaredNames(path: string): ReadonlySet<string> {
  let raw: string
  try {
    // The path is the caller's own `home` joined with a fixed `.env`; no request input reaches here.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
    raw = readFileSync(path, 'utf8')
  } catch {
    // A missing `.env` is the common case, not an error: it means every variable came from the shell.
    return new Set()
  }

  const names = new Set<string>()
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    // A commented-out declaration is a line an operator left behind. Attributing a live value to it
    // would send them to edit a comment.
    if (trimmed === '' || trimmed.startsWith('#')) continue
    // `export FOO=bar` is valid in the `.env` files people actually write.
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed
    const eq = withoutExport.indexOf('=')
    if (eq <= 0) continue
    names.add(withoutExport.slice(0, eq).trim())
  }
  return names
}

/**
 * Resolve which credential to use, and record where it came from.
 *
 * Returns `undefined` when nothing is configured: a missing key is the ordinary first-run state, and
 * the caller's next move is to print "run `theokit auth login`" — which a thrown error makes harder,
 * not easier. A prefix that names a provider with no credential DOES throw, because that is a
 * contradiction rather than an absence.
 */
export function resolveCredential(input: ResolveCredentialInput): CredentialResolution | undefined {
  const byPriority = [...input.providers].sort((a, b) => a.priority - b.priority)

  // The descriptor and its key travel TOGETHER from here on. Selecting the descriptor and then
  // re-reading `env` would leave the type unable to see that the value is present — the shape that
  // asks for a non-null assertion, and an assertion is a claim the compiler cannot check.
  //
  // An empty value counts as ABSENT: `OPENAI_API_KEY=` is how a key gets unset in practice, and
  // treating it as present sends an empty Authorization header — turning a clear local failure into
  // a remote 401.
  const available = byPriority.flatMap((descriptor) => {
    const apiKey = input.env[descriptor.envKey]
    return apiKey === undefined || apiKey === '' ? [] : [{ descriptor, apiKey }]
  })

  const claimed = claimedProvider(input.model, byPriority)
  const found =
    claimed === undefined
      ? available[0]
      : available.find((candidate) => candidate.descriptor === claimed)

  if (claimed !== undefined && found === undefined) {
    throw new ProviderPrefixMismatchError(claimed.name, claimed.envKey, input.model ?? '')
  }
  if (found === undefined) return undefined

  return {
    kind: 'api-key',
    provider: found.descriptor.name,
    apiKey: found.apiKey,
    source: originOf(found.descriptor.envKey, input.home),
    inferred: claimed === undefined,
  }
}

/**
 * The provider the model id CLAIMS, if any.
 *
 * Only a prefix matching a declared provider counts. Reading every slash as a provider claim would
 * refuse perfectly good ids like `meta-llama/llama-3`, whose first segment is a publisher, not a
 * provider.
 */
function claimedProvider(
  model: string | undefined,
  providers: readonly ProviderDescriptor[],
): ProviderDescriptor | undefined {
  if (model === undefined) return undefined
  return providers.find((p) => p.modelPrefix !== undefined && model.startsWith(p.modelPrefix))
}

/** Whether the variable was declared in `<home>/.env` or came from the shell. */
function originOf(varName: string, home: string | undefined): SourceOrigin {
  if (home === undefined) return { kind: 'env', varName }
  const dotenv = join(home, '.env')
  return declaredNames(dotenv).has(varName)
    ? { kind: 'file', path: dotenv }
    : { kind: 'env', varName }
}
