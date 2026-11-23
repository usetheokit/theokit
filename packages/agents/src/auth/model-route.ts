/** The model-id prefix of the ChatGPT subscription route. The one place the literal is spelled. */
export const SUBSCRIPTION_PREFIX = 'openai-chatgpt/'

export interface ModelRef {
  /** The text before the first `/`, or `undefined` for an unqualified id. */
  readonly provider: string | undefined
  /** Everything after the first `/` (the whole id when unqualified). */
  readonly model: string
}

/** Split `<provider>/<model>` at the FIRST slash: `openrouter/openai/gpt-4o-mini` → `openrouter`, `openai/gpt-4o-mini`. */
export function parseModelRef(id: string): ModelRef {
  const slash = id.indexOf('/')
  if (slash <= 0) return { provider: undefined, model: id }
  return { provider: id.slice(0, slash), model: id.slice(slash + 1) }
}

/** True when the id runs over the ChatGPT subscription route (`openai-chatgpt/…`). */
export function isSubscriptionRoute(id: string): boolean {
  return id.startsWith(SUBSCRIPTION_PREFIX)
}

/**
 * The model id to hand the SDK for a resolved credential: an OAuth login to `openai` (a ChatGPT
 * subscription) rewrites the id onto the subscription route, keeping its last path segment; anything
 * else is returned unchanged.
 */
export function modelForCredential(
  credential: { readonly kind: string; readonly provider: string },
  modelId: string,
): string {
  if (credential.kind !== 'oauth' || credential.provider !== 'openai') return modelId
  const bare = modelId.slice(modelId.lastIndexOf('/') + 1)
  return `${SUBSCRIPTION_PREFIX}${bare}`
}
