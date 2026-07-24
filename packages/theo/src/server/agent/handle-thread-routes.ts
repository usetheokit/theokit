/**
 * M39 (ADR-0048) — the thread signal routes over the M37 durable transport:
 *
 *  - `POST /api/agents/<name>/threads/<sessionId>/message` — a follow-up. ACTIVE
 *    run ⇒ FIFO-queue (dispatched as a continuation when it ends); IDLE ⇒ start a
 *    run. Returns `202` (the run streams headless into the cache; observe it via
 *    the thread stream). Spends LLM tokens ⇒ CSRF-gated (parity with mount-agent).
 *  - `GET /api/agents/<name>/threads/<sessionId>/stream` — subscribe. ACTIVE ⇒
 *    attach to the durable stream (reuse the M37 reconnect handler); IDLE ⇒ wait
 *    (bounded) for the next run on the thread, then attach (subscribe-then-post).
 *
 * These DRIVE the SDK run (via `makeThreadStartRun`) + the M37 cache — no new loop.
 */

import { validateCsrfRequest, type CsrfMode } from '../security/csrf.js'

import { makeThreadStartRun } from './build-agent-streamer.js'
import {
  encodeSse,
  formatSseFrame,
  RUN_ID_HEADER,
  SSE_BASE_HEADERS,
  SSE_DONE_FRAME,
} from './durable-ui-message-stream-response.js'
import { handleAgentRunReconnect } from './handle-agent-run-reconnect.js'
import { parseAgentRequestBody } from './mount-agent.js'
import { getRunEventCache, type RunEventCache } from './run-event-cache.js'
import { postThreadFollowUp } from './thread-dispatcher.js'
import { getThreadRunRegistry, type ThreadRunRegistry } from './thread-run-registry.js'

const THREAD_MESSAGE_PATH = /^\/api\/agents\/([^/]+)\/threads\/([^/]+)\/message$/
const THREAD_STREAM_PATH = /^\/api\/agents\/([^/]+)\/threads\/([^/]+)\/stream$/

/** How long a subscribe-to-idle-thread waits for the next run before closing. */
const DEFAULT_IDLE_WAIT_MS = 30_000

function matchThread(re: RegExp, urlPath: string): { name: string; sessionId: string } | null {
  const m = re.exec(urlPath)
  return m ? { name: decodeURIComponent(m[1]), sessionId: decodeURIComponent(m[2]) } : null
}

export const isThreadMessagePath = (urlPath: string) => matchThread(THREAD_MESSAGE_PATH, urlPath)
export const isThreadStreamPath = (urlPath: string) => matchThread(THREAD_STREAM_PATH, urlPath)

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** Inputs for {@link handleThreadMessage} (bundled to stay within the arity budget). */
interface ThreadMessageArgs {
  readonly mod: unknown
  readonly apiKey: string
  readonly sessionId: string
  readonly request: Request
  readonly source: string
  readonly csrfMode?: CsrfMode
}

/** POST a follow-up on a thread. Returns `202` with `{ runId }` (started) or `{ queued: true }`. */
export async function handleThreadMessage(args: ThreadMessageArgs): Promise<Response> {
  const { mod, apiKey, sessionId, request, source, csrfMode = 'strict' } = args
  // A follow-up drives the agent (spends LLM tokens) — reject a cross-origin POST.
  if (csrfMode === 'strict') {
    const csrf = validateCsrfRequest(request)
    if (!csrf.valid) return jsonError(403, 'CSRF_FAILED', `CSRF check failed: ${csrf.reason}`)
  }
  let body: unknown = null
  try {
    body = await request.json()
  } catch {
    /* invalid/empty JSON → 400 below */
  }
  const input = parseAgentRequestBody(body)
  if (input === null) {
    return jsonError(400, 'BAD_REQUEST', 'Request must contain a non-empty message.')
  }
  const result = postThreadFollowUp(
    {
      registry: getThreadRunRegistry(),
      cache: getRunEventCache(),
      startRun: makeThreadStartRun(mod, apiKey, source),
    },
    sessionId,
    input.message,
  )
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' }
  if ('runId' in result) headers[RUN_ID_HEADER] = result.runId
  return new Response(JSON.stringify(result), { status: 202, headers })
}

/** GET the thread's durable stream. Active ⇒ attach now; idle ⇒ wait (bounded) for the next run. */
export function handleThreadStream(
  sessionId: string,
  request: Request,
  registry: ThreadRunRegistry = getThreadRunRegistry(),
  cache: RunEventCache = getRunEventCache(),
  idleWaitMs = DEFAULT_IDLE_WAIT_MS,
): Response {
  const active = registry.getActive(sessionId)
  if (active !== null && cache.has(active)) {
    // Reuse the M37 reconnect handler — replay + live tail on the active run.
    return handleAgentRunReconnect(active, request, cache)
  }
  return waitThenAttachStream(sessionId, request, registry, cache, idleWaitMs)
}

/** Subscribe to an idle thread: wait (bounded) for the NEXT run to start, then attach + tail. */
function waitThenAttachStream(
  sessionId: string,
  request: Request,
  registry: ThreadRunRegistry,
  cache: RunEventCache,
  idleWaitMs: number,
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (text: string): void => {
        if (closed) return
        try {
          controller.enqueue(encodeSse(text))
        } catch {
          /* closed by an abort race */
        }
      }
      let detachAttach: (() => void) | undefined
      const close = (): void => {
        if (closed) return
        send(SSE_DONE_FRAME)
        closed = true
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
      const offNext = registry.onNextRun(sessionId, (runId) => {
        const res = cache.attach(
          runId,
          -1,
          (frame) => {
            send(formatSseFrame(frame.seq, frame.data))
          },
          () => {
            close()
          },
        )
        if (!res.known) {
          close()
          return
        }
        for (const frame of res.replay) send(formatSseFrame(frame.seq, frame.data))
        if (res.ended) {
          close()
          return
        }
        detachAttach = res.unsubscribe
      })
      // HIGH-1 — the waiter teardown MUST run on BOTH the idle-wait timeout AND the
      // client abort, else the (one-shot) `onNextRun` waiter leaks in the registry
      // when a timed-out subscriber's session never receives another run.
      const teardownWaiter = (): void => {
        offNext()
        detachAttach?.()
      }
      const timer = setTimeout(() => {
        teardownWaiter()
        close()
      }, idleWaitMs)
      timer.unref()
      request.signal.addEventListener('abort', () => {
        teardownWaiter()
        clearTimeout(timer)
        close()
      })
    },
  })
  return new Response(stream, { headers: { ...SSE_BASE_HEADERS } })
}
