import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { durableUiMessageStreamResponse } from '../../packages/theo/src/server/agent/durable-ui-message-stream-response.js'
import { getRunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'
import { serveAgentAuxRoute } from '../../packages/theo/src/server/agent/serve-aux-routes.js'
import type { AgentNode } from '../../packages/theo/src/server/scan/agent-scan.js'

/**
 * M37 (ADR-0046) — end-to-end wiring through the REAL aux-route dispatcher +
 * the REAL `getRunEventCache()` singleton (the same one `mountAgent` writes to).
 * Proves a durable stream's frames are reconnectable via
 * `GET /api/agents/<name>/runs/<runId>/stream`.
 */

const AGENTS: AgentNode[] = [
  {
    name: 'support',
    filePath: '/agents/support.ts',
    agentPath: '/api/agents/support',
  } as AgentNode,
]
const deps = {
  agents: AGENTS,
  loadModule: async () => ({}),
  baseUrl: 'https://app.example',
  csrfMode: 'off' as const,
}

function getReq(url: string, lastEventId?: string): Request {
  const headers = new Headers()
  if (lastEventId !== undefined) headers.set('last-event-id', lastEventId)
  return new Request(`https://app.example${url}`, { method: 'GET', headers })
}

async function* chunks(...items: UIMessageChunk[]): AsyncIterable<UIMessageChunk> {
  for (const c of items) yield c
}
async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

describe('serveAgentAuxRoute — M37 durable run-stream reconnect', () => {
  it('reconnects a completed run through the dispatcher + shared singleton cache', async () => {
    const cache = getRunEventCache() // the SAME singleton mountAgent uses
    const runId = 'run-e2e-1'
    // Simulate mountAgent's durable stream: drive it to completion so frames cache.
    const start = { type: 'start' } as UIMessageChunk
    const delta = { type: 'text-delta', id: 't', delta: 'hi' } as UIMessageChunk
    await readAll(durableUiMessageStreamResponse(chunks(start, delta), { runId, cache }))

    const path = `/api/agents/support/runs/${runId}/stream`
    const res = await serveAgentAuxRoute(getReq(path), path, deps)
    expect(res).not.toBeNull()
    const body = await readAll(res!)
    expect(body).toBe(
      `id: 0\ndata: ${JSON.stringify(start)}\n\nid: 1\ndata: ${JSON.stringify(delta)}\n\ndata: [DONE]\n\n`,
    )
  })

  it('honors Last-Event-ID through the dispatcher (replays only missed frames)', async () => {
    const cache = getRunEventCache()
    const runId = 'run-e2e-2'
    const a = { type: 'start' } as UIMessageChunk
    const b = { type: 'finish' } as UIMessageChunk
    await readAll(durableUiMessageStreamResponse(chunks(a, b), { runId, cache }))

    const path = `/api/agents/support/runs/${runId}/stream`
    const res = await serveAgentAuxRoute(getReq(path, '0'), path, deps)
    const body = await readAll(res!)
    expect(body).toBe(`id: 1\ndata: ${JSON.stringify(b)}\n\ndata: [DONE]\n\n`)
  })

  it('returns 404 for an unknown runId under a known agent', async () => {
    const path = '/api/agents/support/runs/run-missing/stream'
    const res = await serveAgentAuxRoute(getReq(path), path, deps)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(404)
  })

  it('falls through (null) for an unknown agent name', async () => {
    const path = '/api/agents/ghost/runs/run-x/stream'
    const res = await serveAgentAuxRoute(getReq(path), path, deps)
    expect(res).toBeNull()
  })

  it('falls through (null) for a non-GET method on the run-stream route', async () => {
    const path = '/api/agents/support/runs/run-x/stream'
    const res = await serveAgentAuxRoute(
      new Request(`https://app.example${path}`, { method: 'POST' }),
      path,
      deps,
    )
    expect(res).toBeNull()
  })
})
