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
 */
async function parseBody(request: Request): Promise<unknown> {
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
): Promise<{ ok: true; result: unknown } | { ok: false; response: Response }> {
  const url = new URL(request.url)
  const queryRaw = searchParamsToObject(url.searchParams)
  const bodyRaw = await parseBody(request)
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
 * )
 */
export async function executeWebRequest(
  request: Request,
  routeModule: WebRouteModule,
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
  try {
    const outcome = await runHandler(config, request)
    if (!outcome.ok) return outcome.response
    return toResponse(outcome.result)
  } catch (err) {
    return handlerErrorResponse(err)
  }
}
