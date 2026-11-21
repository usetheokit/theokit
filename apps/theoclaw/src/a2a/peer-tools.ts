import { createA2ATool } from '@theokit/agents/a2a'
import type { A2AToolConfig } from '@theokit/agents/a2a'
import type { CustomTool } from '@theokit/sdk'

import { describeError } from '../control-plane/errors.js'
import type { A2APeer } from './a2a-settings.js'

/**
 * B-394 (OC-13, plan D3) — one `peer_<name>` tool per configured peer, for the `/control` agent
 * only. Each calls its peer's `/a2a` over A2A JSON-RPC with the peer's token, and gives up after
 * `timeoutMs` (150000 ms, above the peer's own 120000 ms bound so A sees B's -32603 first). The
 * model picks a peer by name and never a URL, so no request goes to a host the model chose.
 */

/** The outbound bound: longer than a peer's inbound 120000 ms, so its own answer arrives first. */
const PEER_TIMEOUT_MS = 150_000

/** The test seams: a shorter bound and a fetch that stands in for the network. */
export interface PeerToolSeams {
  readonly timeoutMs?: number
  readonly fetchImpl?: A2AToolConfig['fetchImpl']
}

type ToolHandler = CustomTool['handler']

/**
 * Bound the call and make every failure name the peer. A cancelled caller keeps its own abort
 * reason (cancellation is not a peer failure); a refused connection (`TypeError: fetch failed`)
 * gets the peer's name with the original as `cause`.
 */
function boundedHandler(name: string, handler: ToolHandler, timeoutMs: number): ToolHandler {
  return async (input, context) => {
    const caller = context?.signal
    const bound = AbortSignal.timeout(timeoutMs)
    const signal = caller === undefined ? bound : AbortSignal.any([caller, bound])
    try {
      return await handler(input, { ...context, signal })
    } catch (error) {
      if (caller?.aborted === true) throw error
      if (bound.aborted) {
        throw new Error(`A2A call to "${name}" failed: no answer within ${timeoutMs} ms`, { cause: error })
      }
      const message = describeError(error)
      if (message.startsWith('A2A call to')) throw error
      throw new Error(`A2A call to "${name}" failed: ${message}`, { cause: error })
    }
  }
}

function peerTool(peer: A2APeer, seams: PeerToolSeams): CustomTool {
  const name = `peer_${peer.name}`
  const tool = createA2ATool({
    name,
    description: `Send a task to the TheoClaw peer "${peer.name}" over A2A and return its answer.`,
    url: `${peer.baseUrl}/a2a`,
    auth: { bearer: peer.token },
    protocol: 'jsonrpc',
    ...(seams.fetchImpl === undefined ? {} : { fetchImpl: seams.fetchImpl }),
  })
  return { ...tool, handler: boundedHandler(name, tool.handler, seams.timeoutMs ?? PEER_TIMEOUT_MS) }
}

/** One tool per peer, in the order `THEOCLAW_A2A_PEERS` names them. */
export function peerTools(peers: readonly A2APeer[], seams: PeerToolSeams = {}): CustomTool[] {
  return peers.map((peer) => peerTool(peer, seams))
}
