/**
 * T5a.2 Phase A — Foundation: Web-Standards request handler entry-point.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase A. Bridges the gap between Web `Request`/`Response` and the
 * existing `defineRoute` config shape (which is consumed today by the Node-
 * shaped `executeRoute`).
 *
 * This is the entry-point T1.2 RED tests expect:
 *   `executeWebRequest(request: Request, routeModule: { GET?, POST?, ... }): Promise<Response>`
 *
 * Architecture per ADR-0028 (R3a) — this function accepts a native Web
 * `Request` and returns a native Web `Response`. No `node:*` is required in
 * the implementation (Zod + native Headers/URL/Response cover the surface).
 *
 * **Scope (intentionally narrow):**
 *   - Method dispatch (GET/POST/PUT/PATCH/DELETE).
 *   - Zod validation for `query` (from URL.searchParams), `body` (from
 *     request.json() OR request.text()), `params` (consumer-supplied OR
 *     parsed from path).
 *   - Handler invocation.
 *   - Result → JSON Response (200 default, 204 for void return).
 *   - Error → envelope-shaped JSON Response (400 for validation, 500 for
 *     handler throws) per G5 boundary translation (serverErrorToEnvelope).
 *
 * **NOT included (deferred to T5a.2 Phase B-G):**
 *   - Plugin runner integration (onRequest/preHandler/onResponse hooks).
 *   - CSRF / CORS / security headers / rate limiting / cookies / auth.
 *   - Middleware chain. SSR rendering. WebSocket upgrade. File upload.
 *   - File-system routing scan; consumer provides the route module
 *     explicitly (Web Request entry doesn't yet know about scan results).
 *
 * The narrow scope makes this a viable Phase A landing zone — turns the
 * 7 T1.2 RED tests GREEN without prematurely refactoring the full
 * IncomingMessage→Request boundary across server/http/ files.
 */
import type { z } from 'zod'

import { envelopeCodeToStatus } from '../core/contracts/envelope-code-to-status.js'
import type { TheoErrorEnvelope } from '../core/contracts/error-envelope.js'
import { serverErrorToEnvelope } from '../core/contracts/server-error-to-envelope.js'
import { TheoError } from '../core/contracts/theo-error.js'

import { isZodLike } from './http/execute-stages.js'
import { validateRouteInput } from './http/validate-route-input.js'
import { runWebMiddleware, type WebMiddleware } from './http/web-middleware-runner.js'
import type {
  WebOnErrorHook,
  WebOnRequestHook,
  WebOnResponseHook,
  WebPluginContext,
  WebPluginErrorContext,
  WebPreHandlerHook,
} from './plugin-types.js'
import { validateCsrfRequest } from './security/csrf.js'

export type { WebMiddleware }

/**
 * Minimal structural type for a `defineRoute` config. Mirrors
 * `core/contracts/route-config.ts` shape but only the fields this entry
 * point needs at runtime (Zod schemas + handler). Kept structural to
 * avoid a hard dep on the full RouteConfig generic chain.
 */
interface WebRouteHandlerConfig {
  query?: z.ZodType
  body?: z.ZodType
  params?: z.ZodType
  /** Optional Zod schema validating a plain-object handler return (D1/D2). */
  response?: z.ZodType
  /** Honored for plain-object returns to match the Node runner (D3). */
  status?: number
  handler: (ctx: {
    query: unknown
    body: unknown
    params: unknown
    request: Request
    /** Mutable per-request context populated by the Web middleware chain (T3.2). */
    context: Record<string, unknown>
  }) => unknown
}

/**
 * The route module exported by a `server/routes/*.ts` file (after T2.6 G6
 * router lockdown). Method-named exports map to `defineRoute` results.
 */
type WebRouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', unknown>>

/**
 * Coerce URL.searchParams into a plain `{ key: value }` object so Zod
 * `z.object({...})` schemas work without per-route adapters. Repeated keys
 * become arrays (most browsers serialize multi-select that way).
 */
function searchParamsToObject(params: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of params.entries()) {
    if (!Object.hasOwn(out, key)) {
      out[key] = value
      continue
    }
    const existing = out[key]
    if (Array.isArray(existing)) {
      existing.push(value)
    } else {
      out[key] = [existing, value]
    }
  }
  return out
}

/**
 * Parse request body based on Content-Type. JSON is the canonical path;
 * empty body returns `undefined` (the handler treats as "no body").
 *
 * **Inline-only mode (default):** handles `application/json` and `text/*`.
 * Other content-types return `undefined`. Multipart/form-data requires
 * the opt-in `bodyParser: 'full'` mode (T5a.2 Phase E).
 */
async function parseBodyInline(request: Request): Promise<unknown> {
  // GET/HEAD have no body by spec; even if the consumer sets one, ignore it
  // (matches Web Request semantics — `body` is null for GET/HEAD anyway).
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const text = await request.text()
    if (text.length === 0) return undefined
    try {
      return JSON.parse(text)
    } catch {
      // Malformed JSON — return undefined; Zod schema (if any) will fail with
      // a more useful "required" message than a raw SyntaxError.
      return undefined
    }
  }
  // text/plain or no body: return raw text or undefined
  if (contentType.startsWith('text/')) {
    const text = await request.text()
    return text.length === 0 ? undefined : text
  }
  return undefined
}

/**
 * T5a.2 Phase E — "full" body parser delegating to `parseWebRequestBody`.
 * Returns a `ParsedWebBody` (`{ json?, fields, files }`) for JSON OR
 * multipart, or `undefined` when the body is empty / unparseable.
 *
 * Handler downstream pattern:
 *   `body?.json` (JSON requests)
 *   `body?.fields` + `body?.files` (multipart upload requests)
 *
 * Limits enforced by parseWebRequestBody:
 *   - declared Content-Length cap (default 10MB × maxFiles + 1MB margin)
 *   - per-file size cap (default 10MB)
 *   - max files (default 10)
 */
async function parseBodyFull(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const { parseWebRequestBody } = await import('./body-parser-web.js')
  try {
    const parsed = await parseWebRequestBody(request)
    // If nothing parsed (empty body OR unhandled content-type), return undefined
    // so Zod schemas treat it as missing — same semantics as inline parser.
    if (
      parsed.json === undefined &&
      Object.keys(parsed.fields).length === 0 &&
      parsed.files.length === 0
    ) {
      return undefined
    }
    return parsed
  } catch {
    return undefined
  }
}

/**
 * Build an envelope-shaped 400 Response for a Zod validation failure. Uses
 * the canonical `TheoErrorEnvelope` shape per G5 D3 (boundary translation).
 */
function validationErrorResponse(zodError: z.ZodError, field: string): Response {
  const envelope: TheoErrorEnvelope = {
    code: 'BAD_REQUEST',
    message: `Validation failed: ${field}`,
    ext: {
      fields: zodError.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  }
  return new Response(JSON.stringify(envelope), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Run a `defineRoute` config against a parsed Web Request. Returns the raw
 * handler result; serialization to Response happens in the caller.
 *
 * Throws if Zod validation fails (caller catches and emits 400).
 */
async function runHandler(
  config: WebRouteHandlerConfig,
  request: Request,
  bodyParser: 'inline' | 'full' = 'inline',
  paramsInput: Record<string, string> = {},
  context: Record<string, unknown> = {},
): Promise<{ ok: true; result: unknown } | { ok: false; response: Response }> {
  const url = new URL(request.url)
  const queryRaw = searchParamsToObject(url.searchParams)
  const bodyRaw =
    bodyParser === 'full' ? await parseBodyFull(request) : await parseBodyInline(request)
  // T3.1 — route params resolved upstream (matchRoute) and threaded via
  // opts.params. Defaults to `{}` so callers that don't supply params keep the
  // prior behavior (a route declaring config.params then fails validation).
  const paramsRaw = paramsInput

  // M33 — validate the three input channels via the SINGLE shared pipeline (`validateRouteInput`),
  // the same one the in-process caller (`callProcedure`) uses. The HTTP path maps a failure to a
  // 400 Response; the in-process path throws. One pipeline, no drift.
  const validated = validateRouteInput(config, {
    query: queryRaw,
    body: bodyRaw,
    params: paramsRaw,
  })
  if (!validated.ok) {
    return { ok: false, response: validationErrorResponse(validated.error, validated.channel) }
  }
  const { query, body, params } = validated

  const result = await config.handler({ query, body, params, request, context })
  return validateResponseOutput(config.response, result) ?? { ok: true, result }
}

/**
 * Validate a plain-object handler return against `config.response` (D1/D2). A
 * mismatch is a SERVER fault → 500 envelope. `Response`-instance returns and
 * `undefined`/`null` (→ 204) skip validation — parity with the Node runner,
 * which validates only in its plain-object branch. Returns `undefined` when no
 * validation applies (caller forwards the raw result).
 */
function validateResponseOutput(
  response: unknown,
  result: unknown,
): { ok: true; result: unknown } | { ok: false; response: Response } | undefined {
  const validatable = result !== undefined && result !== null && !(result instanceof Response)
  if (!validatable || !isZodLike(response)) return undefined
  const parsed = response.safeParse(result)
  if (parsed.success) return { ok: true, result: parsed.data }
  const err = new TheoError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'response validation failed',
    ext: { issues: parsed.error?.issues },
  })
  return { ok: false, response: handlerErrorResponse(err) }
}

/**
 * Serialize a handler return value into a native Web `Response`. Conventions:
 *   - `undefined` / `void` → 204 No Content.
 *   - existing `Response` instance → pass through unchanged.
 *   - everything else → 200 JSON.
 */
function toResponse(result: unknown, status?: number): Response {
  if (result === undefined) {
    return new Response(null, { status: 204 })
  }
  if (result instanceof Response) {
    return result
  }
  return new Response(JSON.stringify(result), {
    status: status ?? 200,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Build an envelope-shaped 500 Response when a handler throws. Uses
 * `serverErrorToEnvelope` so existing ad-hoc Error classes (AuthRequired,
 * FileTooLarge, etc.) get mapped to canonical envelope codes.
 */
function handlerErrorResponse(err: unknown): Response {
  const envelope = serverErrorToEnvelope(err)
  // Map envelope code → HTTP status when possible. Default to 500 for
  // INTERNAL_SERVER_ERROR. Other codes map per HTTP semantics.
  const status = envelopeCodeToStatus(envelope.code)
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// envelopeCodeToStatus extracted to core/contracts/envelope-code-to-status.ts
// (architecture-remediation T1.2, 2026-06-12)

/**
 * Optional behavior knobs for `executeWebRequest`. Each knob defaults to
 * the safe "no-op" stance so existing Phase A consumers (T1.2 fixture
 * tests) keep working unchanged.
 *
 * **`csrfMode`** (T5a.2 Phase B slice 1/6) — when set to `'strict'`, the
 * Web-Standards request gate runs `validateCsrfRequest` BEFORE method
 * dispatch on state-changing methods (POST/PUT/PATCH/DELETE) and emits a
 * `403 FORBIDDEN` envelope when the check fails. Default: `'off'` (no
 * CSRF enforcement) to preserve Phase A backward compat. Production
 * consumers SHOULD pass `csrfMode: 'strict'`.
 *
 * Per the T5a.2 plan v1.0 § Phase B header-only leaves: csrf.ts is the
 * first leaf to be migrated (slice 1/6); 5 more sibling leaves remain
 * (csrf-multi-header, csrf-readiness-endpoint, csp-report, cors, cookies).
 */
export interface ExecuteWebRequestOptions {
  csrfMode?: 'off' | 'strict'
  /**
   * T3.1 — route params resolved upstream by `matchRoute` (e.g. `{ id: '42' }`
   * for `/users/:id`). Threaded to the handler's `params` input and validated
   * against `config.params` (Zod) when declared. Defaults to `{}` — callers
   * that don't supply params keep the prior behavior (additive, backward-compat).
   */
  params?: Record<string, string>
  /**
   * T3.2 — Web-Standards middleware chain. Runs in order AFTER the CSRF gate
   * (EC-3) and BEFORE the handler. A middleware returning a `Response`
   * short-circuits (handler not reached); mutating `context` passes data to
   * the handler. Omitted → zero overhead (handler runs directly).
   */
  middleware?: readonly WebMiddleware[]
  /**
   * T5a.2 Phase E — body parser strategy.
   *
   * - `'inline'` (default): handle `application/json` + `text/*` only.
   *   Returns the parsed value (object for JSON, string for text). Other
   *   content-types (e.g., multipart) return `undefined`.
   * - `'full'`: delegate to `parseWebRequestBody` for multipart support
   *   + per-file size caps + max-files cap (Web Standards `request.formData()`
   *   under the hood). Returns a `ParsedWebBody` object:
   *   `{ json?, fields, files }`. Multipart consumers MUST opt into this
   *   mode; JSON-only routes pay zero cost staying on `'inline'`.
   */
  bodyParser?: 'inline' | 'full'
  /**
   * T5a.2 Phase G slice 1/N — plugin lifecycle hooks.
   *
   * Adapters (Node, CF Workers, Bun, Deno) wire `WebPluginContext`-shaped
   * hooks at the executeWebRequest lifecycle. Lifecycle order mirrors the
   * Fastify / Hono convention:
   *
   *   1. CSRF check (when opts.csrfMode === 'strict')
   *   2. onRequest — earliest, before body parsing. Plugins can short-circuit
   *      by setting `ctx.response` (handler skipped; subsequent hooks see
   *      the short-circuit response).
   *   3. body parse (inline OR full per opts.bodyParser)
   *   4. preHandler — after body parsed, before handler runs. Same
   *      short-circuit semantic.
   *   5. handler invocation
   *   6. onResponse — after handler returns OR after a hook short-circuit.
   *      `ctx.response` is populated.
   *   7. onError — fires if any of (handler, onRequest, preHandler) throws.
   *      `ctx.response` is the envelope-shaped error response built via
   *      serverErrorToEnvelope.
   *
   * `responseHeaders` is shared across hooks; the final Response merges
   * them with the handler's Response headers (handler headers win on
   * conflict; hook headers add new ones). Decorations made via
   * `ctx.ctx[key] = value` persist across hooks (request-scoped state).
   *
   * `hooks: undefined` (default) → no plugin lifecycle, Phase A behavior
   * preserved. Production consumers wire via the WebPluginRunner facade
   * (a future Phase G slice).
   */
  hooks?: {
    onRequest?: readonly WebOnRequestHook[]
    preHandler?: readonly WebPreHandlerHook[]
    onResponse?: readonly WebOnResponseHook[]
    onError?: readonly WebOnErrorHook[]
  }
  /**
   * Stable request identifier propagated into hook contexts. Adapters
   * resolve via traceparent / x-request-id / generated UUID (see
   * `extractTraceIdFromRequest` from Phase C slice 1/2). Default:
   * `globalThis.crypto.randomUUID()`.
   */
  requestId?: string
}

/**
 * Methods that require CSRF enforcement when `csrfMode: 'strict'`. GET
 * and HEAD are read-only per HTTP semantics and bypass CSRF (the threat
 * model is state-changing requests forged via cross-origin POSTs); OPTIONS
 * is the CORS preflight and also bypasses.
 */
export const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Web-Standards entry-point for executing a route module against a native
 * Web `Request`. Returns a native Web `Response`.
 *
 * Method dispatch: looks up the handler keyed by `request.method`
 * (uppercase). Returns 405 if the method isn't exported.
 *
 * @example
 * import * as users from './app/users/route.js'
 * import { executeWebRequest } from 'theokit/server'
 *
 * const response = await executeWebRequest(
 *   new Request('http://localhost/api/users', { method: 'GET' }),
 *   users,
 *   { csrfMode: 'strict' },
 * )
 */
/**
 * T5a.2 Phase G slice 1/N — merge hook-mutated response headers into the
 * handler's Response. Handler-set headers win on conflict (the handler
 * has the most context about its own response); hook headers add new
 * entries (e.g., CORS, Set-Cookie). Returns a new Response with the
 * merged headers + same body/status as the source.
 *
 * Set-Cookie is multi-value at the Web spec layer — `getSetCookie()` is
 * the only way to retrieve multiple values. The merge appends ALL hook-
 * set Set-Cookie values to the response (multiple Set-Cookie headers is
 * spec-correct and how browsers expect cookie issuance).
 */
function mergeHookHeaders(response: Response, hookHeaders: Headers): Response {
  if ([...hookHeaders].length === 0) return response
  const merged = new Headers(response.headers)
  for (const [k, v] of hookHeaders.entries()) {
    if (k.toLowerCase() === 'set-cookie') continue // handled separately
    if (!merged.has(k)) merged.set(k, v)
  }
  for (const sc of hookHeaders.getSetCookie()) {
    merged.append('Set-Cookie', sc)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  })
}

/** Build a 405 envelope Response. */
function methodNotAllowedResponse(method: string): Response {
  const envelope: TheoErrorEnvelope = {
    code: 'METHOD_NOT_ALLOWED',
    message: `Method ${method} not allowed`,
  }
  return new Response(JSON.stringify(envelope), {
    status: 405,
    headers: { 'content-type': 'application/json' },
  })
}

/** Build a 403 CSRF envelope Response. */
function csrfFailedResponse(reason: string): Response {
  const envelope: TheoErrorEnvelope = {
    code: 'FORBIDDEN',
    message: `CSRF check failed: ${reason}`,
  }
  return new Response(JSON.stringify(envelope), {
    status: 403,
    headers: { 'content-type': 'application/json' },
  })
}

export async function executeWebRequest(
  request: Request,
  routeModule: WebRouteModule,
  opts: ExecuteWebRequestOptions = {},
): Promise<Response> {
  const method = request.method.toUpperCase() as keyof WebRouteModule
  const config = routeModule[method] as WebRouteHandlerConfig | undefined

  // T5a.2 Phase G slice 1/N — plugin lifecycle hooks.
  // When opts.hooks is undefined, skip the entire hook orchestration to
  // preserve Phase A backward compat (zero overhead for consumers not
  // wiring hooks). In the no-hooks branch, dispatch + CSRF gates run
  // FIRST and 405 short-circuits before the handler runs.
  if (opts.hooks === undefined) {
    if (config === undefined || typeof config.handler !== 'function') {
      return methodNotAllowedResponse(method)
    }
    if (opts.csrfMode === 'strict' && CSRF_PROTECTED_METHODS.has(method)) {
      const csrfCheck = validateCsrfRequest(request)
      if (!csrfCheck.valid) return csrfFailedResponse(csrfCheck.reason)
    }
    try {
      // T3.2 — middleware runs AFTER the CSRF gate (EC-3), BEFORE the handler.
      const context: Record<string, unknown> = {}
      if (opts.middleware?.length) {
        const shortCircuit = await runWebMiddleware(request, opts.middleware, context)
        if (shortCircuit) return shortCircuit
      }
      const outcome = await runHandler(
        config,
        request,
        opts.bodyParser ?? 'inline',
        opts.params ?? {},
        context,
      )
      if (!outcome.ok) return outcome.response
      return toResponse(outcome.result, config.status)
    } catch (err) {
      return handlerErrorResponse(err)
    }
  }

  // With hooks: onRequest hooks run BEFORE method dispatch (Hono /
  // Fastify convention) so CORS preflight plugins can intercept OPTIONS
  // requests regardless of route shape. If no hook short-circuits, then
  // 405 fires when the method isn't exported by the route module.
  return runWithHooks(request, config, opts, opts.hooks)
}

/**
 * Run the request through the full plugin lifecycle. Extracted to keep
 * `executeWebRequest`'s cyclomatic + cognitive complexity under the lint
 * caps (15/20). Pure side-effect surface — same return type as the
 * no-hooks branch.
 */
/**
 * Pre-handler pipeline: onRequest hooks → CSRF gate → preHandler hooks →
 * method dispatch + handler. Mutates `hookCtx.response` on short-circuit
 * OR on handler completion. Extracted from `runWithHooks` to keep the
 * latter's cyclomatic complexity under the lint cap (15).
 */
async function runPreHandlerPipeline(
  hookCtx: WebPluginContext,
  request: Request,
  config: WebRouteHandlerConfig | undefined,
  opts: ExecuteWebRequestOptions,
  hooks: NonNullable<ExecuteWebRequestOptions['hooks']>,
): Promise<void> {
  const method = request.method.toUpperCase()
  const runList = async (list: readonly WebOnRequestHook[]): Promise<void> => {
    for (const hook of list) {
      if (hookCtx.response !== undefined) return
      await hook(hookCtx)
    }
  }
  // onRequest first (CORS preflight + auth gate intercept before dispatch).
  if (hooks.onRequest) await runList(hooks.onRequest)
  // CSRF gate AFTER onRequest (auth-short-circuit avoids CSRF cost) but
  // BEFORE the handler.
  if (
    hookCtx.response === undefined &&
    opts.csrfMode === 'strict' &&
    CSRF_PROTECTED_METHODS.has(method)
  ) {
    const csrfCheck = validateCsrfRequest(request)
    if (!csrfCheck.valid) hookCtx.response = csrfFailedResponse(csrfCheck.reason)
  }
  if (hookCtx.response === undefined && hooks.preHandler) {
    await runList(hooks.preHandler)
  }
  if (hookCtx.response === undefined) {
    await runHandlerStage(hookCtx, request, config, opts, method)
  }
}

/**
 * T3.2 — the middleware + handler stage of the hook pipeline. Extracted from
 * `runPreHandlerPipeline` to keep its cyclomatic complexity under the lint cap.
 * Order: 405 check → user middleware (after CSRF + preHandler) → handler.
 */
async function runHandlerStage(
  hookCtx: WebPluginContext,
  request: Request,
  config: WebRouteHandlerConfig | undefined,
  opts: ExecuteWebRequestOptions,
  method: string,
): Promise<void> {
  // 405 if route module doesn't export this method.
  if (config === undefined || typeof config.handler !== 'function') {
    hookCtx.response = methodNotAllowedResponse(method)
    return
  }
  // hookCtx.ctx is the shared per-request context the middleware mutates.
  if (opts.middleware?.length) {
    const shortCircuit = await runWebMiddleware(request, opts.middleware, hookCtx.ctx)
    if (shortCircuit) {
      hookCtx.response = shortCircuit
      return
    }
  }
  const outcome = await runHandler(
    config,
    request,
    opts.bodyParser ?? 'inline',
    opts.params ?? {},
    hookCtx.ctx,
  )
  hookCtx.response = outcome.ok ? toResponse(outcome.result, config.status) : outcome.response
}

async function runWithHooks(
  request: Request,
  config: WebRouteHandlerConfig | undefined,
  opts: ExecuteWebRequestOptions,
  hooks: NonNullable<ExecuteWebRequestOptions['hooks']>,
): Promise<Response> {
  const hookCtx: WebPluginContext = {
    request,
    responseHeaders: new Headers(),
    ctx: {},
    requestId: opts.requestId ?? globalThis.crypto.randomUUID(),
  }
  try {
    await runPreHandlerPipeline(hookCtx, request, config, opts, hooks)
    if (hooks.onResponse) {
      for (const hook of hooks.onResponse) {
        await hook(hookCtx)
      }
    }
    // runPreHandlerPipeline guarantees hookCtx.response is set (via either
    // a hook short-circuit OR handler outcome OR 405). TS doesn't infer this
    // post-mutation; the assertion is safe per the function's contract.
    const finalResponse =
      hookCtx.response ??
      new Response(
        JSON.stringify({ code: 'INTERNAL_SERVER_ERROR', message: 'No response built' }),
        {
          status: 500,
          headers: { 'content-type': 'application/json' },
        },
      )
    return mergeHookHeaders(finalResponse, hookCtx.responseHeaders)
  } catch (err) {
    return runErrorHooks(err, hookCtx, hooks.onError)
  }
}

/**
 * Run onError hooks against an envelope-shaped error response. EC-9 —
 * each hook throw is swallowed to avoid error-in-error-handler recursion.
 * Returns the merged final Response.
 */
async function runErrorHooks(
  err: unknown,
  hookCtx: WebPluginContext,
  onError: readonly WebOnErrorHook[] | undefined,
): Promise<Response> {
  const errorResponse = handlerErrorResponse(err)
  if (onError !== undefined) {
    const errorCtx: WebPluginErrorContext = {
      ...hookCtx,
      response: errorResponse,
      error: err,
    }
    for (const hook of onError) {
      try {
        await hook(errorCtx)
      } catch {
        // EC-9: error in error handler — swallow to avoid recursion.
      }
    }
  }
  return mergeHookHeaders(errorResponse, hookCtx.responseHeaders)
}
