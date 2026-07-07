/**
 * M15 (theokit-ai-first) — A2A client: call a remote A2A agent as a tool (ADR-0040 § D2).
 *
 * `createA2ATool` returns a `CustomTool` whose handler POSTs the input message to a remote agent's
 * HTTP endpoint and returns its text response — cross-network delegation. Uses `fetch` (Web
 * Standards, G8). The target is a remote AGENT endpoint, not an LLM provider, so the G2 grep guard
 * (`openrouter.ai|api.openai.com|api.anthropic.com`) is unaffected. `fetchImpl` is injectable for tests.
 */
import type { CustomTool } from '@theokit/sdk'

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

/** Build the request headers from static headers + auth. */
function buildHeaders(config: A2AToolConfig): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...config.headers }
  if (config.auth?.bearer) headers.authorization = `Bearer ${config.auth.bearer}`
  if (config.auth?.apiKey) headers[config.auth.apiKey.header] = config.auth.apiKey.value
  return headers
}

/**
 * Create a tool that delegates to a remote A2A agent. The remote is expected to answer a
 * `{ message }` POST with a JSON body carrying a `response` (or `text`) string.
 */
export function createA2ATool(config: A2AToolConfig): CustomTool {
  const doFetch = config.fetchImpl ?? fetch
  return {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'The message to send to the remote agent.' } },
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
      const data = (await res.json()) as { response?: string; text?: string }
      return data.response ?? data.text ?? ''
    },
  }
}
