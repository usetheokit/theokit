import type { IncomingMessage, ServerResponse } from 'node:http'

import type { z } from 'zod'

import {
  ActionError,
  ActionInputError,
  type ActionErrorCode,
} from '../../core/contracts/action-protocol.js'
import { parseRequestBody, type ParsedBody } from '../body-parser.js'
import type { PluginContext } from '../plugin-types.js'
import type { PluginRunner } from '../plugins/plugin-runner.js'
import type { LoadModule } from '../scan/module-loader.js'
import { dispatchCsrfWarn } from '../security/csrf-warn-dispatch.js'
import { enforceCsrf, type CsrfMode, type DisallowedConfig } from '../security/csrf.js'

import { sendError } from './execute.js'
import { formDataToObject } from './form-data-to-object.js'
import { handleRequestError } from './handle-request-error.js'
import { runMiddlewareAndContext } from './middleware-runner.js'
import { serializeActionResult } from './serialize-action-result.js'

// Universal dev gate — same IIFE pattern as track-agent-run (EC-11 tree-shake).
// Both checks are statically replaceable by bundlers in prod build, so the
// devtools dispatcher import is eliminated from prod bundles entirely.
const __IS_DEV = (() => {
  try {
    return (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true
  } catch {
    return process.env.NODE_ENV !== 'production'
  }
})()

// Minimal Zod-shaped contract — we only need `safeParse`, not the whole API.
interface ZodLike {
  safeParse: (value: unknown) => {
    success: boolean
    data?: unknown
    error?: { issues: z.ZodIssue[] }
  }
}

// Shape of a `defineAction` export. Anchored by structural typing — we do
// not import the action factory's return type to avoid module cycles, but
// we do reject inputs that fail the structural test.
interface ActionConfig {
  input: ZodLike
  handler: (params: { input: unknown; ctx: unknown }) => unknown
  csrf?: false
  /** T1.3 sub-C: wire-protocol accept mode (defaults to 'json' when omitted). */
  accept?: 'form' | 'json'
}

function isActionConfig(value: unknown): value is ActionConfig {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.handler !== 'function') return false
  const input = candidate.input as ZodLike | undefined
  return typeof input?.safeParse === 'function'
}

export interface ExecuteActionOptions {
  filePath: string
  exportName: string
  req: IncomingMessage
  res: ServerResponse
  loadModule: LoadModule
  serverDir?: string
  requestId?: string
  pluginRunner?: PluginRunner
  csrfMode?: CsrfMode
  disallowed?: DisallowedConfig
}

// Backwards-compatible positional signature; the options-shape is the new
// preferred entry point and what the framework uses internally.
// eslint-disable-next-line max-params -- public API surface; existing callers pass positional args
export async function executeAction(
  filePath: string,
  exportName: string,
  req: IncomingMessage,
  res: ServerResponse,
  loadModule: LoadModule,
  serverDir?: string,
  requestId?: string,
  pluginRunner?: PluginRunner,
  csrfMode: CsrfMode = 'strict',
  disallowed?: DisallowedConfig,
): Promise<void> {
  return executeActionWithOptions({
    filePath,
    exportName,
    req,
    res,
    loadModule,
    serverDir,
    requestId,
    pluginRunner,
    csrfMode,
    disallowed,
  })
}

async function loadActionConfig(
  loadModule: LoadModule,
  filePath: string,
  exportName: string,
  res: ServerResponse,
  requestId: string | undefined,
): Promise<ActionConfig | null> {
  const mod = await loadModule(filePath)
  const exportedValue = mod[exportName]
  if (!isActionConfig(exportedValue)) {
    sendError(res, 'NOT_FOUND', `Action "${exportName}" not found`, 404, undefined, requestId)
    return null
  }
  return exportedValue
}

interface CsrfActionCtx {
  actionConfig: ActionConfig
  csrfMode: CsrfMode
  disallowed: DisallowedConfig | undefined
  requestId: string | undefined
}

function enforceCsrfForAction(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: CsrfActionCtx,
): boolean {
  if (ctx.actionConfig.csrf === false) return true
  const decision = enforceCsrf(
    req,
    ctx.csrfMode,
    {
      // T3.3 DRY — canonical dispatcher
      warn: dispatchCsrfWarn,
      path: req.url,
    },
    ctx.disallowed,
  )
  if (decision.allow) return true
  sendError(
    res,
    'CSRF_INVALID',
    decision.reason ?? 'CSRF check failed',
    403,
    undefined,
    ctx.requestId,
  )
  return false
}

interface ActionPipeline {
  ctx: Record<string, unknown>
  buildPluginCtx: (ctxObj: Record<string, unknown>) => PluginContext
  pluginRunner: PluginRunner | undefined
  serverDir: string | undefined
  loadModule: LoadModule
  req: IncomingMessage
  res: ServerResponse
}

async function runPreHandlerPipeline(p: ActionPipeline): Promise<boolean> {
  if (p.serverDir) {
    const result = await runMiddlewareAndContext(p.req, p.res, p.loadModule, p.serverDir)
    if (result.aborted) return false
    Object.assign(p.ctx, (result.ctx ?? {}) as Record<string, unknown>)
    p.pluginRunner?.applyDecorations(p.ctx)
  }
  if (p.pluginRunner) {
    const preResult = await p.pluginRunner.runPreHandler(p.buildPluginCtx(p.ctx))
    if (preResult.shortCircuited) return false
  }
  return true
}

async function readActionBody(
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string | undefined,
  actionConfig: ActionConfig,
): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    const parsed = await parseRequestBody(req)
    const accept = actionConfig.accept ?? 'json'
    let body: unknown
    if (accept === 'form') {
      body = formDataToObject(
        synthesizeFormData(parsed),
        actionConfig.input as unknown as z.ZodObject<z.ZodRawShape>,
      )
    } else if (parsed.json !== undefined) {
      body = parsed.json
    } else {
      body = parsed.fields
    }
    return { ok: true, body }
  } catch (err) {
    sendError(res, 'VALIDATION_ERROR', (err as Error).message, 400, undefined, requestId)
    return { ok: false }
  }
}

/**
 * Build a FormData instance from the body-parser's `ParsedBody`. Fields become
 * string entries; files become Blob entries with the original filename. Used
 * only when `accept === 'form'` to feed `formDataToObject`.
 */
function synthesizeFormData(parsed: ParsedBody): FormData {
  const fd = new FormData()
  for (const [name, value] of Object.entries(parsed.fields)) {
    fd.append(name, value)
  }
  for (const file of parsed.files) {
    const blob = new Blob([file.buffer as unknown as ArrayBuffer], {
      type: file.mimeType,
    })
    fd.append(file.fieldname, blob, file.filename)
  }
  return fd
}

/**
 * Write a serialized ActionResult to the response. Sets content-type, status,
 * and body. Returns void; caller must not write further after invoking.
 */
function writeSerialized(
  res: ServerResponse,
  serialized: ReturnType<typeof serializeActionResult>,
): void {
  if (serialized.type === 'empty') {
    res.statusCode = serialized.status
    res.end()
    return
  }
  res.statusCode = serialized.status
  res.setHeader('Content-Type', serialized.contentType)
  res.end(serialized.body)
}

/**
 * Dev-only telemetry: dispatch ACTION_CALL_ADD so the devtools Actions tab
 * (T5.1) can render this call. Tree-shaken in prod via __IS_DEV guard.
 * Mirrors trackAgentRun pattern. Never throws (swallow + log).
 */
async function emitActionCallTelemetry(
  name: string,
  startedAt: number,
  input: unknown,
  outcome: { status: 'success'; output: unknown } | { status: 'error'; error: ActionError },
): Promise<void> {
  if (!__IS_DEV) return
  try {
    const mod = (await import('../../devtools/dispatcher.js')) as {
      dispatcher: {
        onActionCall: (r: {
          id: string
          timestamp: number
          name: string
          input: unknown
          output?: unknown
          error?: { code: string; message: string; fields?: Record<string, string[]> }
          durationMs: number
          status: 'success' | 'error'
        }) => void
      }
    }
    mod.dispatcher.onActionCall({
      // eslint-disable-next-line sonarjs/pseudo-random -- non-secret correlation id
      id: `act-${String(Date.now())}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: startedAt,
      name,
      input,
      output: outcome.status === 'success' ? outcome.output : undefined,
      error:
        outcome.status === 'error'
          ? {
              code: outcome.error.code,
              message: outcome.error.message,
              fields: outcome.error instanceof ActionInputError ? outcome.error.fields : undefined,
            }
          : undefined,
      durationMs: Date.now() - startedAt,
      status: outcome.status,
    })
  } catch {
    // devtools dispatcher missing in some prod-like bundle — silently skip
  }
}

async function executeActionWithOptions(opts: ExecuteActionOptions): Promise<void> {
  const {
    filePath,
    exportName,
    req,
    res,
    loadModule,
    serverDir,
    requestId,
    pluginRunner,
    csrfMode = 'strict',
    disallowed,
  } = opts

  const buildPluginCtx = (ctxObj: Record<string, unknown>): PluginContext => ({
    request: req,
    response: res,
    ctx: ctxObj,
    requestId: requestId ?? 'no-id',
  })

  let ctx: Record<string, unknown> = {}

  try {
    // 1. Only POST.
    if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
      sendError(res, 'METHOD_NOT_ALLOWED', 'Actions only accept POST', 405, undefined, requestId)
      return
    }

    // 2. Plugin onRequest hook (parity with executeRoute).
    if (pluginRunner) {
      pluginRunner.applyDecorations(ctx)
      const onReqResult = await pluginRunner.runOnRequest(buildPluginCtx(ctx))
      if (onReqResult.shortCircuited) return
    }

    // 3. Load module + locate action export.
    const actionConfig = await loadActionConfig(loadModule, filePath, exportName, res, requestId)
    if (!actionConfig) return

    // 4. CSRF enforcement
    if (!enforceCsrfForAction(req, res, { actionConfig, csrfMode, disallowed, requestId })) {
      return
    }

    // 5+6. Middleware + context pipeline, then plugin preHandler.
    const pipeline: ActionPipeline = {
      ctx,
      buildPluginCtx,
      pluginRunner,
      serverDir,
      loadModule,
      req,
      res,
    }
    if (!(await runPreHandlerPipeline(pipeline))) return
    ctx = pipeline.ctx

    // 7. Parse body (supports JSON and multipart/form-data).
    const bodyOutcome = await readActionBody(req, res, requestId, actionConfig)
    if (!bodyOutcome.ok) return

    // T1.3 sub-C action name derived from exportName for telemetry.
    const actionName = exportName === 'default' ? deriveActionNameFromPath(filePath) : exportName
    const startedAt = Date.now()

    // 8. Validate input with Zod — failure → ActionInputError envelope (T0.1 + ADR D6).
    const result = actionConfig.input.safeParse(bodyOutcome.body)
    if (!result.success) {
      const inputErr = new ActionInputError(result.error?.issues ?? [])
      writeSerialized(res, serializeActionResult({ data: undefined, error: inputErr }))
      await emitActionCallTelemetry(actionName, startedAt, bodyOutcome.body, {
        status: 'error',
        error: inputErr,
      })
      return
    }

    await runActionHandler({
      actionConfig,
      actionName,
      startedAt,
      input: result.data,
      ctx,
      res,
      pluginRunner,
      buildPluginCtx,
    })
  } catch (err) {
    await handleActionError(err, { req, res, ctx, requestId, pluginRunner, buildPluginCtx })
  }
}

/** Derive a stable display name from filePath when handler exported as default. */
function deriveActionNameFromPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? 'unknown'
  return base.replace(/\.[jt]sx?$/, '')
}

/**
 * Duck-typed guard for ActionError-shaped throws. Necessary because Vite SSR
 * may load multiple module copies of `core/contracts/action-protocol.ts` when
 * the fixture resolves `theokit/server` via a different path than the runtime
 * import — `err instanceof ActionError` then fails even though the user
 * legitimately threw `new ActionError(...)`.
 *
 * Server-only: only invoked on handler-thrown errors (trust boundary already
 * inside the action runtime). Not safe to use on client-parsed JSON — for
 * that path keep `isActionError` (the instanceof guard) from action-protocol.
 */
function isActionErrorLike(err: unknown): err is ActionError {
  if (err === null || typeof err !== 'object') return false
  const obj = err as Record<string, unknown>
  return (
    (obj.type === 'TheoActionError' || obj.type === 'TheoActionInputError') &&
    typeof obj.code === 'string' &&
    typeof obj.status === 'number'
  )
}

interface HandlerCtx {
  actionConfig: ActionConfig
  actionName: string
  startedAt: number
  input: unknown
  ctx: Record<string, unknown>
  res: ServerResponse
  pluginRunner: PluginRunner | undefined
  buildPluginCtx: (ctxObj: Record<string, unknown>) => PluginContext
}

async function runActionHandler(args: HandlerCtx): Promise<void> {
  try {
    const handlerResult = await args.actionConfig.handler({ input: args.input, ctx: args.ctx })
    // T1.3 sub-C — wire devalue serialization (ADR D1). Undefined → 204; data → 200 + json+devalue.
    writeSerialized(args.res, serializeActionResult({ data: handlerResult, error: undefined }))
    if (args.pluginRunner) {
      await args.pluginRunner.runOnResponse(args.buildPluginCtx(args.ctx))
    }
    await emitActionCallTelemetry(args.actionName, args.startedAt, args.input, {
      status: 'success',
      output: handlerResult,
    })
  } catch (err) {
    // Handler-thrown ActionError → use the typed envelope; other throws bubble
    // up to executeActionWithOptions for handleActionError fallback chain.
    // Duck-type the `type` discriminator (not instanceof): Vite SSR can load
    // multiple module copies of action-protocol.ts when fixture and runtime
    // resolve different paths; `err instanceof ActionError` then fails even
    // when the handler legitimately threw via `new ActionError(...)`.
    if (isActionErrorLike(err)) {
      writeSerialized(args.res, serializeActionResult({ data: undefined, error: err }))
      await emitActionCallTelemetry(args.actionName, args.startedAt, args.input, {
        status: 'error',
        error: err,
      })
      return
    }
    // Wrap unknown throws as INTERNAL_SERVER_ERROR with the original message
    // preserved for telemetry; production error handler still consumes via
    // handleActionError fallback (preserves AuthRequiredError duck-type).
    const wrapped = new ActionError({
      code: 'INTERNAL_SERVER_ERROR' satisfies ActionErrorCode,
      message: err instanceof Error ? err.message : 'Action handler threw',
    })
    await emitActionCallTelemetry(args.actionName, args.startedAt, args.input, {
      status: 'error',
      error: wrapped,
    })
    throw err
  }
}

interface ActionErrorCtx {
  req: IncomingMessage
  res: ServerResponse
  ctx: Record<string, unknown>
  requestId: string | undefined
  pluginRunner: PluginRunner | undefined
  buildPluginCtx: (ctxObj: Record<string, unknown>) => PluginContext
}

// T3.4 (PV-9 DRY): delegate to the shared `handleRequestError` helper.
// Adds the duck-type AuthRequiredError fallback (latent bug fix — was
// missing from action-execute, present in execute).
async function handleActionError(err: unknown, c: ActionErrorCtx): Promise<void> {
  return handleRequestError(err, {
    req: c.req,
    res: c.res,
    requestId: c.requestId,
    pluginRunner: c.pluginRunner,
    buildPluginCtx: c.buildPluginCtx,
  })
}
