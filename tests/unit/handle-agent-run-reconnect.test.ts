import { describe, expect, it } from 'vitest'

import {
  handleAgentRunReconnect,
  isAgentRunStreamPath,
} from '../../packages/theo/src/server/agent/handle-agent-run-reconnect.js'
import { createInMemoryRunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'

/**
 * M37 (ADR-0046 D5) — the reconnect / observe endpoint: replay missed frames
 * after `Last-Event-ID`, then follow the live tail; a second client observes a
 * run a first started; unknown run ⇒ 404.
 */

function req(lastEventId?: string, signal?: AbortSignal): Request {
  const headers = new Headers()
  if (lastEventId !== undefined) headers.set('last-event-id', lastEventId)
  return new Request('http://x/api/agents/a/runs/r/stream', { headers, signal })
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

describe('M37 — isAgentRunStreamPath', () => {
  it('matches /api/agents/<name>/runs/<runId>/stream and extracts name + runId', () => {
    expect(isAgentRunStreamPath('/api/agents/chat/runs/run-123/stream')).toEqual({
      name: 'chat',
      runId: 'run-123',
    })
    expect(isAgentRunStreamPath('/api/agents/chat/runs/run-123/other')).toBeNull()
    expect(isAgentRunStreamPath('/api/agents/chat/approvals')).toBeNull()
  })
})

describe('M37 — handleAgentRunReconnect', () => {
  it('returns 404 for an unknown run', async () => {
    const cache = createInMemoryRunEventCache()
    const res = handleAgentRunReconnect('ghost', req(), cache)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error.code).toBe('RUN_NOT_FOUND')
  })

  it('replays an ENDED run (all frames after Last-Event-ID) then closes with [DONE]', async () => {
    const cache = createInMemoryRunEventCache()
    cache.append('r', '{"type":"start"}')
    cache.append('r', '{"type":"text-delta"}')
    cache.end('r')

    // no Last-Event-ID → replay from the start
    const full = await readAll(handleAgentRunReconnect('r', req(), cache))
    expect(full).toBe(
      'id: 0\ndata: {"type":"start"}\n\nid: 1\ndata: {"type":"text-delta"}\n\ndata: [DONE]\n\n',
    )

    // Last-Event-ID: 0 → only frames after seq 0
    const partial = await readAll(handleAgentRunReconnect('r', req('0'), cache))
    expect(partial).toBe('id: 1\ndata: {"type":"text-delta"}\n\ndata: [DONE]\n\n')
  })

  it('resumes a LIVE run: replays the missed frame, then streams live frames, then [DONE] on end', async () => {
    const cache = createInMemoryRunEventCache()
    cache.append('r', 'f0')
    cache.append('r', 'f1')

    // client reconnects having last seen seq 0 → should get f1 replay, then live f2/f3.
    // The handler's ReadableStream `start()` runs SYNCHRONOUSLY in the constructor,
    // so the listener is already attached when the call returns — appending live
    // frames now is deterministic (no wall-clock wait needed; enqueue buffers).
    const res = handleAgentRunReconnect('r', req('0'), cache)
    cache.append('r', 'f2')
    cache.append('r', 'f3')
    cache.end('r')

    const body = await readAll(res)
    expect(body).toBe(
      'id: 1\ndata: f1\n\n' + // replay (missed while disconnected — no dup of f0, no gap)
        'id: 2\ndata: f2\n\n' + // live
        'id: 3\ndata: f3\n\n' + // live
        'data: [DONE]\n\n',
    )
  })

  it('a SECOND observer attaches to a live run a first started (both see the live tail)', async () => {
    const cache = createInMemoryRunEventCache()
    cache.append('r', 'f0')

    const observer = handleAgentRunReconnect('r', req(), cache) // no Last-Event-ID → full replay
    // start() attached synchronously → live appends are deterministic.
    cache.append('r', 'f1')
    cache.end('r')

    const body = await readAll(observer)
    expect(body).toBe('id: 0\ndata: f0\n\nid: 1\ndata: f1\n\ndata: [DONE]\n\n')
  })

  it('a client disconnect (abort) detaches the listener and ends the stream', async () => {
    const cache = createInMemoryRunEventCache()
    cache.append('r', 'f0')
    const controller = new AbortController()
    const res = handleAgentRunReconnect('r', req(undefined, controller.signal), cache)
    // start() (sync) registered the abort listener → aborting now is deterministic.
    controller.abort() // client drops

    const body = await readAll(res)
    // got the replay + a DONE terminal on abort (never left hanging)
    expect(body).toContain('id: 0\ndata: f0\n\n')
    expect(body).toContain('data: [DONE]\n\n')
    // after abort, the listener is gone — a further append is not delivered anywhere (no throw)
    expect(() => cache.append('r', 'f1')).not.toThrow()
  })
})
