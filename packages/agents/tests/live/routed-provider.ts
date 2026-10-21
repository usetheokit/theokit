/**
 * Which upstream OpenRouter routed a chat-completions request to, read from the raw event stream
 * (B-523). The SDK keeps only `usage`, `choices` and `error` of each chunk, so the live
 * prompt-caching test reads the field itself: a turn 2 served by another upstream than turn 1
 * cannot read turn 1's cache, and the failure has to say so.
 */
import { redactThenCut } from './provider-text.js'

const DATA_PREFIX = 'data:'
/** The longest upstream name the live log prints, after redaction. */
const LABEL_LIMIT = 64

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

const CHAT_COMPLETIONS_PATH = '/chat/completions'

/** The upstream of each chat-completions request, in the order the requests were made. */
export interface RoutedProviderRecord {
  readonly providers: readonly (string | undefined)[]
  /** Put the `fetch` that was there before `recordRoutedProviders` back. */
  restore(): void
}

/**
 * Swap `target.fetch` for one that records the upstream of every chat-completions response. Each
 * request takes its slot when it is made, so responses that finish out of order stay in call
 * order. The body reaches the caller through a pass-through line reader, never a clone: a tee
 * would hold the caller's cancel at DONE until the connection closed (plan D4).
 */
export function recordRoutedProviders(target: { fetch: typeof fetch }): RoutedProviderRecord {
  const original = target.fetch
  const providers: (string | undefined)[] = []
  target.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (!urlOf(input).endsWith(CHAT_COMPLETIONS_PATH)) return original(input, init)
    const slot = providers.push(undefined) - 1
    const response = await original(input, init)
    if (response.body === null) return response
    const body = response.body.pipeThrough(
      lineReader((line) => {
        providers[slot] ??= routedProviderOf(line)
      }),
    )
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  return {
    providers,
    restore: () => {
      target.fetch = original
    },
  }
}

/**
 * The upstream of the turn whose requests are `providers[from]` to `providers[to - 1]`: the last
 * one, which answered, or `undefined` for a turn that made no request.
 */
export function upstreamOfTurn(
  providers: readonly (string | undefined)[],
  from: number,
  to: number,
): string | undefined {
  return to > from ? providers[to - 1] : undefined
}

/** An upstream as the live log prints it: redacted, then cut, or `(not reported)`. */
export function upstreamLabel(
  provider: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string {
  return redactThenCut(provider ?? '(not reported)', LABEL_LIMIT, env)
}

/** The turn-2 failure message: which upstream served each turn. */
export function describeUpstreams(turn1: string | undefined, turn2: string | undefined): string {
  return `turn 1 upstream=${upstreamLabel(turn1)}, turn 2 upstream=${upstreamLabel(turn2)}`
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  return input instanceof URL ? input.href : input.url
}

/**
 * Pass every chunk through unchanged, handing each complete line to `onLine` before the chunk
 * reaches the reader, and the unterminated last line when the source closes.
 */
function lineReader(onLine: (line: string) => void): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  let buffered = ''
  return new TransformStream({
    transform(chunk, controller) {
      buffered += decoder.decode(chunk, { stream: true })
      const lines = buffered.split('\n')
      buffered = lines.pop() ?? ''
      for (const line of lines) onLine(line)
      controller.enqueue(chunk)
    },
    flush() {
      buffered += decoder.decode()
      if (buffered !== '') onLine(buffered)
    },
  })
}
