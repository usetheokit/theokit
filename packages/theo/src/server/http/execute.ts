import type { ServerResponse } from 'node:http'

import { isAuthRequiredError } from '../../core/contracts/auth-error-guard.js'
import {
  evaluateRoutePolicy,
  subjectFromContext,
  type RoutePolicy,
} from '../../core/contracts/route-policy.js'
import { TheoError } from '../../core/contracts/theo-error.js'
import { DuplicateContextKeyError } from '../jobs/duplicate-context-key-error.js'
import { createOutbox } from '../jobs/outbox.js'
import { createOutboxDispatcher, createQueueClient } from '../jobs/queue-client.js'
import { warnOnce } from '../observability/logger.js'
import type { PluginContext } from '../plugin-types.js'
import type { PluginRunner } from '../plugins/plugin-runner.js'
import { dispatchCsrfWarn } from '../security/csrf-warn-dispatch.js'
import { enforceCsrf } from '../security/csrf.js'

import type { ExecuteRouteContext } from './execute-context.js'
import { isZodLike, parseQueryAndBody, runZodValidation } from './execute-stages.js'
import { runMiddlewareAndContext } from './middleware-runner.js'
import { incomingMessageToHandlerRequest } from './node-request.js'
import { sendError, sendJson } from './send-response.js'

// CSRF policy applies to every state-mutating method, including DELETE.
const CSRF_PROTECTED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// T5.1: sendJson + sendError + SendErrorOptions moved to send-response.ts
// to break the execute ↔ execute-stages cycle. Re-exported below for
// backward compat.
export { sendJson, sendError } from './send-response.js'
export type { SendErrorOptions, SendErrorInput } from './send-response.js'
// T3.1 — ExecuteRouteContext (ADR-0016)
export type { ExecuteRouteContext } from './execute-context.js'

interface StreamPipeCtx {
  buildPluginCtx: (ctxObj: Record<string, unknown>) => PluginContext
  ctx: Record<string, unknown>
  method: string
  pluginRunner: PluginRunner | undefined
  requestId: string | undefined
  routePath: string
}

/**
 * Honour Node backpressure: `res.write()` answered `false`, so wait until the
 * consumer has made room before reading the next chunk. Without this the
 * producer outruns a slow consumer and the queued bytes grow unbounded —
 * which is how a streaming fix trades one memory defect for another.
 *
 * Deliberately narrow. Only an exact `false` waits (a stub `res.write` that
 * returns `undefined` must not park the pipeline), only a `res` that carries
 * an event emitter waits, and `close`/`error` release the wait as well as
 * `drain`, so a disconnected client cannot hang the handler.
 */
async function waitForDrain(res: ServerResponse): Promise<void> {
  if (typeof res.once !== 'function') return
  await new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      if (typeof res.off === 'function') {
        res.off('drain', finish)
        res.off('close', finish)
        res.off('error', finish)
      }
      resolve()
    }
    res.once('drain', finish)
    res.once('close', finish)
    res.once('error', finish)
  })
}

/**
 * Pipe a Web Standard ReadableStream into a Node ServerResponse. Stream
 * errors after headers are sent cannot change the response status, but
 * MUST be logged + reported (CR-004 fix). Extracted from `executeRoute`
 * to keep that function's nesting under the max-depth ceiling.
 *
 * @returns whether the body was delivered IN FULL. `false` means the response has been destroyed
 * and the caller must not end it — a short body closed cleanly is an abnormal ending reported as a
 * normal one (`docs/adr/0002-*`, usetheokit/theokit#391). Logging the failure and then calling
 * `res.end()` anyway was exactly that: status 200, chunked encoding terminated correctly, and a
 * reader that sees `done: true` on a half-answer.
 */
async function pipeWebStreamToResponse(
  body: ReadableStream<Uint8Array>,
  res: ServerResponse,
  ctx: StreamPipeCtx,
): Promise<boolean> {
  const reader = body.getReader()
  try {
    let done = false
    while (!done) {
      const chunk = await reader.read()
      done = chunk.done
      // The comparison is against `false` on purpose. The type says `boolean`, but stub `res`
      // objects across the suite return `undefined`, and `!x` would park the pipeline on a drain
      // those stubs never emit.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-boolean-literal-compare -- see above
      if (!done && res.write(chunk.value) === false) await waitForDrain(res)
    }
  } catch (streamErr) {
    warnOnce(`stream-error:${ctx.routePath}:${ctx.method}`, {
      event: 'stream.error',
      requestId: ctx.requestId ?? 'no-id',
      route: ctx.routePath,
      method: ctx.method,
      message: streamErr instanceof Error ? streamErr.message : String(streamErr),
    })
    if (ctx.pluginRunner) {
      try {
        await ctx.pluginRunner.runOnError(ctx.buildPluginCtx(ctx.ctx), streamErr)
      } catch {
        // onError plugins must never destabilize the response close.
      }
    }
    // The one signal left once the head has gone out. On a real `ServerResponse` this destroys the
    // socket, aborting the chunked encoding; on the Web shim it errors the body stream the
    // `Response` already carries, so a consumer's `read()` rejects instead of reporting `done`.
    // Both are what the six adapters' own generated pumps already do, citing the same ADR.
    res.destroy(streamErr instanceof Error ? streamErr : new Error(String(streamErr)))
    return false
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* lock may already be released by abort */
    }
  }
  return true
}

// sendError moved to send-response.ts (T5.1) — re-exported above.

// CR-007/Knip cleanup: `parseBody` (legacy JSON-only parser) was exported
// but had no remaining consumers — the route pipeline uses
// `parseRequestBody` (multipart + JSON) directly. Removed to shrink the
// public surface and remove the duplicated METHODS_WITH_BODY constant.

// eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity, complexity -- `executeRoute` is the framework's central request pipeline; its body length + branch density mirror the actual request lifecycle. T3.1 / ADR-0016 retired `max-params` (context object replaces 12 positional args). Branch complexity remains intentional: the request lifecycle has irreducible state machine arms (CSRF stage → Zod validate → middleware → handler → stream/JSON response). Remaining helpers `runCsrfStage`, `parseQueryAndBody`, `runHandlerStage`, etc. were extracted in earlier waves.
export async function executeRoute(ctx: ExecuteRouteContext): Promise<void> {
  // T3.1 — destructure the context with defaults applied
  const {
    route,
    method,
    params,
    req,
    res,
    loadModule,
    serverDir,
    requestId,
    pluginRunner,
    transformer,
    csrfMode = 'strict',
    disallowed,
    jobBackend,
  } = ctx
  // ADR-0028 R3a / #117 / #119 — handlers AND plugin hooks see a Web `Request` in every runtime. Built
  // once from the Node `IncomingMessage` (headers/URL/method; body stays on the parsed `ctx.body`) and
  // shared by every buildPluginCtx call + the handler invocation below.
  const webRequest = incomingMessageToHandlerRequest(req)
  const buildPluginCtx = (ctxObj: Record<string, unknown>): PluginContext => ({
    request: webRequest,
    response: res,
    ctx: ctxObj,
    requestId: requestId ?? 'no-id',
  })

  // T1.2 — emit x-theo-transformer header when a non-default transformer is in use.
  // 'json' is treated as default (no header); any named transformer emits.
  if (transformer && transformer.name !== 'json') {
    res.setHeader('x-theo-transformer', transformer.name)
  }

  try {
    // T4.2 — onRequest hook (runs before middleware)
    let ctx: Record<string, unknown> = {}
    if (pluginRunner) {
      pluginRunner.applyDecorations(ctx)
      const onReqResult = await pluginRunner.runOnRequest(buildPluginCtx(ctx))
      if (onReqResult.shortCircuited) return
    }

    // Run middleware + context pipeline
    if (serverDir) {
      const result = await runMiddlewareAndContext(req, res, loadModule, serverDir)
      if (result.aborted) return
      // MERGE, never replace. `runMiddlewareAndContext` builds its own fresh object, so assigning
      // it here discarded everything an `onRequest` hook had written — including the one thing the
      // policy is about to read. A plugin that authenticated the request was then not believed by
      // `evaluateRoutePolicy` three lines later, in every app with a `server/` directory (which is
      // every real app; the executor's own tests pass no `serverDir`, which is why it held).
      // Middleware wins on a key collision because it runs later — last writer, as before.
      // That the replace was a slip rather than a decision is visible without archaeology:
      // `action-execute.ts` — the sibling executor, same lifecycle, same question — already wrote
      // `Object.assign(p.ctx, result.ctx ?? {})`. Actions merged; routes replaced; nothing recorded
      // a reason for the difference, and only one of the two can be right.
      ctx = { ...ctx, ...((result.ctx ?? {}) as Record<string, unknown>) }
      // Re-apply decorations on top of middleware-produced ctx so plugin
      // decorations win when middleware did not set the same key.
      if (pluginRunner) pluginRunner.applyDecorations(ctx)
    }

    // T2.1 — wire ctx.queue + outbox lifecycle when jobBackend is configured.
    // EC-202: throw on collision instead of silent override.
    if (jobBackend) {
      if (ctx.queue !== undefined) {
        throw new DuplicateContextKeyError('queue', {
          reason:
            'A plugin or middleware already decorated ctx.queue; choose a different key OR remove jobs.backend from theo.config.ts.',
        })
      }
      const outbox = createOutbox()
      const queueClient = createQueueClient(jobBackend, outbox)
      ctx.queue = queueClient

      // Discard on abort or 4xx (handler throws cascade to 500 via catch
      // below, where statusCode is already >= 400).
      res.on('close', () => {
        if (!res.writableFinished) outbox.discard()
      })
      // Flush on commit, only when response indicates success.
      res.on('finish', () => {
        if (res.statusCode >= 400) {
          outbox.discard()
          return
        }
        void outbox.flush(createOutboxDispatcher(jobBackend))
      })
    }

    const mod = await loadModule(route.filePath)
    const routeConfig = mod[method]

    if (!routeConfig) {
      sendError(
        res,
        'METHOD_NOT_ALLOWED',
        `Method ${method} not allowed`,
        405,
        undefined,
        requestId,
      )
      return
    }

    const handler =
      typeof routeConfig === 'function'
        ? routeConfig
        : (routeConfig as Record<string, unknown>).handler
    if (typeof handler !== 'function') {
      sendError(res, 'INTERNAL_ERROR', 'Route handler is not a function', 500, undefined, requestId)
      return
    }

    // Phase 5 — CSRF enforcement (warn-first default; strict in 0.3.0).
    // Skips: safe methods (GET/HEAD/OPTIONS), per-route opt-out (`csrf: false`),
    // and bare function exports (legacy style — no opt-out hook available).
    const routeOptOut =
      typeof routeConfig === 'object' && (routeConfig as { csrf?: unknown }).csrf === false
    if (CSRF_PROTECTED_METHODS.has(method) && !routeOptOut) {
      const decision = enforceCsrf(
        req,
        csrfMode,
        {
          // T3.3 DRY — see security/csrf-warn-dispatch.ts
          warn: dispatchCsrfWarn,
          path: req.url,
        },
        disallowed,
      )
      if (!decision.allow) {
        sendError(
          res,
          'CSRF_INVALID',
          decision.reason ?? 'CSRF check failed',
          403,
          undefined,
          requestId,
        )
        return
      }
    }

    // T5.1 — extracted stages (parseQueryAndBody + runZodValidation).
    // Each stage either succeeds (returns parsed data) OR short-circuits
    // (sends the error response inline + returns ok:false).
    const rc = routeConfig as Record<string, unknown>

    const parseResult = await parseQueryAndBody(req, res, requestId)
    if (!parseResult.ok) return
    const { query, raw } = parseResult.data
    let { body } = parseResult.data

    const validationResult = runZodValidation(rc, res, requestId, { query, body, params })
    if (!validationResult.ok) return
    body = validationResult.data.body

    // T4.3 — preHandler hook (after Zod validation, before handler)
    if (pluginRunner) {
      const preResult = await pluginRunner.runPreHandler(buildPluginCtx(ctx))
      if (preResult.shortCircuited) return
    }

    // Execute handler. `handler` is structurally typed as `unknown` at
    // this point (came out of a duck-typed module). Cast through a narrow
    // type so the call is properly typed.
    type RouteHandlerCallable = (args: {
      query: Record<string, string>
      body: unknown
      params: Record<string, string>
      request: Request
      ctx: Record<string, unknown>
    }) => unknown
    const callableHandler = handler as RouteHandlerCallable

    // ADR 0001 — the same evaluator the Web executor and `callProcedure` call.
    // Placed immediately before the handler so any identity established upstream
    // (middleware, plugin hooks) is on `ctx` by the time the policy reads it.
    // Wiring only the two Web-shaped paths would have left production — this one —
    // unprotected while the parity test claimed otherwise, which is the
    // looks-protected failure mode ADR 0001 rejects by name.
    const accessDecision = await evaluateRoutePolicy((rc as { policy?: RoutePolicy }).policy, {
      subject: subjectFromContext(ctx),
      query,
      body,
      params,
    })
    if (!accessDecision.allowed) {
      sendError(
        res,
        'FORBIDDEN',
        `Access denied: ${accessDecision.reason}`,
        403,
        undefined,
        requestId,
      )
      return
    }
    // ADR-0028 R3a — handlers receive a Web `Request` in EVERY runtime (built once above, shared with
    // the plugin hooks). The Node path previously leaked the raw `IncomingMessage` here, so any
    // Web-standard use of `ctx.request` (e.g. `ctx.request.headers.get(...)`,
    // `createSessionManagerWeb.getSession(ctx.request)`) threw at runtime even though it type-checked
    // (`ctx.request` is declared `Request`). Body is exposed via `ctx.body`, so the request carries
    // headers/url/method only (the Node stream is already drained by `parseQueryAndBody`).
    // #445 — the handler's Request carries the body it arrived with. `webRequest` above is built
    // before the body is read and is shared with the plugin hooks, so it stays as it is; this is a
    // second Request over the same bytes, for the one caller that may read them. Without it any
    // framework API taking a `Request` — `handleChannelWebhook` among them — reads an empty stream
    // and reports a valid body as malformed.
    const handlerRequest =
      raw === undefined
        ? webRequest
        : new Request(webRequest.url, {
            method: webRequest.method,
            headers: webRequest.headers,
            body: raw,
          })
    const handlerResult = await callableHandler({
      query,
      body,
      params,
      request: handlerRequest,
      ctx,
    })

    // Handle result
    if (handlerResult === undefined || handlerResult === null) {
      sendJson(res, null, (rc.status as number | undefined) ?? 204, transformer)
      if (pluginRunner) await pluginRunner.runOnResponse(buildPluginCtx(ctx))
      return
    }

    if (handlerResult instanceof Response) {
      // `Object.fromEntries(Headers)` collapses multi-valued headers like
      // `Set-Cookie` to a single string. Set Set-Cookie via setHeader array
      // overload BEFORE writeHead (writeHead flushes headers; later setHeader
      // is a no-op or throws). Then writeHead with the remaining singletons.
      const headersBag: Record<string, string> = {}
      for (const [k, v] of handlerResult.headers) {
        if (k.toLowerCase() !== 'set-cookie') headersBag[k] = v
      }
      const setCookies = handlerResult.headers.getSetCookie()
      if (setCookies.length > 0) {
        res.setHeader('Set-Cookie', setCookies)
      }
      res.writeHead(handlerResult.status, headersBag)

      let bodyCompleted = true
      if (handlerResult.body) {
        bodyCompleted = await pipeWebStreamToResponse(handlerResult.body, res, {
          buildPluginCtx,
          ctx,
          method,
          pluginRunner,
          requestId,
          routePath: route.routePath,
        })
      }

      // Ending a destroyed response is a no-op on both transports, so this guard is not what makes
      // the fix work — it is what makes the intent readable. `end()` here is the call a SUCCESSFUL
      // stream makes, and reaching it on a truncated one is how #391 happened.
      if (bodyCompleted) res.end()
      if (pluginRunner) await pluginRunner.runOnResponse(buildPluginCtx(ctx))
      return
    }

    // Validate the plain-object return against config.response when declared
    // (D1/D2). A mismatch is a SERVER fault → throw TheoError, routed to a 500
    // by the catch below. Response-instance + 204 branches above are untouched.
    let responseBody: unknown = handlerResult
    if (isZodLike(rc.response)) {
      const parsed = rc.response.safeParse(handlerResult)
      if (!parsed.success) {
        throw new TheoError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'response validation failed',
          ext: { issues: parsed.error?.issues },
        })
      }
      responseBody = parsed.data
    }
    sendJson(res, responseBody, (rc.status as number | undefined) ?? 200, transformer)
    if (pluginRunner) await pluginRunner.runOnResponse(buildPluginCtx(ctx))
  } catch (err) {
    // T4.4 — onError hook (runs before default error response)
    if (pluginRunner) {
      // Best-effort: capture a ctx snapshot for plugins. Decorations were
      // applied to local `ctx` above, but if the error came before that, we
      // pass an empty ctx — the request/response are what matters here.
      const errCtxObj: Record<string, unknown> = {}
      pluginRunner.applyDecorations(errCtxObj)
      await pluginRunner.runOnError(buildPluginCtx(errCtxObj), err)
      // EC-9: response may already have been ended by an onError hook
      if (res.writableEnded) {
        // Still run onResponse but mark inErrorPath to prevent recursion
        await pluginRunner.runOnResponse(buildPluginCtx(errCtxObj), { inErrorPath: true })
        return
      }
    }
    // Auth error detection (shape-based guard from core/contracts — Vite HMR
    // can break instanceof, so shape check is the canonical path).
    if (isAuthRequiredError(err)) {
      const authErr = err as { code: string; message: string; status: number }
      sendError(res, authErr.code, authErr.message, authErr.status, undefined, requestId)
      if (pluginRunner) {
        const errCtxObj: Record<string, unknown> = {}
        pluginRunner.applyDecorations(errCtxObj)
        await pluginRunner.runOnResponse(buildPluginCtx(errCtxObj), { inErrorPath: true })
      }
      return
    }
    sendError(
      res,
      'INTERNAL_ERROR',
      err instanceof Error && err.message ? err.message : 'Internal server error',
      500,
      undefined,
      requestId,
    )
    if (pluginRunner) {
      const errCtxObj: Record<string, unknown> = {}
      pluginRunner.applyDecorations(errCtxObj)
      await pluginRunner.runOnResponse(buildPluginCtx(errCtxObj), { inErrorPath: true })
    }
  }
}
