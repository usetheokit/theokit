import { processSingleton } from '../_internal/process-singleton.js'

/**
 * Provider Resolver — Strategy + Registry pattern (FAANG-grade).
 *
 * Inspiration: Dapr Conversation Registry (`dapr/pkg/components/conversation/registry.go`)
 * + Encore Manager provider array (`encore/runtimes/go/pubsub/manager_internal.go`).
 *
 * Principle: provider routing is the FRAMEWORK's responsibility, not the consumer's — but the
 * consumer still gets to SAY which provider it wants, and it says so in the model id.
 *
 * `provider/model` is the convention every agent in this ecosystem already writes
 * (`anthropic/claude-sonnet-4-6`, `openrouter/anthropic/claude-haiku-4.5`), and it is the one the
 * SDK routes on. Until theokit#326 this resolver ignored it entirely and picked by env-var
 * priority, so an agent that declared `anthropic/...` was handed an OpenRouter key whenever one
 * happened to be present — and every turn failed with `auth_failed (HTTP 401)` against a provider
 * nobody asked for. The declared provider now wins; priority is the fallback for a bare model id.
 *
 * Wire protocol: OpenAI Chat Completions (universal — implemented by every
 * os providers: OpenRouter, Groq, Mistral, Together, Anthropic via proxy, etc).
 *
 * Resolution by priority (FIRST match wins):
 *   1. OPENROUTER_API_KEY → baseUrl=openrouter.ai (multi-model gateway)
 *   2. OPENAI_API_KEY     → baseUrl=api.openai.com
 *   3. ANTHROPIC_API_KEY  → direct Anthropic (Messages API, not OpenAI-compat)
 *
 * Escape hatch: an explicit `options.apiKey` OVERRIDES auto-resolution
 * (the consumer can force a specific provider if it wants to).
 */

/**
 * Provider configuration descriptor — Registry entry shape.
 *
 * @public
 */
export interface ProviderDescriptor {
  /** Stable name used internally — not exposed on the wire. */
  name: string
  /**
   * Environment variable that holds the API key for this provider.
   *
   * **Absent means the provider needs no credential** — a model running on the developer's own
   * machine has nothing to authenticate against. Such a provider is reachable ONLY when a model id
   * names it (`ollama/llama3.2`); it never participates in the priority walk, because the walk
   * reads "this variable is set" as "a human configured this provider", and a keyless entry offers
   * no equivalent signal. Including it would route every bare model id to localhost the moment no
   * cloud key was set (usetheokit/theokit#407).
   */
  envKey?: string
  /** Base URL for the provider's OpenAI-compatible (or native) API. */
  baseUrl: string
  /**
   * Environment variable that OVERRIDES {@link baseUrl} when set.
   *
   * Scoped honestly: every caller inside this framework takes `.apiKey` from the resolved provider
   * and discards `.baseUrl` (`cli/commands/start/handlers.ts`, `vite-plugin/api-middleware.ts`,
   * `cli/commands/agent.ts`), so the endpoint a request actually reaches is chosen by the SDK, from
   * its own profile — which reads `OLLAMA_HOST` itself. This field therefore does not redirect
   * traffic today.
   *
   * It exists so that the `baseUrl` this function REPORTS agrees with where the request goes, for
   * the consumers that read it — `resolveProvider` is public API, and a reported endpoint that
   * contradicts the real one is a debugging trap rather than a harmless inaccuracy.
   */
  baseUrlEnv?: string
  /** Resolution priority (lower = higher priority). FIRST match wins. */
  priority: number
}

/**
 * Resolved provider configuration — output of `resolveProvider()`.
 *
 * @public
 */
export interface ResolvedProvider {
  name: string
  apiKey: string
  baseUrl: string
}

/**
 * Default provider registry. Order = priority (first = highest).
 *
 * Adding a new provider:
 *   1. Append entry below (or register via `registerProvider()`).
 *   2. Set `envKey` matching the user's env var convention.
 *   3. Set `baseUrl` to the OpenAI-compat endpoint (or native if not compat).
 *   4. Provider name used in telemetry/logs only — never wire-exposed.
 */
const DEFAULT_REGISTRY: ProviderDescriptor[] = [
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    priority: 1,
  },
  {
    name: 'openai',
    envKey: 'OPENAI_API_KEY',
    baseUrl: 'https://api.openai.com/v1',
    priority: 2,
  },
  {
    name: 'anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    baseUrl: 'https://api.anthropic.com',
    priority: 3,
  },
  {
    // Mirrors the profile `@theokit/sdk` already ships for this provider — same default host, same
    // override variable — so the two cannot disagree about where ollama is listening. The SDK is
    // what dials it (see `baseUrlEnv`); this entry's job is to stop the resolver from rejecting the
    // model before the SDK is ever reached. No `envKey`: see that field's doc comment for why the
    // absence also keeps this entry out of the priority walk.
    name: 'ollama',
    baseUrl: 'http://localhost:11434',
    baseUrlEnv: 'OLLAMA_HOST',
    priority: 100,
  },
]

/**
 * Runtime registry — copy of DEFAULT_REGISTRY mutable via registerProvider().
 * Sorted by priority on every resolve (stable, O(n log n) — n <= ~10 providers).
 *
 * Held per PROCESS rather than per module instance (usetheokit/theokit#401). As a module-level
 * `const` it was one array per chunk, and the bundler emits this module into two of them: an
 * application calling `registerProvider` mutated one array while `theokit start` resolved against
 * another, so the call had no effect and the resulting error listed the defaults while the
 * registered provider sat in an object nobody read.
 */
function registryOf(): ProviderDescriptor[] {
  return processSingleton('provider-registry', () => [...DEFAULT_REGISTRY])
}

/**
 * Providers already announced, so a boot line does not become a per-request line.
 *
 * theokit#326 — resolution was silent on success. `resolveProvider` returns `{ name, apiKey,
 * baseUrl }` and every call site consumes only the key, so an operator could only learn which
 * provider was selected from an error message: exactly when it has already failed, and never in
 * the case that hurts most — a stale key that resolves cleanly and 401s at the provider.
 */
const announced = new Set<string>()

/** Test-only reset, so announcement state does not leak between cases. @public */
export function resetProviderAnnouncements(): void {
  announced.clear()
}

/** Where the announcement goes, and what it may contain. @public */
export interface ResolveOptions {
  /** Receives one line per provider, at most once. NEVER receives the key. */
  announce?: (line: string) => void
}

/**
 * Register a new provider (Registry pattern — runtime extension point).
 * Useful for self-hosted endpoints or custom providers without touching theokit src.
 *
 * @example
 * registerProvider({
 *   name: 'self-hosted',
 *   envKey: 'SELF_HOSTED_API_KEY',
 *   baseUrl: 'https://llm.internal.acme.com/v1',
 *   priority: 0, // highest priority
 * })
 *
 * @public
 */
export function registerProvider(descriptor: ProviderDescriptor): void {
  // Idempotent — replace existing by name.
  const registry = registryOf()
  const idx = registry.findIndex((p) => p.name === descriptor.name)
  if (idx >= 0) registry[idx] = descriptor
  else registry.push(descriptor)
}

/**
 * Reset registry to DEFAULT_REGISTRY (test-only / dev escape hatch).
 *
 * @public
 */
export function resetProviderRegistry(): void {
  const registry = registryOf()
  registry.length = 0
  registry.push(...DEFAULT_REGISTRY)
}

/**
 * Get current registry snapshot (read-only — inspection).
 *
 * @public
 */
export function listProviders(): readonly ProviderDescriptor[] {
  return [...registryOf()].sort((a, b) => a.priority - b.priority)
}

/**
 * Says which provider was selected, once.
 *
 * Carries the provider, HOW it was chosen, and the variable the credential came from — never the
 * credential. Which env var holds it is what an operator needs to fix a mis-selection; the value
 * is what a log must never hold.
 */
function announce(
  desc: ProviderDescriptor,
  how: 'declared by the model' | 'by env priority',
  options: ResolveOptions | undefined,
): void {
  if (announced.has(desc.name)) return
  announced.add(desc.name)
  const source = desc.envKey ?? 'none (this provider takes no credential)'
  const line = `[theokit] provider=${desc.name} (${how}) source=${source} baseUrl=${baseUrlOf(desc)}`
  if (options?.announce) options.announce(line)
  // `warn` rather than `info` because the repo's lint rule allows only `warn`/`error` — and this
  // line is closer to a warning in spirit anyway: it is the one chance an operator gets to notice
  // that the provider serving their agents is not the one they expected.
  else console.warn(line)
}

/**
 * Where this provider is listening, after any environment override.
 *
 * One function so the announcement line and the resolved config can never name different hosts —
 * an operator reading a log to find out where requests went must be reading the truth.
 */
function baseUrlOf(desc: ProviderDescriptor): string {
  if (desc.baseUrlEnv === undefined) return desc.baseUrl
  const override = process.env[desc.baseUrlEnv]
  return override !== undefined && override.length > 0 ? override : desc.baseUrl
}

/**
 * The provider a model id declares, or `undefined` when it declares none.
 *
 * `provider/model` and `gateway/provider/model` both resolve on the FIRST segment: a gateway is a
 * provider from the framework's point of view (it holds the credential), and everything after it
 * is the upstream namespace the gateway itself routes on.
 *
 * A bare id (`gpt-4o-mini`, `qwen2.5:3b`) declares nothing, and an unregistered prefix is treated
 * the same way rather than as an error — a project may legitimately point a custom id at a
 * registered provider's endpoint, and refusing it here would break that before it reached the SDK.
 */
function providerOf(
  modelId: string | undefined,
  registered: readonly ProviderDescriptor[],
): ProviderDescriptor | undefined {
  const prefix = declaredPrefixOf(modelId)
  if (prefix === undefined) return undefined
  return registered.find((p) => p.name === prefix)
}

/**
 * The provider name a model id declares, registered or not.
 *
 * Split out of {@link providerOf} because the two questions differ exactly where the error message
 * used to go wrong: "which registered provider is this?" answers `undefined` both for a bare id and
 * for `groq/…`, and the resolver needs to tell those apart to say something true about the second.
 */
function declaredPrefixOf(modelId: string | undefined): string | undefined {
  if (modelId === undefined) return undefined
  const slash = modelId.indexOf('/')
  if (slash <= 0) return undefined
  return modelId.slice(0, slash)
}

/** A provider that authenticates — the only kind the priority walk may select. */
type CredentialedProvider = ProviderDescriptor & { envKey: string }

function takesCredential(desc: ProviderDescriptor): desc is CredentialedProvider {
  return desc.envKey !== undefined
}

/**
 * Resolve the provider for a model.
 *
 * When `modelId` declares a registered provider (`anthropic/…`), THAT provider's key is
 * required — no substitution. Otherwise the registry is walked by priority, first match wins.
 *
 * @returns ResolvedProvider with apiKey + baseUrl + name
 * @throws Error if NO provider env var is set (actionable message)
 *
 * @public
 */
/**
 * What a keyless provider reports as its key.
 *
 * This was `''` until #501, on the reasoning that an empty string is the honest value for a
 * provider that needs no credential. The reasoning was sound and the value was wrong: the SDK's
 * `createLocalAgent` calls `resolveApiKey`, which treats `''` as ABSENT, falls back to
 * `THEOKIT_API_KEY` — which nobody sets for a local model — and throws `missing_api_key` before it
 * ever looks at the provider. So #407 opened the registry door and every keyless provider,
 * including the builtin `ollama`, still could not serve a turn.
 *
 * `'local'` is the SDK's own sentinel (`LOCAL_RUNTIME_MOCK_KEY`, `internal/auth/api-key-validator`).
 * It is not a placeholder credential and does not become one: `validateApiKeyShape` short-circuits
 * on it, and `mergeExplicitApiKey` excludes it from the credential pools, so it never reaches a
 * provider as an `authorization` header. That was the objection the old comment raised against any
 * non-empty value, and it is the reason this specific value is the one that answers it — measured
 * against @theokit/sdk 4.52.1, where `apiKey: ''` throws `missing_api_key` and `apiKey: 'local'`
 * builds the agent.
 */
const KEYLESS_API_KEY = 'local'

export function resolveProvider(modelId?: string, options?: ResolveOptions): ResolvedProvider {
  const sorted = [...registryOf()].sort((a, b) => a.priority - b.priority)

  const declared = modelId === undefined ? undefined : providerOf(modelId, sorted)
  if (declared !== undefined && modelId !== undefined) {
    if (declared.envKey === undefined) {
      announce(declared, 'declared by the model', options)
      return { name: declared.name, apiKey: KEYLESS_API_KEY, baseUrl: baseUrlOf(declared) }
    }
    const apiKey = process.env[declared.envKey]
    if (apiKey && apiKey.length > 0) {
      announce(declared, 'declared by the model', options)
      return { name: declared.name, apiKey, baseUrl: baseUrlOf(declared) }
    }
    // Deliberately NOT falling back to another provider's key. Silently substituting one is how
    // theokit#326 produced a 401 nobody could attribute: the request went somewhere the agent
    // never named. Say which variable is missing and stop.
    throw new Error(
      `Model "${modelId}" declares provider "${declared.name}", but ${declared.envKey} is not set. ` +
        `Set ${declared.envKey}, or change the model's provider prefix.`,
    )
  }

  // A prefix the registry does not know is a CHOICE, not a silence — refuse before the walk.
  //
  // `providerOf` returns `undefined` for an unregistered prefix, which is indistinguishable from a
  // bare model id, so the priority walk below used to claim the turn and the "not registered" error
  // further down became unreachable for anyone holding a key. The visible cost was a confusing
  // message; the real one was a turn that SUCCEEDED against a provider nobody named — different
  // endpoint, different account billed, prompt delivered to a vendor the operator had routed away
  // from, announced only by a `console.warn` that fires once per process (#503).
  //
  // #326 settled the principle for a registered provider: declared wins, priority is the fallback
  // for a bare model id. This extends it to the case #326 did not reach — an unregistered prefix is
  // not a bare model id either.
  const unregisteredPrefix = declared === undefined ? declaredPrefixOf(modelId) : undefined
  if (unregisteredPrefix !== undefined) {
    throw new Error(
      `Model "${String(modelId)}" declares provider "${unregisteredPrefix}", which is not registered. ` +
        `Registered providers: ${sorted.map((p) => p.name).join(', ')}. ` +
        `Register it with registerProvider({ name: '${unregisteredPrefix}', … }), or use a registered prefix.`,
    )
  }

  // Only providers that take a credential. A keyless entry is reachable exclusively through the
  // declared branch above; see `ProviderDescriptor.envKey` for why the walk cannot include it.
  const credentialed = sorted.filter(takesCredential)

  for (const desc of credentialed) {
    const apiKey = process.env[desc.envKey]
    if (apiKey && apiKey.length > 0) {
      announce(desc, 'by env priority', options)
      return {
        name: desc.name,
        apiKey,
        baseUrl: baseUrlOf(desc),
      }
    }
  }

  // Nothing resolved, and the model id declared nothing — the unregistered-prefix case was refused
  // above the walk, which is where it belongs (#503). This message is for the bare-id case only.
  //
  // It used to live here and it was the right message in the wrong place: reachable exactly when
  // the operator had no keys at all, which is the case that needed it least (usetheokit/theokit#407
  // is why the message exists; #503 is why it moved).
  const envKeys = credentialed.map((p) => p.envKey).join(' OR ')
  throw new Error(
    `No LLM provider API key found in environment. Set one of: ${envKeys}. ` +
      `Get a free OpenRouter key at https://openrouter.ai/keys (recommended — one key, many models).`,
  )
}

/**
 * Try to resolve — does NOT throw. Returns null if no provider available.
 * Useful for graceful degradation (e.g., mock mode).
 *
 * @public
 */
export function tryResolveProvider(modelId?: string): ResolvedProvider | null {
  try {
    return resolveProvider(modelId)
  } catch {
    return null
  }
}
