import { randomUUID } from 'node:crypto'

import type { CustomTool } from '@theokit/sdk'
import {
  createOpenAICompatibleRoutes,
  createToolInvokeRoute,
  type OpenAIChatRequest,
  type OpenAICompletion,
  renderTranscript,
} from '@theokit/agents/bridge'
import { z } from 'zod'

import { bearerCheck } from '../control-plane/bearer.js'
import type { PartialHandler } from '../control-plane/http-dispatch.js'
import { runTheoClawTurn, type TurnEvent, type WithAgent } from '../control-plane/turn.js'
import { handleMcpRequest } from '../mcp/serve-tools.js'
import { vetoToolCall } from '../tools/path-veto.js'
import type { ToolSettings } from '../tools/tool-settings.js'

export interface TheoClawApiOptions {
  /** `THEOCLAW_CONTROL_TOKEN`: every API request carries it as a bearer token (plan D3). */
  readonly token: string
  /** `THEOCLAW_MODEL`, the one model `/v1/models` lists and a chat request may name. */
  readonly model: string
  /** Builds the agent of one chat completion: a chat surface, so one that holds no tool (B-382). */
  readonly withAgent: WithAgent
  /** The one setting both the tool list and the path veto are derived from, so they cannot disagree. */
  readonly toolSettings: ToolSettings
  /**
   * A fresh copy of the tools a `/control` agent holds (`controlAgentToolOptions(...).tools`, so
   * `run_code` and `delegate_all` too), built per request so the HTTP set is theirs by construction.
   */
  readonly controlTools: () => readonly CustomTool[]
  readonly stderr: (line: string) => void
}

const API_PATHS: ReadonlySet<string> = new Set(['/v1/models', '/v1/chat/completions', '/tools/invoke', '/mcp'])

function unauthorized(): Response {
  return Response.json(
    // `ok: false` too, so the tool route's 401 has the shape of its every other answer.
    { ok: false, error: { type: 'unauthorized', message: 'a bearer token is required' } },
    { status: 401, headers: { 'www-authenticate': 'Bearer' } },
  )
}

/**
 * What is wrong with `args` for `tool`, judged against the tool's own `inputSchema` (plan D4): the
 * SDK checks a model's arguments before dispatch, and a direct call skips that. The first issue,
 * as `<path>: <message>` (`(root)` for the object itself). A schema `z.fromJSONSchema` cannot
 * compile throws: that is the tool's defect, which the route answers 500 `tool_error`.
 */
export function validateToolArgs(tool: CustomTool, args: Record<string, unknown>): string | undefined {
  const parsed = z.fromJSONSchema(tool.inputSchema as Parameters<typeof z.fromJSONSchema>[0]).safeParse(args)
  if (parsed.success) return undefined
  const issue = parsed.error.issues[0]
  if (issue === undefined) return 'the arguments do not match the tool schema'
  const path = issue.path.map(String).join('.')
  return `${path === '' ? '(root)' : path}: ${issue.message}`
}

/**
 * The `complete` port over one TheoClaw turn: the transcript as the message, the text of every
 * `text_delta` joined. A failed turn's reason goes to stderr only; the client gets 502.
 */
function completeWith(options: TheoClawApiOptions): (
  request: OpenAIChatRequest,
  onDelta?: (text: string) => void,
  signal?: AbortSignal,
) => Promise<OpenAICompletion> {
  return async (request, onDelta, signal) => {
    const text: string[] = []
    const emit = (event: TurnEvent): void => {
      if (event.type === 'text_delta' && typeof event.content === 'string') {
        text.push(event.content)
        onDelta?.(event.content)
      }
    }
    const message = renderTranscript(request.messages)
    const outcome = await runTheoClawTurn({ withAgent: options.withAgent, message, runId: randomUUID(), emit, model: options.model, ...(signal === undefined ? {} : { signal }) })
    if (!outcome.ok) {
      options.stderr(`theoclaw: http api turn failed: ${outcome.reason}`)
      throw new Error(outcome.reason)
    }
    const usage = outcome.usage
    return {
      text: text.join(''),
      ...(usage === undefined ? {} : { usage: { promptTokens: usage.inputTokens, completionTokens: usage.outputTokens } }),
    }
  }
}

/**
 * The tool route of one request (plan D5): a fresh `/control` tool list, as each `/control` agent gets, so a
 * todolist is never shared between two callers; the path veto the plugin applies (D2); the schema
 * check (D4).
 */
function toolRouteFor(options: TheoClawApiOptions): PartialHandler {
  const settings = options.toolSettings
  return createToolInvokeRoute({
    tools: options.controlTools(),
    veto: (name, args) => vetoToolCall(name, args, settings),
    validate: validateToolArgs,
  })
}

/**
 * TheoClaw's HTTP API: the OpenAI-compatible `/v1/models` and `/v1/chat/completions`, and
 * `/tools/invoke` with exactly the `/control` tools. Every request to those paths needs the control
 * token, checked before the body is read and before any agent exists (401 otherwise); any other
 * path answers `undefined`, so the listener tries its next handler.
 */
export function createTheoClawApi(options: TheoClawApiOptions): PartialHandler {
  const accepts = bearerCheck(options.token)
  const openai = createOpenAICompatibleRoutes({ models: [options.model], complete: completeWith(options) })
  return async (request) => {
    const { pathname } = new URL(request.url)
    if (!API_PATHS.has(pathname)) return undefined
    if (!accepts(request.headers.get('authorization') ?? undefined)) return unauthorized()
    if (pathname === '/mcp') return handleMcpRequest(options.controlTools(), options.toolSettings, request)
    return pathname === '/tools/invoke' ? toolRouteFor(options)(request) : openai(request)
  }
}

/** The API while `THEOCLAW_CONTROL_TOKEN` is set, or `undefined` (its paths then answer 404). */
export function theoClawApiFor(token: string | undefined, options: Omit<TheoClawApiOptions, 'token'>): PartialHandler | undefined {
  return token === undefined ? undefined : createTheoClawApi({ ...options, token })
}
