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
import { compileAgentModule, resolveEnabledSkills, streamAgentUIMessages } from '@theokit/agents'

import { validateCsrfRequest, type CsrfMode } from '../security/csrf.js'

import { buildAgentHitl } from './build-agent-streamer.js'
import { durableUiMessageStreamResponse } from './durable-ui-message-stream-response.js'
import { getRunEventCache, mintRunId } from './run-event-cache.js'

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

/** Non-runtime options for {@link mountAgent} (grouped so the call stays ≤ 5 params). */
export interface MountAgentOptions {
  /** Labels a fail-fast `AgentDefinitionError` (the agent file path). Default `'agent module'`. */
  source?: string
  /** CSRF posture at this boundary. Default `'strict'`; `'off'` when a controller already gated (G5). */
  csrfMode?: CsrfMode
  /**
   * theokit-file-based-config (EC-1) — the framework-resolved app root. When the agent opted into
   * `.theokit/` file-based config (`.settingSources([...])`), discovery points here, NOT `process.cwd()`.
   */
  projectRoot?: string
}

/**
 * Mount a loaded agent module as a `Response`. `apiKey` is resolved by the caller
 * (`resolveProvider`). See {@link MountAgentOptions} for the labeling / CSRF / app-root knobs.
 */
export async function mountAgent(
  mod: unknown,
  request: Request,
  apiKey: string,
  { source = 'agent module', csrfMode = 'strict', projectRoot }: MountAgentOptions = {},
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

  // M13 — resolve a per-request skills selector (from `defineAgent({ skills: (ctx) => [...] })`)
  // against the M7 run-context, setting `skills.enabled` before the SDK runs. `undefined` ⇒ the
  // SDK enables every discovered skill. `compiled` is fresh per request, so mutation is safe.
  if (compiled.skillsResolver) {
    const enabled = await resolveEnabledSkills(compiled.skillsResolver, compiled.runContext ?? {})
    if (enabled !== undefined) compiled.skills = { enabled, autoInject: true }
  }

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
  // Extracted to `build-agent-streamer.ts` (M39 / DRY — the thread routes reuse the same wiring).
  const hitl = buildAgentHitl(compiled)

  // M37 (ADR-0046) — mint a transport runId + stream through the durable layer:
  // each SSE frame is cached + `id:`-tagged so a dropped client can reconnect
  // (or a second client observe) via `GET /api/agents/<name>/runs/<runId>/stream`.
  // The runId is surfaced in the `x-theokit-run-id` response header.
  const runId = mintRunId()
  return durableUiMessageStreamResponse(
    streamAgentUIMessages(compiled, apiKey, {
      ...input,
      hitl,
      signal: request.signal,
      cwd: resolveDiscoveryCwd(compiled, projectRoot),
    }),
    { runId, cache: getRunEventCache() },
  )
}

/**
 * theokit-file-based-config (EC-1) — resolve the `.theokit/` discovery cwd. When the agent opted into
 * file-based config (`.settingSources([...])`), point discovery at the framework-resolved app root,
 * NOT `process.cwd()` (which is not guaranteed to be the app root). No opt-in ⇒ `undefined` (byte-unchanged).
 */
function resolveDiscoveryCwd(
  compiled: { settingSources?: readonly unknown[] },
  projectRoot: string | undefined,
): string | undefined {
  const optedIn = (compiled.settingSources?.length ?? 0) > 0
  return projectRoot !== undefined && optedIn ? projectRoot : undefined
}
