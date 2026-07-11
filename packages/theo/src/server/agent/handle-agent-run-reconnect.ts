import {
  encodeSse,
  formatSseFrame,
  RUN_ID_HEADER,
  SSE_BASE_HEADERS,
  SSE_DONE_FRAME,
} from './durable-ui-message-stream-response.js'
import type { RunEventCache } from './run-event-cache.js'

/**
 * M37 (ADR-0046 D5) — the reconnect / observe endpoint handler for
 * `GET /api/agents/<name>/runs/<runId>/stream`.
 *
 * Replays the frames the client missed (`seq > Last-Event-ID`, SSE-native), then
 * — if the run is still live — follows the live tail; a SECOND client can
 * observe a run a first started. Run already ended ⇒ replay + `[DONE]`. Unknown
 * `runId` ⇒ 404. The request `AbortSignal` unsubscribes on disconnect.
 */

const RUN_STREAM_PATH = /^\/api\/agents\/([^/]+)\/runs\/([^/]+)\/stream$/

/**
 * Match `GET /api/agents/<name>/runs/<runId>/stream`; returns the decoded
 * `{ name, runId }` or `null` to fall through (mirrors `isMcpPath` etc.).
 */
export function isAgentRunStreamPath(urlPath: string): { name: string; runId: string } | null {
  const m = RUN_STREAM_PATH.exec(urlPath)
  return m ? { name: decodeURIComponent(m[1]), runId: decodeURIComponent(m[2]) } : null
}

/** Parse `Last-Event-ID` (a frame `seq`) to a number; absent/invalid ⇒ -1 (replay from the start). */
function parseLastEventId(raw: string | null): number {
  if (raw === null) return -1
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n >= 0 ? n : -1
}

export function handleAgentRunReconnect(
  runId: string,
  request: Request,
  cache: RunEventCache,
): Response {
  // Unknown run ⇒ 404 (a run never started here, or already evicted).
  if (!cache.has(runId)) {
    return new Response(
      JSON.stringify({ error: { code: 'RUN_NOT_FOUND', message: `Unknown run '${runId}'.` } }),
      {
        status: 404,
        headers: { 'content-type': 'application/json' },
      },
    )
  }

  const afterSeq = parseLastEventId(request.headers.get('last-event-id'))

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const safeEnqueue = (text: string): void => {
        if (closed) return
        try {
          controller.enqueue(encodeSse(text))
        } catch {
          /* controller already closed by an abort race — ignore */
        }
      }
      const close = (): void => {
        if (closed) return
        safeEnqueue(SSE_DONE_FRAME)
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }

      // Atomic: snapshot replay frames AND subscribe to the live tail in one tick.
      const res = cache.attach(
        runId,
        afterSeq,
        (frame) => {
          safeEnqueue(formatSseFrame(frame.seq, frame.data))
        },
        () => {
          close()
        },
      )
      // Evicted between has() and attach() (rare TOCTOU) ⇒ just end the stream.
      if (!res.known) {
        close()
        return
      }
      for (const frame of res.replay) {
        safeEnqueue(formatSseFrame(frame.seq, frame.data))
      }
      if (res.ended) {
        close()
        return
      }
      // Client disconnects ⇒ detach the live listener + close.
      request.signal.addEventListener('abort', () => {
        res.unsubscribe()
        close()
      })
    },
  })

  return new Response(stream, { headers: { ...SSE_BASE_HEADERS, [RUN_ID_HEADER]: runId } })
}
