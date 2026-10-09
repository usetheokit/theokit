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
import { consumeUIMessageStream } from '../wire/consume-ui-message-stream.js'

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

/** Every rejection of this tool reads `A2A call to "<name>" failed: <reason>`. */
function failure(name: string, reason: string, options?: ErrorOptions): Error {
  return new Error(`A2A call to "${name}" failed: ${reason}`, options)
}

/**
 * Read the remote's event stream to the text of its turn. An error frame, a stream cut before
 * `finish`, a tool approval the remote waits on, and a finished turn with no text after unreadable
 * frames all reject naming the tool. A cancelled run rejects with its abort reason instead.
 */
async function readReply(name: string, res: Response, signal?: AbortSignal): Promise<string> {
  let parts: WireMessage['parts'] = []
  let outcome
  try {
    outcome = await consumeUIMessageStream(res, (m) => {
      parts = m.parts
      // A gated tool parks the remote run until its approve endpoint is called, which this tool
      // cannot do. Throwing here ends the read and cancels the stream it holds.
      const gate = parts.find((part) => part.state === 'approval-requested')
      if (gate) {
        throw new Error(
          `the remote awaits approval of "${String(gate.toolName)}", which A2A cannot give`,
        )
      }
    })
  } catch (err) {
    signal?.throwIfAborted()
    throw failure(name, err instanceof Error ? err.message : String(err), { cause: err })
  }
  // A stream the caller's abort closed cleanly also ends before `finish`; that is a cancellation,
  // not a remote failure.
  signal?.throwIfAborted()
  const chunks = outcome.chunksReceived
  if (!outcome.terminated) {
    // With 0 chunks the content type names the first suspect: a remote answering JSON.
    const type =
      chunks > 0 ? '' : ` (response content-type ${res.headers.get('content-type') ?? 'none'})`
    throw failure(name, `the stream ended before its finish frame after ${chunks} chunks${type}`)
  }
  // Frames the wire parser dropped separate an agent that said nothing from a remote whose answer
  // this reader could not read.
  // Non-empty text parts, one per line: a turn that speaks before and after a tool call has two,
  // and joining them with nothing runs the sentences together in what the calling model reads.
  const text = parts
    .map((part) => (part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
  const dropped = outcome.framesDropped
  if (!text && dropped) {
    throw failure(name, `no text after ${dropped} unreadable frames`)
  }
  return text
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
  const { name, auth } = config
  const doFetch = config.fetchImpl ?? fetch
  return {
    name,
    description: config.description,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The message to send to the remote agent.' },
      },
      required: ['message'],
    },
    async handler(input: Record<string, unknown>, ctx?: ToolContext): Promise<string> {
      // The input schema requires `message: string`; narrow defensively (never base-to-string).
      const message = typeof input.message === 'string' ? input.message : ''
      // Headers merge the way `HttpTransport` merges them (`agent-request-headers.ts`): the stream
      // and action defaults, then the static headers, then auth, a later name replacing an earlier
      // one in any letter case, so a static `x-theo-action` never reaches the route as `1, 0`.
      // The run's signal: a cancelled run aborts the request and the stream it holds open, and the
      // call rejects with the abort reason rather than as a failure of the remote.
      const res = await doFetch(config.url, {
        method: 'POST',
        headers: agentRequestHeaders(
          AGENT_ACTION_HEADERS,
          config.headers,
          auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : undefined,
          auth?.apiKey ? { [auth.apiKey.header]: auth.apiKey.value } : undefined,
        ),
        body: JSON.stringify({ message }),
        signal: ctx?.signal,
      })
      if (!res.ok) {
        // Release the unread body so the connection returns to the pool. The status is the error
        // to report; a failure to cancel must not replace it.
        await res.body?.cancel().catch(() => undefined)
        throw failure(name, `${res.status} ${res.statusText}`)
      }
      return readReply(name, res, ctx?.signal)
    },
  }
}
