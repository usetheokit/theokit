import { buildAgentCard } from '@theokit/agents'
import { createA2AJsonRpcHandler } from '@theokit/agents/a2a'

import type { TurnAgent } from '../agent-port.js'
import { maskSecrets } from '../channels/channel-loop.js'
import { bearerCheck } from '../control-plane/bearer.js'
import { describeError } from '../control-plane/errors.js'
import { MAX_MESSAGE_BYTES } from '../control-plane/limits.js'
import { runWorker } from '../tools/code-mode-tools.js'
import { workerToolOptions } from '../tools/tool-registry.js'
import type { AgentToolOptions } from '../tools/tool-registry.js'
import type { ToolSettings } from '../tools/tool-settings.js'

/**
 * B-394 (OC-13, plan D2) — TheoClaw's `/a2a` route: A2A JSON-RPC `message/send` answered by a fresh
 * read-only worker, never the `/control` agent, so a peer holding the token can read the tool root
 * and fetch the web through this instance and nothing more. The worker's reply is masked with the
 * start's secret values. `GET /.well-known/agent-card.json` names the endpoint and its bearer scheme.
 */

export const A2A_PATH = '/a2a'
export const AGENT_CARD_PATH = '/.well-known/agent-card.json'

/** The inbound bound: below a peer tool's 150000 ms, so the caller sees this answer first. */
const INBOUND_TIMEOUT_MS = 120_000

/** At most this many inbound turns at once (EC-2): each costs one agent and one model turn. */
const MAX_IN_FLIGHT = 4

/** Whether a path is one this route serves. */
export function isA2APath(pathname: string): boolean {
  return pathname === A2A_PATH || pathname === AGENT_CARD_PATH
}

export interface A2ARouteOptions {
  readonly token: string
  /** Builds an agent with the given tools: the shape of the start's agent factory. */
  readonly buildWorker: (toolOptions: AgentToolOptions) => TurnAgent | Promise<TurnAgent>
  readonly tools: ToolSettings
  readonly secrets: readonly string[]
  readonly write: (line: string) => void
  readonly maxInFlight?: number
  readonly timeoutMs?: number
}

/** The card: public, no token, the endpoint at this request's origin. */
function agentCardResponse(request: Request): Response {
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { allow: 'GET' } })
  const card = buildAgentCard(
    {
      name: 'theoclaw',
      route: A2A_PATH,
      stream: false,
      mainLoop: { method: 'message/send', strategy: 'worker' },
      guards: [],
      interceptors: [],
      tools: [],
      subAgents: [],
    },
    {
      baseUrl: new URL(request.url).origin,
      description: 'A TheoClaw instance reachable over A2A',
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      security: [{ bearer: [] }],
    },
  )
  return Response.json(card)
}

function refused(status: 401 | 503): Response {
  const headers: Record<string, string> = status === 401 ? { 'www-authenticate': 'Bearer' } : { 'retry-after': '5' }
  return new Response(null, { status, headers })
}

/**
 * The route. The token is checked before anything else and the in-flight count before any agent is
 * built (EC-2). A slot is freed only once the handler has answered AND the worker it started has
 * settled and been disposed, so a worker that outlives its deadline keeps its slot and at most
 * `maxInFlight` workers exist at any time.
 */
export function a2aRoute(options: A2ARouteOptions): (request: Request) => Promise<Response> {
  const authorize = bearerCheck(options.token)
  const maxInFlight = options.maxInFlight ?? MAX_IN_FLIGHT
  const timeoutMs = options.timeoutMs ?? INBOUND_TIMEOUT_MS
  const write = (line: string): void => {
    options.write(maskSecrets(line, options.secrets))
  }
  let inFlight = 0

  return async (request) => {
    if (new URL(request.url).pathname === AGENT_CARD_PATH) return agentCardResponse(request)
    if (!authorize(request.headers.get('authorization') ?? undefined)) return refused(401)
    if (inFlight >= maxInFlight) return refused(503)
    let worker: Promise<unknown> = Promise.resolve()
    const respond = async (text: string, signal: AbortSignal): Promise<string> => {
      const run = runWorker(async () => options.buildWorker(workerToolOptions(options.tools)), text, signal)
      worker = run
      try {
        const outcome = await run
        if (!signal.aborted) write('a2a: message/send answered')
        return maskSecrets(outcome.response, options.secrets)
      } catch (error) {
        write(`a2a: message/send failed: ${describeError(error)}`)
        throw error
      }
    }
    const handler = createA2AJsonRpcHandler({ authorize, respond, maxBodyBytes: MAX_MESSAGE_BYTES, timeoutMs })
    // Counted only once nothing synchronous is left that could throw past the release below.
    inFlight += 1
    const answer = handler(request)
    void Promise.allSettled([answer])
      .then(() => Promise.allSettled([worker]))
      .finally(() => {
        inFlight -= 1
      })
    return answer
  }
}
