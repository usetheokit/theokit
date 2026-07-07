/**
 * M11 (theokit-ai-first) — {resource, thread} conversation scoping (ADR-0040 § D2, home concern).
 *
 * Maps a request's (resource, thread) pair to a deterministic, collision-safe conversation id so
 * multi-tenant apps isolate history without hand-building `user-${id}-thread-${id}` strings. This
 * is the app's request→conversation mapping — NOT the SDK's storage engine (which the derived id is
 * simply handed to). Background compression of long histories stays SDK-side.
 *
 * Encoding: each component is `encodeURIComponent`-escaped and joined with `/`. Since
 * `encodeURIComponent` escapes a raw `/` to `%2F`, the separator is unambiguous — `('a/b','c')` and
 * `('a','b/c')` derive DIFFERENT ids (collision-safe). Reversible via {@link parseConversationId}.
 */

const SEPARATOR = '/'

/** Derive a deterministic conversation id from a (resource, thread) pair. Fails fast on empty input. */
export function deriveConversationId(resource: string, thread: string): string {
  if (!resource) throw new Error('[@theokit/agents] deriveConversationId: resource must be non-empty')
  if (!thread) throw new Error('[@theokit/agents] deriveConversationId: thread must be non-empty')
  return `${encodeURIComponent(resource)}${SEPARATOR}${encodeURIComponent(thread)}`
}

/**
 * Reverse a derived conversation id back to its (resource, thread). Returns `null` for a value that
 * is not a derived scope id (no separator, or an empty component) — callers treat that as "opaque id,
 * not scoped".
 */
export function parseConversationId(id: string): { resource: string; thread: string } | null {
  const idx = id.indexOf(SEPARATOR)
  if (idx <= 0 || idx >= id.length - 1) return null
  const resource = decodeURIComponent(id.slice(0, idx))
  const thread = decodeURIComponent(id.slice(idx + 1))
  if (!resource || !thread) return null
  return { resource, thread }
}
