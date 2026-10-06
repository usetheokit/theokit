/**
 * M15 (theokit-ai-first) — A2A client: call a remote A2A agent as a tool (ADR-0040 § D2).
 *
 * `createA2ATool` returns a `CustomTool` whose handler POSTs the input message to a remote agent's
 * HTTP endpoint and returns the text of the event stream it answers with — cross-network delegation. Uses `fetch` (Web
 * Standards, G8). The target is a remote AGENT endpoint, not an LLM provider, so the G2 grep guard
 * (`openrouter.ai|api.openai.com|api.anthropic.com`) is unaffected. `fetchImpl` is injectable for tests.
 */
import type { WireMessage } from '@theokit/presenter/wire'
import type { CustomTool } from '@theokit/sdk'

import {
  consumeUIMessageStream,
  type ChunkStreamOutcome,
} from '../client/consume-ui-message-stream.js'

/** How to authenticate to the remote agent. */
export interface A2AAuth {
  /** Bearer token → `Authorization: Bearer <token>`. */
  bearer?: string
  /** API-key header pair → `<name>: <value>` (e.g. `x-api-key`). */
  apiKey?: { header: string; value: string }
}

export interface A2AToolConfig {
  /** Remote agent endpoint URL (POST target). */
  url: string
  /** Tool name the model calls. */
  name: string
  /** Tool description surfaced to the model. */
  description: string
  /** Static headers merged into every request. */
  headers?: Record<string, string>
  /** Auth applied to every request. */
  auth?: A2AAuth
  /** Injected fetch (defaults to the global). Narrowed to the call shape this client uses. */
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
}

/**
 * Build the request headers in the HTTP transport's order: the stream and action defaults, then the
 * static headers, then auth. `Headers.set` is case-insensitive, so a static `X-Theo-Action` replaces
 * the default instead of reaching the route as `1, 0`.
 */
function buildHeaders(config: A2AToolConfig): Headers {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'text/event-stream',
    'x-theo-action': '1',
  })
  for (const [name, value] of Object.entries(config.headers ?? {})) headers.set(name, value)
  if (config.auth?.bearer) headers.set('authorization', `Bearer ${config.auth.bearer}`)
  if (config.auth?.apiKey) headers.set(config.auth.apiKey.header, config.auth.apiKey.value)
  return headers
}

/** The assistant message's text parts, joined in order; `''` when the turn produced no text. */
function textOf(message: WireMessage | undefined): string {
  if (message === undefined) return ''
  return message.parts
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('')
}

/** Why a stream that never reached its `finish` frame is not an answer. */
function cutStreamMessage(name: string, chunksReceived: number, res: Response): string {
  const base = `A2A call to "${name}" failed: the stream ended before its finish frame after ${String(chunksReceived)} chunks`
  if (chunksReceived > 0) return base
  return `${base} (response content-type ${res.headers.get('content-type') ?? 'none'})`
}

/**
 * Create a tool that delegates to a remote A2A agent. The remote answers the `{ message }` POST with
 * a UIMessage event stream, as the routes `generateAgentRoutes` and `mountAgent` serve do; the tool
 * returns the text of the streamed assistant message. A stream that carries an error frame, or that
 * ends before its `finish` frame, rejects naming the tool rather than returning partial text.
 */
export function createA2ATool(config: A2AToolConfig): CustomTool {
  const doFetch = config.fetchImpl ?? fetch
  return {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to send to the remote agent.' },
      },
      required: ['message'],
    },
    handler: async (input: Record<string, unknown>): Promise<string> => {
      // The input schema requires `message: string`; narrow defensively (never base-to-string).
      const message = typeof input.message === 'string' ? input.message : ''
      const res = await doFetch(config.url, {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify({ message }),
      })
      if (!res.ok) {
        throw new Error(`A2A call to "${config.name}" failed: ${res.status} ${res.statusText}`)
      }
      let last: WireMessage | undefined
      let outcome: ChunkStreamOutcome
      try {
        outcome = await consumeUIMessageStream(res, (m) => {
          last = m
        })
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(`A2A call to "${config.name}" failed: ${reason}`, { cause: err })
      }
      if (!outcome.terminated) {
        throw new Error(cutStreamMessage(config.name, outcome.chunksReceived, res))
      }
      return textOf(last)
    },
  }
}
