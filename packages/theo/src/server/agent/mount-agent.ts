/**
 * M2 (theokit-ai-first) — mount a scanned `agents/<name>.ts` module as an SSE endpoint.
 *
 * The SINGLE wiring point shared by dev (vite middleware) and prod (built server), so the
 * two never drift (EC-4). Web-Standard `Request` → `Response`: parse the chat body, compile
 * the module (`compileAgentModule`, converges both surfaces), stream via the M0/M1 canonical
 * protocol (`streamAgentUIMessages` → `uiMessageStreamResponse`).
 *
 * Request body — accepts the `@ai-sdk/react` `useChat` shape (`{ id, messages: UIMessage[] }`,
 * the typed-client path) AND a simple `{ message, sessionId? }` shape (M0/M1-style clients).
 */
import {
  compileAgentModule,
  streamAgentUIMessages,
  type HumanInTheLoopOptions,
} from '@theokit/agents'

import { uiMessageStreamResponse } from '../define/ui-message-stream-response.js'
import { validateCsrfRequest, type CsrfMode } from '../security/csrf.js'

import { getApprovalRegistry } from './approval-registry.js'

/** The message + session extracted from a chat request, or `null` when the body is invalid. */
export interface AgentRequestInput {
  message: string
  sessionId: string
}

/** Extract the text of a `{ type: 'text', text: string }` part from an untrusted value. */
function partText(part: unknown): string {
  if (typeof part !== 'object' || part === null) return ''
  const p = part as Record<string, unknown>
  return p.type === 'text' && typeof p.text === 'string' ? p.text : ''
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Extract `{ message, sessionId }` from a chat request body. Returns `null` when neither the
 * ai-sdk `messages` shape nor the simple `message` shape yields non-empty user text.
 */
export function parseAgentRequestBody(body: unknown): AgentRequestInput | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>

  // ai-sdk useChat shape: { id, messages: UIMessage[] } — take the last message's text parts.
  if (Array.isArray(b.messages) && b.messages.length > 0) {
    const last = b.messages[b.messages.length - 1] as Record<string, unknown>
    const parts = Array.isArray(last.parts) ? last.parts : []
    const text = parts.map(partText).join('')
    if (text.length === 0) return null
    const sessionId = typeof b.id === 'string' && b.id.length > 0 ? b.id : crypto.randomUUID()
    return { message: text, sessionId }
  }

  // Simple shape: { message, sessionId? }.
  if (typeof b.message === 'string' && b.message.length > 0) {
    const sessionId =
      typeof b.sessionId === 'string' && b.sessionId.length > 0 ? b.sessionId : crypto.randomUUID()
    return { message: b.message, sessionId }
  }

  return null
}

/**
 * Mount a loaded agent module as a `Response`. `apiKey` is resolved by the caller
 * (`resolveProvider`). `source` labels a fail-fast `AgentDefinitionError` (the file path).
 */
export async function mountAgent(
  mod: unknown,
  request: Request,
  apiKey: string,
  source = 'agent module',
  csrfMode: CsrfMode = 'strict',
): Promise<Response> {
  // Enforce CSRF BEFORE any work — an agent run spends real LLM tokens, so a cross-origin
  // POST must be rejected before it reaches the SDK (parity with actions/routes). The custom
  // `X-Theo-Action` header + Origin match is the same defense `executeRoute`/`executeAction`
  // apply; the `useAgent` client sends the header. `off` skips; `warn` never blocks.
  if (csrfMode !== 'off') {
    const csrf = validateCsrfRequest(request)
    if (!csrf.valid && csrfMode === 'strict') {
      return jsonError(403, 'CSRF_FAILED', `CSRF check failed: ${csrf.reason}`)
    }
  }

  const compiled = compileAgentModule(mod, source)

  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    /* invalid/empty JSON → handled below as a 400 */
  }

  const input = parseAgentRequestBody(body)
  if (input === null) {
    return jsonError(400, 'BAD_REQUEST', 'Request must contain a non-empty message or messages[].')
  }

  // When the agent has @HumanInTheLoop-gated tools (M4), wire the pause: the plugin's `awaitApproval`
  // registers a pending approval in the shared registry (the Promise that PAUSES the run); the
  // approve route (`handleAgentApproval`) resolves it. No gated tools ⇒ the M2 stream path unchanged.
  const gated = compiled.hitl
  const registry = getApprovalRegistry()
  const hitl =
    gated && gated.size > 0
      ? {
          gated,
          awaitApproval: (approvalId: string, opts: HumanInTheLoopOptions, toolName: string) =>
            registry.register(approvalId, {
              timeoutMs: opts.timeout ?? 300_000,
              onTimeout: opts.onTimeout ?? 'abort',
              // M14 — surface toolName + question in GET /approvals (the plugin forwards c.name).
              toolName,
              question: opts.question,
            }),
        }
      : undefined

  return uiMessageStreamResponse(
    streamAgentUIMessages(compiled, apiKey, { ...input, hitl, signal: request.signal }),
  )
}
