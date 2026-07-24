/**
 * M37 (ADR-0046) — the durable event cache behind resumable agent streams.
 *
 * As an agent turn streams over SSE, each `UIMessageChunk` frame is `append`ed
 * here keyed by a transport `runId`. A client that drops and reconnects (or a
 * second client that observes) `attach`es to the run: it replays the frames it
 * missed (`seq > Last-Event-ID`) and then follows the live tail. This is the
 * TRANSPORT half of durable agents (ADR-0040/0044) — it caches serialized
 * frames, it does NOT run the agent loop.
 *
 * Single-process by default (an in-memory `Map`, same contract as the HITL
 * `approval-registry`). A persistent backend (Redis / `ConversationStorageAdapter`)
 * plugs in behind {@link RunEventCache} for multi-instance deploys — it is NOT
 * shipped in core (ADR-0046 D4: no broker in core).
 */

/** One recorded SSE frame: its monotonic sequence id + the serialized `data:` payload. */
export interface CachedFrame {
  readonly seq: number
  readonly data: string
}

/** The result of {@link RunEventCache.attach}. */
export interface AttachResult {
  /** False when `runId` is unknown (never started, or evicted). */
  readonly known: boolean
  /** Frames with `seq > afterSeq`, in order — replay these before the live tail. */
  readonly replay: readonly CachedFrame[]
  /** True when the run already terminated: `replay` is complete, no live frames follow. */
  readonly ended: boolean
  /** Detach the live listener (idempotent). */
  readonly unsubscribe: () => void
}

/**
 * A per-`runId` ordered frame buffer with live fan-out. Implemented in-memory by
 * default; swap a persistent backend for multi-instance deploys.
 */
export interface RunEventCache {
  /**
   * M39 — synchronously register `runId` as a live (frame-less) run so `has()` is
   * true and a subscriber can `attach()` BEFORE the first frame. Idempotent.
   * Closes the race where a thread's active run is resolvable in the registry but
   * not yet in the cache (a headless pump appends its first frame asynchronously).
   */
  begin(runId: string): void
  /** Record a frame for `runId`, returning its assigned monotonic `seq`. Notifies live listeners. */
  append(runId: string, data: string): number
  /** Mark `runId` terminated: notify listeners, then schedule bounded eviction. Idempotent. */
  end(runId: string): void
  /** Whether `runId` is currently cached (started + not yet evicted). */
  has(runId: string): boolean
  /**
   * Atomically snapshot the frames after `afterSeq` AND (when the run is still
   * live) register `onFrame`/`onEnd` in the SAME synchronous tick — so no frame
   * slips between replay and subscribe, and none is duplicated.
   */
  attach(
    runId: string,
    afterSeq: number,
    onFrame: (frame: CachedFrame) => void,
    onEnd: () => void,
  ): AttachResult
}

interface Listener {
  readonly onFrame: (frame: CachedFrame) => void
  readonly onEnd: () => void
}

interface RunBuffer {
  readonly frames: CachedFrame[]
  ended: boolean
  readonly listeners: Set<Listener>
  evictTimer?: ReturnType<typeof setTimeout>
}

const DEFAULT_EVICT_AFTER_MS = 5 * 60_000 // 5 min after end (parity with approval-registry)

const NOOP_UNSUBSCRIBE = (): void => {
  // No live listener was registered (unknown or already-ended run).
}

interface RunEventCacheOptions {
  /** Milliseconds after `end()` before a run's buffer is evicted. Default 5 min. */
  readonly evictAfterMs?: number
}

export function createInMemoryRunEventCache(opts: RunEventCacheOptions = {}): RunEventCache {
  const evictAfterMs = opts.evictAfterMs ?? DEFAULT_EVICT_AFTER_MS
  const runs = new Map<string, RunBuffer>()

  function getOrCreate(runId: string): RunBuffer {
    let buf = runs.get(runId)
    if (buf === undefined) {
      buf = { frames: [], ended: false, listeners: new Set() }
      runs.set(runId, buf)
    }
    return buf
  }

  return {
    begin(runId) {
      getOrCreate(runId)
    },

    append(runId, data) {
      const buf = getOrCreate(runId)
      const seq = buf.frames.length
      const frame: CachedFrame = { seq, data }
      buf.frames.push(frame)
      // Notify live listeners (a throwing listener must not break the others).
      for (const l of buf.listeners) {
        try {
          l.onFrame(frame)
        } catch {
          /* a broken subscriber never breaks the producer or its peers */
        }
      }
      return seq
    },

    has(runId) {
      return runs.has(runId)
    },

    end(runId) {
      const buf = runs.get(runId)
      if (buf === undefined || buf.ended) return
      buf.ended = true
      for (const l of buf.listeners) {
        try {
          l.onEnd()
        } catch {
          /* isolate a broken subscriber */
        }
      }
      buf.listeners.clear()
      buf.evictTimer = setTimeout(() => runs.delete(runId), evictAfterMs)
      // Never keep the process alive just for an eviction timer.
      buf.evictTimer.unref()
    },

    attach(runId, afterSeq, onFrame, onEnd) {
      const buf = runs.get(runId)
      if (buf === undefined) {
        return { known: false, replay: [], ended: false, unsubscribe: NOOP_UNSUBSCRIBE }
      }
      // Synchronous snapshot — no `await` before the subscribe below, so no
      // append can interleave (single-threaded): no gap, no dup.
      const replay = buf.frames.filter((f) => f.seq > afterSeq)
      if (buf.ended) {
        return { known: true, replay, ended: true, unsubscribe: NOOP_UNSUBSCRIBE }
      }
      const listener: Listener = { onFrame, onEnd }
      buf.listeners.add(listener)
      return {
        known: true,
        replay,
        ended: false,
        unsubscribe: () => {
          buf.listeners.delete(listener)
        },
      }
    },
  }
}

/**
 * Process-wide singleton — the SSE encoder (`durableUiMessageStreamResponse`) and
 * the reconnect endpoint MUST share ONE cache. Lazily created; a multi-instance
 * deploy swaps this accessor for a shared-store impl (ADR-0046 D4) without
 * touching callers. Tests use {@link createInMemoryRunEventCache} directly.
 */
let serverCache: RunEventCache | undefined
export function getRunEventCache(): RunEventCache {
  serverCache ??= createInMemoryRunEventCache()
  return serverCache
}

/** Mint a stable transport `runId` (the reconnect key, ADR-0046 D2). */
export function mintRunId(): string {
  return `run-${crypto.randomUUID()}`
}
