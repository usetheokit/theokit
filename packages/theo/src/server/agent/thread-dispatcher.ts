/**
 * M39 (ADR-0048) — the thread follow-up dispatcher.
 *
 * Drives a run over the M37 durable cache HEADLESS — it iterates the SDK chunk
 * generator and `cache.append`s directly, NOT via a `Response` `ReadableStream`
 * (whose backpressure would stall a run with no HTTP reader). Subscribers read
 * from the cache via the thread / reconnect stream.
 *
 * - Post to an IDLE thread ⇒ start a run + pump.
 * - Post to an ACTIVE thread ⇒ FIFO-queue the follow-up.
 * - On terminal ⇒ `registry.endRun` hands back the next queued follow-up, which
 *   is dispatched as a continuation on the SAME sessionId (⇒ the SDK continues
 *   the conversation via its `ConversationStorageAdapter`).
 *
 * This adds NO agent loop — it reuses the SDK run (`startRun`) + the M37 cache.
 * Single-process (ADR-0048 D2).
 */

import type { UIMessageChunk } from 'ai'

import { type RunEventCache, mintRunId } from './run-event-cache.js'
import type { ThreadRunRegistry } from './thread-run-registry.js'

interface ThreadDispatchDeps {
  readonly registry: ThreadRunRegistry
  readonly cache: RunEventCache
  /** Start a run for a follow-up on `sessionId`; returns the SDK chunk stream. */
  readonly startRun: (sessionId: string, message: string) => AsyncIterable<UIMessageChunk>
}

/** Result of posting a follow-up: the started `runId` (idle thread) or `queued` (active thread). */
type PostFollowUpResult = { runId: string } | { queued: true }

/**
 * Post a follow-up on a thread. IDLE ⇒ start a run (returns its `runId`); ACTIVE
 * ⇒ FIFO-queue it (returns `{ queued: true }`) — dispatched when the active run ends.
 */
export function postThreadFollowUp(
  deps: ThreadDispatchDeps,
  sessionId: string,
  message: string,
): PostFollowUpResult {
  if (deps.registry.getActive(sessionId) !== null) {
    deps.registry.queue(sessionId, { message })
    return { queued: true }
  }
  return { runId: startAndPump(deps, sessionId, message) }
}

/** Mint a runId, mark the thread active, and pump the run into the cache headless. */
function startAndPump(deps: ThreadDispatchDeps, sessionId: string, message: string): string {
  const runId = mintRunId()
  // Register the run in the cache SYNCHRONOUSLY (before the async pump appends its
  // first frame) so a subscriber resolving the active runId can attach immediately.
  deps.cache.begin(runId)
  deps.registry.startRun(sessionId, runId)
  pumpIntoCache(deps, sessionId, runId, deps.startRun(sessionId, message))
  return runId
}

/**
 * Drive `chunks` into the cache under `runId`, then end the run and dispatch the
 * next queued follow-up (if any) as a continuation. Fire-and-forget — the caller
 * does not await the run; subscribers observe it via the cache.
 */
function pumpIntoCache(
  deps: ThreadDispatchDeps,
  sessionId: string,
  runId: string,
  chunks: AsyncIterable<UIMessageChunk>,
): void {
  void (async () => {
    try {
      for await (const chunk of chunks) {
        deps.cache.append(runId, JSON.stringify(chunk))
      }
    } catch {
      // The SDK translator owns error semantics (surfaces failures as chunks);
      // the transport guarantees only a terminated, cache-ended run.
    } finally {
      deps.cache.end(runId)
      const next = deps.registry.endRun(sessionId, runId)
      if (next !== undefined) startAndPump(deps, sessionId, next.message)
    }
  })()
}
