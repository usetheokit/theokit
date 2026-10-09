/**
 * M15 (theokit-ai-first) — A2A client: call a remote A2A agent as a tool (ADR-0040 § D2).
 *
 * `createA2ATool` returns a `CustomTool` whose handler POSTs the input message to a remote agent's
 * HTTP endpoint and returns the text of the event stream it answers with — cross-network delegation. Uses `fetch` (Web
 * Standards, G8). The target is a remote AGENT endpoint, not an LLM provider, so the G2 grep guard
 * (`openrouter.ai|api.openai.com|api.anthropic.com`) is unaffected. `fetchImpl` is injectable for tests.
 */
import type { WireMessage } from '@theokit/presenter/wire'
import type { CustomTool, ToolContext } from '@theokit/sdk'

import { AGENT_ACTION_HEADERS, agentRequestHeaders } from '../wire/agent-request-headers.js'
import {
  consumeUIMessageStream,
  type ChunkStreamOutcome,
} from '../wire/consume-ui-message-stream.js'

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
 * The request headers, merged the way `HttpTransport` merges them (`agent-request-headers.ts`): the
 * stream and action defaults, then the static headers, then auth. A later header replaces an earlier
 * one that differs only in letter case, so a static `x-theo-action` never reaches the route as `1, 0`.
 */
function buildHeaders(config: A2AToolConfig): Record<string, string> {
  const auth = config.auth
  return agentRequestHeaders(
    AGENT_ACTION_HEADERS,
    config.headers,
    auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : undefined,
    auth?.apiKey ? { [auth.apiKey.header]: auth.apiKey.value } : undefined,
  )
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
 * ends before its `finish` frame, rejects naming the tool rather than returning partial text; so
 * does a turn that finished with no text after frames the reader could not read. A remote whose
 * turn waits on a tool approval rejects when the gate appears: an A2A call cannot answer it.
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
    handler: async (input: Record<string, unknown>, ctx?: ToolContext): Promise<string> => {
      // The input schema requires `message: string`; narrow defensively (never base-to-string).
      const message = typeof input.message === 'string' ? input.message : ''
      // The run's signal: a cancelled run aborts the request and the stream it holds open, and the
      // call rejects with the abort reason rather than as a failure of the remote.
      const res = await doFetch(config.url, {
        method: 'POST',
        headers: buildHeaders(config),
        body: JSON.stringify({ message }),
        signal: ctx?.signal,
      })
      if (!res.ok) {
        throw new Error(`A2A call to "${config.name}" failed: ${res.status} ${res.statusText}`)
      }
      let last: WireMessage | undefined
      let outcome: ChunkStreamOutcome
      // Frames the wire parser dropped (invalid JSON, a variant it does not know). They separate an
      // agent that said nothing from a remote whose answer this reader could not read.
      let dropped = 0
      try {
        outcome = await consumeUIMessageStream(
          res,
          (m) => {
            last = m
            // A gated tool parks the remote run until its approve endpoint is called, which this
            // tool cannot do. Throwing here ends the read and cancels the stream it holds.
            const gate = m.parts.find((part) => part.state === 'approval-requested')
            if (gate !== undefined) {
              throw new Error(
                `the remote agent asked for approval of "${String(gate.toolName)}", which an A2A call cannot answer`,
              )
            }
          },
          { onWarn: () => (dropped += 1) },
        )
      } catch (err) {
        ctx?.signal?.throwIfAborted()
        const reason = err instanceof Error ? err.message : String(err)
        throw new Error(`A2A call to "${config.name}" failed: ${reason}`, { cause: err })
      }
      if (!outcome.terminated) {
        throw new Error(cutStreamMessage(config.name, outcome.chunksReceived, res))
      }
      const text = textOf(last)
      if (text === '' && dropped > 0) {
        throw new Error(
          `A2A call to "${config.name}" failed: the stream finished with no text after ${String(dropped)} frames the reader could not read`,
        )
      }
      return text
    },
  }
}
