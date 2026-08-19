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
  /** Environment variable that holds the API key for this provider. */
  envKey: string
  /** Base URL for the provider's OpenAI-compatible (or native) API. */
  baseUrl: string
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
]

/**
 * Runtime registry — copy of DEFAULT_REGISTRY mutable via registerProvider().
 * Sorted by priority on every resolve (stable, O(n log n) — n <= ~10 providers).
 */
const registry: ProviderDescriptor[] = [...DEFAULT_REGISTRY]

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
  registry.length = 0
  registry.push(...DEFAULT_REGISTRY)
}

/**
 * Get current registry snapshot (read-only — inspection).
 *
 * @public
 */
export function listProviders(): readonly ProviderDescriptor[] {
  return [...registry].sort((a, b) => a.priority - b.priority)
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
  const line = `[theokit] provider=${desc.name} (${how}) source=${desc.envKey} baseUrl=${desc.baseUrl}`
  if (options?.announce) options.announce(line)
  // `warn` rather than `info` because the repo's lint rule allows only `warn`/`error` — and this
  // line is closer to a warning in spirit anyway: it is the one chance an operator gets to notice
  // that the provider serving their agents is not the one they expected.
  else console.warn(line)
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
  if (modelId === undefined) return undefined
  const slash = modelId.indexOf('/')
  if (slash <= 0) return undefined
  const prefix = modelId.slice(0, slash)
  return registered.find((p) => p.name === prefix)
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
export function resolveProvider(modelId?: string, options?: ResolveOptions): ResolvedProvider {
  const sorted = [...registry].sort((a, b) => a.priority - b.priority)

  const declared = modelId === undefined ? undefined : providerOf(modelId, sorted)
  if (declared !== undefined && modelId !== undefined) {
    const apiKey = process.env[declared.envKey]
    if (apiKey && apiKey.length > 0) {
      announce(declared, 'declared by the model', options)
      return { name: declared.name, apiKey, baseUrl: declared.baseUrl }
    }
    // Deliberately NOT falling back to another provider's key. Silently substituting one is how
    // theokit#326 produced a 401 nobody could attribute: the request went somewhere the agent
    // never named. Say which variable is missing and stop.
    throw new Error(
      `Model "${modelId}" declares provider "${declared.name}", but ${declared.envKey} is not set. ` +
        `Set ${declared.envKey}, or change the model's provider prefix.`,
    )
  }

  for (const desc of sorted) {
    const apiKey = process.env[desc.envKey]
    if (apiKey && apiKey.length > 0) {
      announce(desc, 'by env priority', options)
      return {
        name: desc.name,
        apiKey,
        baseUrl: desc.baseUrl,
      }
    }
  }
  // No env var found — emit actionable error.
  const envKeys = sorted.map((p) => p.envKey).join(' OR ')
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
