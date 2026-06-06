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

import type { TheoErrorEnvelope } from '../core/contracts/error-envelope.js'
import { serverErrorToEnvelope } from '../core/contracts/server-error-to-envelope.js'

import type {
  WebOnErrorHook,
  WebOnRequestHook,
  WebOnResponseHook,
  WebPluginContext,
  WebPluginErrorContext,
  WebPreHandlerHook,
} from './plugin-types.js'
import { validateCsrfRequest } from './security/csrf.js'

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
  handler: (ctx: { query: unknown; body: unknown; params: unknown; request: Request }) => unknown
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
): Promise<{ ok: true; result: unknown } | { ok: false; response: Response }> {
  const url = new URL(request.url)
  const queryRaw = searchParamsToObject(url.searchParams)
  const bodyRaw =
    bodyParser === 'full' ? await parseBodyFull(request) : await parseBodyInline(request)
  // No params support yet at the Web-Request entry-point (no router scan in
  // scope per Phase A). Pass `{}` as the params input; Zod schemas requiring
  // params will fail validation.
  const paramsRaw = {}

  // Validate input via Zod schemas when present.
  let query: unknown = queryRaw
  if (config.query !== undefined) {
    const parsed = config.query.safeParse(queryRaw)
    if (!parsed.success)
      return { ok: false, response: validationErrorResponse(parsed.error, 'query') }
    query = parsed.data
  }
  let body: unknown = bodyRaw
  if (config.body !== undefined) {
    const parsed = config.body.safeParse(bodyRaw)
    if (!parsed.success)
      return { ok: false, response: validationErrorResponse(parsed.error, 'body') }
    body = parsed.data
  }
  let params: unknown = paramsRaw
  if (config.params !== undefined) {
    const parsed = config.params.safeParse(paramsRaw)
    if (!parsed.success)
      return { ok: false, response: validationErrorResponse(parsed.error, 'params') }
    params = parsed.data
  }

  const result = await config.handler({ query, body, params, request })
  return { ok: true, result }
}

/**
 * Serialize a handler return value into a native Web `Response`. Conventions:
 *   - `undefined` / `void` → 204 No Content.
 *   - existing `Response` instance → pass through unchanged.
 *   - everything else → 200 JSON.
 */
function toResponse(result: unknown): Response {
  if (result === undefined) {
    return new Response(null, { status: 204 })
  }
  if (result instanceof Response) {
    return result
  }
  return new Response(JSON.stringify(result), {
    status: 200,
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

function envelopeCodeToStatus(code: string): number {
  // Inline subset of common HTTP-code mappings. Full list lives in
  // core/contracts/error-envelope.ts § TheoErrorCode.
  switch (code) {
    case 'BAD_REQUEST':
      return 400
    case 'UNAUTHORIZED':
      return 401
    case 'FORBIDDEN':
      return 403
    case 'NOT_FOUND':
      return 404
    case 'METHOD_NOT_ALLOWED':
      return 405
    case 'PAYLOAD_TOO_LARGE':
      return 413
    case 'UNPROCESSABLE_ENTITY':
      return 422
    case 'TOO_MANY_REQUESTS':
    case 'RATE_LIMITED':
      return 429
    case 'BAD_GATEWAY':
      return 502
    case 'SERVICE_UNAVAILABLE':
      return 503
    case 'GATEWAY_TIMEOUT':
      return 504
    case 'INTERNAL_SERVER_ERROR':
    default:
      return 500
  }
}

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
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

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

export async function executeWebRequest(
  request: Request,
  routeModule: WebRouteModule,
  opts: ExecuteWebRequestOptions = {},
): Promise<Response> {
  const method = request.method.toUpperCase() as keyof WebRouteModule
  const config = routeModule[method] as WebRouteHandlerConfig | undefined
  if (config === undefined || typeof config.handler !== 'function') {
    const envelope: TheoErrorEnvelope = {
      code: 'METHOD_NOT_ALLOWED',
      message: `Method ${method} not allowed`,
    }
    return new Response(JSON.stringify(envelope), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }
  // T5a.2 Phase B slice 1/6 — CSRF enforcement (opt-in via opts.csrfMode).
  // Only state-changing methods (POST/PUT/PATCH/DELETE) get checked;
  // GET/HEAD/OPTIONS bypass per HTTP threat-model semantics.
  if (opts.csrfMode === 'strict' && CSRF_PROTECTED_METHODS.has(method)) {
    const csrfCheck = validateCsrfRequest(request)
    if (!csrfCheck.valid) {
      const envelope: TheoErrorEnvelope = {
        code: 'FORBIDDEN',
        message: `CSRF check failed: ${csrfCheck.reason}`,
      }
      return new Response(JSON.stringify(envelope), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    }
  }

  // T5a.2 Phase G slice 1/N — plugin lifecycle hooks.
  // When opts.hooks is undefined, skip the entire hook orchestration to
  // preserve Phase A backward compat (zero overhead for consumers not
  // wiring hooks).
  if (opts.hooks === undefined) {
    try {
      const outcome = await runHandler(config, request, opts.bodyParser ?? 'inline')
      if (!outcome.ok) return outcome.response
      return toResponse(outcome.result)
    } catch (err) {
      return handlerErrorResponse(err)
    }
  }

  return runWithHooks(request, config, opts, opts.hooks)
}

/**
 * Run the request through the full plugin lifecycle. Extracted to keep
 * `executeWebRequest`'s cyclomatic + cognitive complexity under the lint
 * caps (15/20). Pure side-effect surface — same return type as the
 * no-hooks branch.
 */
async function runWithHooks(
  request: Request,
  config: WebRouteHandlerConfig,
  opts: ExecuteWebRequestOptions,
  hooks: NonNullable<ExecuteWebRequestOptions['hooks']>,
): Promise<Response> {
  // Single WebPluginContext shared across the lifecycle; mutations to
  // ctx + responseHeaders persist for downstream hooks.
  const hookCtx: WebPluginContext = {
    request,
    responseHeaders: new Headers(),
    ctx: {},
    requestId: opts.requestId ?? globalThis.crypto.randomUUID(),
  }
  // Short-circuit detector: a hook may set ctx.response to bypass the
  // remaining pre-handler lifecycle.
  const runPreHookList = async (list: readonly WebOnRequestHook[]): Promise<void> => {
    for (const hook of list) {
      if (hookCtx.response !== undefined) return
      await hook(hookCtx)
    }
  }
  try {
    if (hooks.onRequest) await runPreHookList(hooks.onRequest)
    if (hookCtx.response === undefined && hooks.preHandler) {
      await runPreHookList(hooks.preHandler)
    }
    if (hookCtx.response === undefined) {
      const outcome = await runHandler(config, request, opts.bodyParser ?? 'inline')
      hookCtx.response = outcome.ok ? toResponse(outcome.result) : outcome.response
    }
    if (hooks.onResponse) {
      for (const hook of hooks.onResponse) {
        await hook(hookCtx)
      }
    }
    return mergeHookHeaders(hookCtx.response, hookCtx.responseHeaders)
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
