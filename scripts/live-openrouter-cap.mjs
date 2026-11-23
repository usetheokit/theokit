/**
 * Test-only: bound the output an OpenRouter chat-completions request may reserve.
 *
 * The SDK sends no `max_tokens`, so OpenRouter reserves the model's maximum (up to 65 535 tokens)
 * and answers 402 `quota_exceeded` when the key's remaining credit cannot cover it, though the live
 * answers are a sentence. A limit the request already carries is kept.
 *
 * Use as a Node preload (`node --import <this file>`, or `NODE_OPTIONS=--import=<this file>`) or as a
 * vitest `setupFiles` entry: importing the file installs the cap on the global `fetch`.
 */
export const MAX_OUTPUT_TOKENS = 2048

const INSTALLED = Symbol.for('theokit.liveOpenRouterCap')

/** Rewrite a JSON request body, adding `max_tokens` unless a limit is already there. */
export function capBody(body, limit = MAX_OUTPUT_TOKENS) {
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    return body
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return body
  if (parsed.max_tokens != null || parsed.max_completion_tokens != null) return body
  return JSON.stringify({ ...parsed, max_tokens: limit })
}

/** Swap `target.fetch` for one that caps chat-completions requests. Returns the restore function. */
export function capOpenRouterOutput(target = globalThis, limit = MAX_OUTPUT_TOKENS) {
  const original = target.fetch
  const capped = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.split('?')[0].endsWith('/chat/completions') && typeof init?.body === 'string') {
      return original.call(target, input, { ...init, body: capBody(init.body, limit) })
    }
    return original.call(target, input, init)
  }
  target.fetch = capped
  return () => {
    if (target.fetch === capped) target.fetch = original
  }
}

if (!globalThis[INSTALLED]) {
  globalThis[INSTALLED] = true
  capOpenRouterOutput(globalThis)
}
