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

import type { RoutePolicy } from '../../core/contracts/route-policy.js'
import { validateCsrfRequest, type CsrfMode } from '../security/csrf.js'

import {
  admitAgentRequest,
  agentAccessDenied,
  readAgentPolicy,
  type AgentSubjectResolver,
} from './agent-access.js'
import type { ApiKeyResolver } from './api-key-resolver.js'
import { buildAgentHitl } from './build-agent-streamer.js'
import { durableUiMessageStreamResponse } from './durable-ui-message-stream-response.js'
import { observeServedRun } from './observe-served-run.js'
import { getRunEventCache, mintRunId } from './run-event-cache.js'

// Re-exported so existing importers keep working. It is declared in its own module because
// `build-agent-streamer.ts` needs it too and this file already imports from there (no-circular).
export type { ApiKeyResolver } from './api-key-resolver.js'

/** The message + session extracted from a chat request, or `null` when the body is invalid. */
interface AgentRequestInput {
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
interface MountAgentOptions {
  /** Labels a fail-fast `AgentDefinitionError` (the agent file path). Default `'agent module'`. */
  source?: string
  /** CSRF posture at this boundary. Default `'strict'`; `'off'` when a controller already gated (G5). */
  csrfMode?: CsrfMode
  /**
   * theokit-file-based-config (EC-1) — the framework-resolved app root. When the agent opted into
   * `.theokit/` file-based config (`.settingSources([...])`), discovery points here, NOT `process.cwd()`.
   */
  projectRoot?: string
  /**
   * The agent's name, as the scanner discovered it. Reported to the policy under
   * `params.agent` and named in a refusal. Defaults to {@link MountAgentOptions.source}.
   */
  agentName?: string
  /**
   * Who may run this agent, and against which conversation (ADR 0001,
   * usetheokit/theokit#365).
   *
   * NORMALLY ABSENT, and that is the fix rather than an omission: the policy is read from the
   * agent module's own `export const policy`, so it travels with the agent instead of depending
   * on every caller remembering to pass it. This option exists for a host that resolved the
   * decision itself (an `@Expose`-bound controller, an embedder), and it OVERRIDES the module's
   * declaration when given.
   *
   * Evaluated against the parsed request body, so a policy can ask who owns the
   * conversation being resumed. Absent on both ends ⇒ not evaluated, matching the route
   * executors: absence means "not declared" and is not reinterpreted as denial. Absence is
   * refused at scan time instead, where the file that omitted it can be named.
   */
  policy?: RoutePolicy
  /**
   * Resolve the authenticated caller. Invoked at most once, and only when a policy exists — an
   * agent declaring `'public'` never pays for the application's `createContext`.
   */
  resolveSubject?: AgentSubjectResolver
}

/**
 * Read the body and decide whether this caller may run the agent at all.
 *
 * Both gates live here, and both run BEFORE the module is compiled and long
 * before the SDK is reached — the same reason the CSRF gate upstream runs first:
 * an agent run spends real tokens, so a malformed request and an unauthorized one
 * are turned away before any of that is paid for. A policy evaluated after the
 * run began is a cost gate that costs.
 *
 * The policy sees the PARSED body, so it can ask who owns the conversation the
 * request is trying to resume — which is the whole point, since the endpoint
 * accepts a caller-supplied session id and the durable store resumes whatever it
 * names (usetheokit/theokit#365).
 *
 * @returns the parsed input, or the `Response` that refuses the request.
 */
/**
 * Wrap a subject resolver so one request resolves at most once (B-016).
 *
 * The gate needs the caller's identity, and so does the approval ledger when the run pauses on a
 * gated tool. Resolving twice would double whatever the application's `server/context.ts` does — a
 * session lookup, a token verification, a query — for a value that cannot change inside one request.
 */
function memoizeSubject(
  resolveSubject: AgentSubjectResolver | undefined,
): AgentSubjectResolver | undefined {
  if (resolveSubject === undefined) return undefined
  let resolved: { subject: Awaited<ReturnType<AgentSubjectResolver>> } | undefined
  return async () => {
    resolved ??= { subject: await resolveSubject() }
    return resolved.subject
  }
}

/**
 * Who owns the approvals this run raises, or `undefined` (B-016).
 *
 * Recorded only when the agent DECLARES a policy. An agent declaring `'public'` — or declaring
 * nothing — is one where identity does not govern access, and attributing its approvals would start
 * refusing callers the declaration admits: a behaviour change dressed as a bug fix. So the ledger
 * stays empty there and the approve route behaves exactly as before.
 */
async function resolveApprovalOwner(
  declaredPolicy: RoutePolicy | undefined,
  resolveOnce: AgentSubjectResolver | undefined,
): Promise<string | undefined> {
  if (declaredPolicy === undefined || declaredPolicy === 'public') return undefined
  return ((await resolveOnce?.()) ?? undefined)?.id
}

async function admitRequest(
  request: Request,
  policy: RoutePolicy | undefined,
  resolveSubject: AgentSubjectResolver | undefined,
  agentName: string,
): Promise<AgentRequestInput | Response> {
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    /* invalid/empty JSON → a 400 below */
  }

  const input = parseAgentRequestBody(body)
  if (input === null) {
    return jsonError(400, 'BAD_REQUEST', 'Request must contain a non-empty message or messages[].')
  }

  const params = { agent: agentName, endpoint: 'run' as const, sessionId: input.sessionId }
  const decision = await admitAgentRequest(policy, resolveSubject, params, input)
  if (!decision.allowed) return agentAccessDenied(decision, params)

  return input
}

/**
 * Mount a loaded agent module as a `Response`.
 *
 * `apiKey` accepts either a resolved string or an {@link ApiKeyResolver}. The resolver form exists
 * because the credential depends on the model, and the model is only known once the module is
 * compiled — inside here. Callers that resolved eagerly were choosing a provider before anyone
 * could read which one the agent asked for, which is theokit#326.
 *
 * See {@link MountAgentOptions} for the labeling / CSRF / app-root knobs.
 */
export async function mountAgent(
  mod: unknown,
  request: Request,
  apiKey: string | ApiKeyResolver,
  {
    source = 'agent module',
    csrfMode = 'strict',
    projectRoot,
    agentName,
    policy,
    resolveSubject,
  }: MountAgentOptions = {},
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

  // The declaration travels with the agent, not with the caller — see `agent-access.ts`. An
  // explicit option still wins, for a host that already took the decision.
  // ONE identity for the agent, resolved once: the gate judges it and the spans are labelled with
  // it. They used to be two — `agentName` for the policy, `source` for the telemetry — and the two
  // disagreed on the plain route, where `source` is the module's absolute path
  // (usetheokit/theokit#406). A caller that names no agent still gets `source`, as the policy
  // always has; both convention routes name one, which is why neither exports a path any more.
  const identity = agentName ?? source

  const declaredPolicy = policy ?? readAgentPolicy(mod, source)

  const resolveOnce = memoizeSubject(resolveSubject)

  const admitted = await admitRequest(request, declaredPolicy, resolveOnce, identity)
  if (admitted instanceof Response) return admitted
  const input = admitted

  const compiled = compileAgentModule(mod, source)

  // Now that the model is known, let the caller pick the credential for THAT provider.
  // `compiled.plugins` reaches the resolver so a provider the agent DECLARED can serve the model
  // (#579). Without it, `.plugins(Provider.builtins())` was invisible at resolution time and the
  // prefix came back "not registered".
  const resolvedApiKey =
    typeof apiKey === 'function' ? apiKey(compiled.model, compiled.plugins) : apiKey

  // M13 — resolve a per-request skills selector (from `defineAgent({ skills: (ctx) => [...] })`)
  // against the M7 run-context, setting `skills.enabled` before the SDK runs. `undefined` ⇒ the
  // SDK enables every discovered skill. `compiled` is fresh per request, so mutation is safe.
  if (compiled.skillsResolver) {
    const enabled = await resolveEnabledSkills(compiled.skillsResolver, compiled.runContext ?? {})
    if (enabled !== undefined) compiled.skills = { enabled, autoInject: true }
  }

  // When the agent has @HumanInTheLoop-gated tools (M4), wire the pause: the plugin's `awaitApproval`
  // registers a pending approval in the shared registry (the Promise that PAUSES the run); the
  // approve route (`handleAgentApproval`) resolves it. No gated tools ⇒ the M2 stream path unchanged.
  // Extracted to `build-agent-streamer.ts` (M39 / DRY — the thread routes reuse the same wiring).
  const hitl = buildAgentHitl(compiled, await resolveApprovalOwner(declaredPolicy, resolveOnce))

  // M37 (ADR-0046) — mint a transport runId + stream through the durable layer:
  // each SSE frame is cached + `id:`-tagged so a dropped client can reconnect
  // (or a second client observe) via `GET /api/agents/<name>/runs/<runId>/stream`.
  // The runId is surfaced in the `x-theokit-run-id` response header.
  const runId = mintRunId()
  const stream = streamAgentUIMessages(compiled, resolvedApiKey, {
    ...input,
    hitl,
    signal: request.signal,
    // Two reasons to name a cwd, and memory is the one that must win when both apply: file-based
    // discovery works from `process.cwd()` (it just discovers less), while durable memory written
    // to `process.cwd()` lands in a directory nobody named and nobody reads (#557).
    cwd: resolveMemoryCwd(compiled, projectRoot) ?? resolveDiscoveryCwd(compiled, projectRoot),
    baseDir: resolveSessionBaseDir(projectRoot),
  })
  // M8 — spans for the run, each tool call, each HITL pause and the token usage,
  // read off the chunk stream the agent already emits. Absent adapter ⇒ the
  // stream is passed through untouched, so an app that configured no telemetry
  // pays nothing (usetheokit/theokit#353).
  //
  // The trace the spans join is decided inside `observeServedRun`, from this
  // request — the same function the thread route calls, so the two endpoints
  // cannot drift into producing different telemetry for the same agent
  // (usetheokit/theokit#381). What that function could not decide was the agent
  // LABEL, which arrives from here: this call used to pass `source`, so every
  // span of every run on this route carried the module's absolute path
  // (usetheokit/theokit#406).
  return durableUiMessageStreamResponse(
    observeServedRun(stream, { agentName: identity, request }),
    { runId, cache: getRunEventCache() },
  )
}

/**
 * The cwd the SDK resolves the DURABLE MEMORY root from, when the agent asked for memory (#557).
 *
 * Separate from {@link resolveDiscoveryCwd} on purpose, even though both answer "which cwd". That
 * one exists for `.settingSources([...])` discovery and stays `undefined` otherwise, because
 * `undefined` is what the SDK reads as "enable everything discovered" — widening it would change
 * skill selection for every agent that never asked for memory.
 *
 * This one exists because at the declared floor (`@theokit/sdk@^4.52.1`) the memory root is
 * `resolve(memoryDir(opts.cwd))`, so an absent cwd sends `MEMORY.md` to `process.cwd()` — and
 * `resolveDiscoveryCwd`'s own docblock already records that `process.cwd()` "is not guaranteed to
 * be the app root". An operator who starts the server from a different directory gets their memory
 * written somewhere else, with nothing said.
 *
 * Naming the resolved root makes that deterministic. It does NOT relocate memory on SDK >= 4.61,
 * where the root is derived from `local.baseDir` instead — one field governing both the transcript
 * and the memory, which is `usetheokit/theokit-sdk#463` and not fixable from here. What is fixable
 * from here is not adding a second source of nondeterminism underneath it.
 */
export function resolveMemoryCwd(
  compiled: { memory?: object },
  projectRoot: string | undefined,
): string | undefined {
  if (!memoryIsOn(compiled.memory)) return undefined
  return projectRoot
}

/**
 * Whether a compiled `memory` field means memory is ON.
 *
 * The same rule `assembleM8CreateOptions` applies when it projects the field, and deliberately not
 * a second one: the builder path carries the SDK's `MemorySettings` (which has `enabled`), while
 * the legacy decorator shape has no such field and declaring `@Memory()` at all means the author
 * wants it on. Two functions disagreeing about what "on" means is how the cwd would be named for a
 * run whose memory the adapter then did not enable, or the reverse.
 */
function memoryIsOn(memory: object | undefined): boolean {
  if (memory === undefined) return false
  if ('enabled' in memory) return (memory as { enabled?: unknown }).enabled === true
  return true
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

/** Strip trailing `/` without a backtracking regex (linear scan). */
function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end -= 1
  return value.slice(0, end)
}

/**
 * SDK 4.0 (SE40) — resolve the root of the native `.jsonl` session transcript. Unlike `.theokit/`
 * discovery, persistence is NOT gated on a file-based-config opt-in — every agent session persists.
 * Root it under the app's `.data/`, kept OUT of the `.theokit/` config dir so a
 * `projects/` transcript subtree never collides with `settingSources` discovery. Absent `projectRoot`
 * ⇒ `undefined` (the SDK default `~/.theokit` applies).
 *
 * **This directory holds conversation content and nothing here can keep it out of a repository.**
 * That is the app's `.gitignore`, which lives in a different tree. This comment used to assert
 * "(git-ignored, EC-2)" as though the protection were local, and the scaffold ignored `data/` —
 * without the dot — so the assertion was false and its confidence is what stopped anyone checking
 * (#395). The scaffold now ignores `.data/`, and `tests/unit/scaffold-ignores-what-the-framework-writes.test.ts`
 * derives the path from THIS function rather than repeating it, so moving the transcripts breaks the
 * test instead of leaking quietly.
 */
export function resolveSessionBaseDir(projectRoot: string | undefined): string | undefined {
  if (projectRoot === undefined) return undefined
  // Web-Standards discipline (R3a/G8): no `node:path` in `server/` — append with `/` (the SDK
  // normalizes the separator). Strip a trailing slash on `projectRoot` so we never emit `//`.
  // A trailing-slash strip written as a loop-free replace: `/\/+$/` is super-linear under
  // backtracking on a long run of slashes, and this value can come from user config.
  return `${trimTrailingSlashes(projectRoot)}/.data/agent-sessions`
}
