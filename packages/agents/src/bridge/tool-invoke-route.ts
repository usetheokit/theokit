/**
 * `POST /tools/invoke`: run one tool of a fixed list over HTTP — Web Standard, like the agent route
 * generator. `{tool, args}` in; `{ok:true, result}` or `{ok:false, error:{type, message}}` out
 * (plan D2). Calling a `CustomTool.handler` directly skips the SDK's `pre_tool_call` plugins and its
 * `inputSchema` dispatch, so the caller passes both guards as ports: `veto` runs first, then
 * `validate` (D4), and the handler runs only when neither refuses.
 */
import type { CustomTool } from '@theokit/sdk'

import { MAX_REQUEST_BODY_BYTES, readCappedJson } from './read-capped-body.js'

const INVOKE_PATH = '/tools/invoke'

/** The refusal message for this call, or `undefined` to let it run; a throw is a refusal too. */
export type ToolCallVetoPort = (name: string, args: Record<string, unknown>) => string | undefined

/** What is wrong with `args` for `tool`, or `undefined` when they are valid; a throw answers 500. */
export type ToolArgsValidator = (
  tool: CustomTool,
  args: Record<string, unknown>,
) => string | undefined

export interface ToolInvokeRouteOptions {
  /** The tools a request may name; any other name answers 404. */
  readonly tools: readonly CustomTool[]
  readonly veto?: ToolCallVetoPort
  /** Without one, `args` reach the handler as sent. */
  readonly validate?: ToolArgsValidator
}

interface ToolCall {
  readonly tool: CustomTool
  readonly args: Record<string, unknown>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failure(status: number, type: string, message: string, headers?: HeadersInit): Response {
  return Response.json(
    { ok: false, error: { type, message } },
    { status, ...(headers === undefined ? {} : { headers }) },
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The parsed body, or the response that refuses it (413 past the cap, 400 otherwise). */
async function readJson(request: Request): Promise<unknown> {
  const body = await readCappedJson(request, MAX_REQUEST_BODY_BYTES)
  if (body.ok) return body.value
  if (body.reason === 'too_large')
    return failure(413, 'body_too_large', body.message, { connection: 'close' })
  return failure(400, 'invalid_request', body.message)
}

/** The tool and its arguments, or the 400 / 404 that answers the request. */
async function readCall(
  request: Request,
  tools: readonly CustomTool[],
): Promise<ToolCall | Response> {
  const body = await readJson(request)
  if (body instanceof Response) return body
  const { tool: name, args = {} } = isRecord(body) ? body : {}
  if (typeof name !== 'string' || name === '')
    return failure(400, 'invalid_request', 'the body must name a tool')
  if (!isRecord(args)) return failure(400, 'invalid_request', 'args must be an object')
  const tool = tools.find((candidate) => candidate.name === name)
  return tool === undefined ? failure(404, 'not_found', `no tool named ${name}`) : { tool, args }
}

/** The veto's refusal, a throwing veto included, as the 403 that answers the call. */
function vetoed(veto: ToolCallVetoPort | undefined, call: ToolCall): Response | undefined {
  let refusal: string | undefined
  try {
    refusal = veto?.(call.tool.name, call.args)
  } catch (error) {
    refusal = `the call was refused: ${messageOf(error)}`
  }
  return refusal === undefined ? undefined : failure(403, 'refused', refusal)
}

async function run(
  call: ToolCall,
  options: ToolInvokeRouteOptions,
  signal: AbortSignal,
): Promise<Response> {
  try {
    const invalid = options.validate?.(call.tool, call.args)
    if (invalid !== undefined) return failure(400, 'invalid_args', invalid)
    // Typed as never undefined, but a JavaScript tool can return nothing: `null` keeps `result` in
    // the body, which `Response.json` would otherwise drop.
    const result: unknown = await call.tool.handler(call.args, { signal })
    return Response.json({ ok: true, result: result ?? null })
  } catch (error) {
    // A validator that cannot judge the schema is the tool's defect, as is a handler that throws.
    return failure(500, 'tool_error', messageOf(error))
  }
}

/**
 * `POST /tools/invoke`, checked in order: size (413), JSON and shape (400 `invalid_request`), tool
 * name (404 `not_found`), `veto` (403 `refused`), `validate` (400 `invalid_args`), then the handler
 * with the request's signal (200, or 500 `tool_error`). Another method is 405; another path answers
 * `undefined`, so the caller can try its next handler.
 */
export function createToolInvokeRoute(
  options: ToolInvokeRouteOptions,
): (request: Request) => Promise<Response | undefined> {
  return async (request) => {
    if (new URL(request.url).pathname !== INVOKE_PATH) return undefined
    if (request.method !== 'POST')
      return failure(405, 'method_not_allowed', 'use POST', { allow: 'POST' })
    const call = await readCall(request, options.tools)
    if (call instanceof Response) return call
    return vetoed(options.veto, call) ?? run(call, options, request.signal)
  }
}
