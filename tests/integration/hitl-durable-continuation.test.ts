import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import { createInProcessApprovalRegistry } from '../../packages/theo/src/server/agent/approval-registry.js'
import { durableUiMessageStreamResponse } from '../../packages/theo/src/server/agent/durable-ui-message-stream-response.js'
import { handleAgentRunReconnect } from '../../packages/theo/src/server/agent/handle-agent-run-reconnect.js'
import { createInMemoryRunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'

/**
 * M38 (ADR-0047 D2) — the untested COMBINATION at the TRANSPORT layer: a
 * HITL-gated run pauses (a blocked await on the approval Promise — the shape
 * `hitl-plugin.ts:101` produces), the M37 durable stream stays open and caches
 * the real `tool-approval-request` frame, a client disconnects + reconnects
 * (M37) and replays it, the approval resolves on a SEPARATE call, and the
 * continuation frames stream on the SAME `runId` — on both the original and the
 * reconnected stream. This proves the transport half of "durable continuation"
 * is 100% functional WITHOUT any `untilIdle` flag or dispatcher (D1/D3:
 * unnecessary / out-of-scope).
 *
 * Boundary: the `hitlRun` generator emits the EXACT `UIMessageChunk` sequence the
 * M4 translator produces (`ui-message-stream-translator.ts` emitApprovalRequest:
 * tool-input-available → tool-approval-request; then tool-output-available), so
 * the frames the cache sees are the real ones. The full plugin→EventQueue→
 * translator→SDK stack is covered by `packages/agents/tests/integration/
 * hitl-harness.test.ts`; this test isolates the M37 transport + reconnect + the
 * real `approval-registry` suspend/resume.
 */

// The REAL chunk sequence the M4 translator emits for a HITL-gated tool
// (`ui-message-stream-translator.ts` emitApprovalRequest): a synthesized
// tool-input part + the ai-sdk-native `tool-approval-request`, then (on resume)
// the tool output. These are the exact `UIMessageChunk` shapes the durable
// encoder serializes + caches in production — not stand-ins.
const START = { type: 'start' } as UIMessageChunk
const TOOL_INPUT = {
  type: 'tool-input-available',
  toolCallId: 'a1',
  toolName: 'deploy',
  input: {},
  dynamic: true,
} as UIMessageChunk
const APPROVAL = {
  type: 'tool-approval-request',
  approvalId: 'a1',
  toolCallId: 'a1',
} as UIMessageChunk
const TOOL_OUT = {
  type: 'tool-output-available',
  toolCallId: 'a1',
  output: 'deployed',
} as UIMessageChunk
const FINISH = { type: 'finish' } as UIMessageChunk

/** A deferred the producer resolves right before it blocks, so tests need no wall-clock wait. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = () => {
      r()
    }
  })
  return { promise, resolve }
}

/**
 * Models the SDK run under a HITL-gated tool: emit `start` + `approval_required`,
 * then BLOCK on the approval registry Promise (as `hitl-plugin.ts:101` does), then
 * emit the tool output + `finish` once resolved.
 */
async function* hitlRun(
  registry: ReturnType<typeof createInProcessApprovalRegistry>,
  approvalId: string,
  pauseReached: { resolve: () => void },
): AsyncIterable<UIMessageChunk> {
  yield START
  yield TOOL_INPUT
  yield APPROVAL
  pauseReached.resolve() // the three frames are now enqueued+cached; we're about to block
  const decision = await registry.register(approvalId, {
    timeoutMs: 60_000,
    onTimeout: 'abort',
    toolName: 'deploy',
  })
  if (decision.approved) {
    yield TOOL_OUT
  }
  yield FINISH
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

function getReq(lastEventId?: string): Request {
  const headers = new Headers()
  if (lastEventId !== undefined) headers.set('last-event-id', lastEventId)
  return new Request('http://x/api/agents/a/runs/r/stream', { headers })
}

/** Expected SSE bytes for an ordered chunk list: `id: <seq>\ndata: <json>\n\n` … + `[DONE]`. */
function sse(...chunks: UIMessageChunk[]): string {
  return (
    chunks.map((c, i) => `id: ${i}\ndata: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  )
}

describe('M38 — HITL pause + M37 durable stream + reconnect + resume-continuation (one runId)', () => {
  it('caches the approval frame during the pause; the run is NOT ended while paused', async () => {
    const cache = createInMemoryRunEventCache()
    const registry = createInProcessApprovalRegistry()
    const pause = deferred()
    const res = durableUiMessageStreamResponse(hitlRun(registry, 'ap1', pause), {
      runId: 'r',
      cache,
    })
    const bodyPromise = readAll(res)

    await pause.promise // deterministic: producer signalled it's about to block

    // While paused: the real HITL frames (start + tool-input + tool-approval-request)
    // are cached, and the run has NOT ended.
    const mid = cache.attach(
      'r',
      -1,
      () => {},
      () => {},
    )
    expect(mid.ended).toBe(false)
    expect(mid.replay.map((f) => JSON.parse(f.data).type)).toEqual([
      'start',
      'tool-input-available',
      'tool-approval-request',
    ])
    mid.unsubscribe()

    // Resolve the approval on a SEPARATE call → the SAME run continues + ends.
    expect(registry.resolve('ap1', { approved: true })).toBe(true)
    const body = await bodyPromise
    expect(body).toBe(sse(START, TOOL_INPUT, APPROVAL, TOOL_OUT, FINISH))
    // After completion the run is ended and all 5 frames are cached under the same runId.
    const done = cache.attach(
      'r',
      -1,
      () => {},
      () => {},
    )
    expect(done.ended).toBe(true)
    expect(done.replay.map((f) => f.seq)).toEqual([0, 1, 2, 3, 4])
  })

  it('a reconnect DURING the pause replays the approval frame, then streams the resumed continuation on the same runId', async () => {
    const cache = createInMemoryRunEventCache()
    const registry = createInProcessApprovalRegistry()
    const pause = deferred()

    // Original run stream (will pause). Drain it in the background.
    const original = durableUiMessageStreamResponse(hitlRun(registry, 'ap2', pause), {
      runId: 'r',
      cache,
    })
    const originalBody = readAll(original)

    await pause.promise // paused, approval frame cached, run not ended

    // Client disconnected; reconnects with no Last-Event-ID → full replay + live tail.
    const reconnect = handleAgentRunReconnect('r', getReq(), cache)
    const reconnectBody = readAll(reconnect)

    // Approval resolves on a separate call → BOTH streams get the continuation + end.
    registry.resolve('ap2', { approved: true })

    const expected = sse(START, TOOL_INPUT, APPROVAL, TOOL_OUT, FINISH)
    const rBody = await reconnectBody
    // The reconnect replayed the paused frames (start/tool-input/approval) THEN
    // followed the resumed continuation (tool-output/finish) — exact bytes, monotonic
    // ids, no gap / no dup across the pause+reconnect+resume boundary.
    expect(rBody).toBe(expected)
    // The original stream ALSO completed with the identical full sequence (same runId).
    const oBody = await originalBody
    expect(oBody).toBe(expected)
  })

  it('a denied approval still continues the same stream (no tool-output frame, run ends)', async () => {
    const cache = createInMemoryRunEventCache()
    const registry = createInProcessApprovalRegistry()
    const pause = deferred()
    const res = durableUiMessageStreamResponse(hitlRun(registry, 'ap3', pause), {
      runId: 'r',
      cache,
    })
    const bodyPromise = readAll(res)

    await pause.promise
    registry.resolve('ap3', { approved: false }) // denied

    const body = await bodyPromise
    // start + tool-input + approval + finish (NO tool-output), then DONE — same stream.
    expect(body).toBe(sse(START, TOOL_INPUT, APPROVAL, FINISH))
  })
})
