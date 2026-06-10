/**
 * Auto-generate HTTP routes from @Agent metadata — Web Standard.
 *
 * Per ADR D5: @Agent({ route }) auto-generates two endpoints:
 * - POST {route}/chat  — send message, receive SSE stream
 * - GET  {route}/runs/:runId — get run status/result
 *
 * Routes are convention-based, generated at registration time.
 */
import type { CompiledAgentOptions } from './agent-compiler.js'
import { streamAgentResponse, type StreamEvent } from './agent-sse-handler.js'
import type { AgentWalkResult } from './walk-agent-metadata.js'

export interface AgentRoute {
  method: 'POST' | 'GET'
  path: string
  handler: (request: Request) => Promise<Response>
}

export interface AgentRouteContext {
  walkResult: AgentWalkResult
  compiledOptions: CompiledAgentOptions
  createRun: (message: string, sessionId: string) => AsyncIterable<StreamEvent>
  getRun?: (runId: string) => Promise<{ id: string; status: string; result?: string } | null>
}

/** Generate HTTP routes for a single agent. Returns Web Standard handlers. */
export function generateAgentRoutes(ctx: AgentRouteContext): AgentRoute[] {
  const { walkResult, createRun, getRun } = ctx
  const basePath = walkResult.route.replace(/\/$/, '')
  const routes: AgentRoute[] = []

  routes.push({
    method: 'POST',
    path: `${basePath}/chat`,
    handler: async (request) => {
      let body: Record<string, unknown> | null = null
      try { body = await request.json() as Record<string, unknown> } catch { /* empty */ }

      const message = body?.message
      if (typeof message !== 'string' || message.length === 0) {
        return new Response(
          JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'message field required' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        )
      }

      const sessionId = (body?.sessionId as string) ?? `session-${Date.now()}`
      return streamAgentResponse(createRun(message, sessionId))
    },
  })

  if (getRun) {
    routes.push({
      method: 'GET',
      path: `${basePath}/runs/:runId`,
      handler: async (request) => {
        const url = new URL(request.url)
        const runId = url.pathname.split('/').pop() ?? ''
        const run = await getRun(runId)
        if (!run) {
          return new Response(
            JSON.stringify({ error: { code: 'NOT_FOUND', message: `Run ${runId} not found` } }),
            { status: 404, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(JSON.stringify(run), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
  }

  return routes
}
