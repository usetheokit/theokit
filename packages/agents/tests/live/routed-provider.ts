/**
 * Which upstream OpenRouter routed a chat-completions request to, read from the raw event stream
 * (B-523). The SDK keeps only `usage`, `choices` and `error` of each chunk, so the live
 * prompt-caching test reads the field itself: a turn 2 served by another upstream than turn 1
 * cannot read turn 1's cache, and the failure has to say so.
 */

const DATA_PREFIX = 'data:'

/** The first top-level `provider` a chunk of `streamText` carries, or `undefined`. */
export function routedProviderOf(streamText: string): string | undefined {
  for (const line of streamText.split('\n')) {
    if (!line.startsWith(DATA_PREFIX)) continue
    const payload = line.slice(DATA_PREFIX.length).trim()
    if (payload === '[DONE]') continue
    const provider = providerOfChunk(payload)
    if (provider !== undefined) return provider
  }
  return undefined
}

function providerOfChunk(payload: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    // A truncated or non-JSON line carries no provider; the stream's next line may.
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const provider = (parsed as { provider?: unknown }).provider
  return typeof provider === 'string' && provider !== '' ? provider : undefined
}
