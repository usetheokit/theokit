/**
 * T2.1 — RateLimitStore interface.
 *
 * Pluggable backend for the rate limiter. The default `InMemoryStore`
 * preserves current single-instance behavior. Multi-instance deployments
 * (TheoCloud canary, K8s replicas) opt in to a distributed adapter
 * (Redis, Cloudflare KV) without bloating single-instance apps.
 *
 * Contract per ADR D1:
 *   - `incr` is atomic — concurrent calls for the same key both observe
 *     the same `resetAt` and increment count by 1.
 *   - `get` returns `null` for expired entries (not just absent — checks
 *     `now > resetAt`).
 *   - `reset` removes the key entirely; next `incr` creates fresh.
 *
 * Async signature is honest about Redis adapters even though in-memory
 * implementation is synchronous. Callers MUST await.
 */

export interface RateLimitState {
  /** Number of requests counted in the current window. */
  count: number
  /** Absolute timestamp (ms since epoch) when this window expires. */
  resetAt: number
  /**
   * B-261 — how many requests the window BEFORE this one admitted, when the store can say.
   *
   * Optional, and the optionality IS the compatibility line: a third-party store returning only
   * `{ count, resetAt }` keeps working with the behaviour it already had rather than breaking. A store
   * that supplies this gets a sliding window instead of a fixed one.
   *
   * Why it is needed: with `resetAt` pinned at the first request of a window, filling the window late
   * and the next one early spends two budgets inside one window's worth of time. Measured before the
   * fix — `windowMs: 400, max: 5` admitted 10 in ~405ms, a factor of exactly 2.
   */
  previousCount?: number
}

/**
 * A durable store named at BUILD time, for an adapter to construct in a generated entry.
 *
 * B-257 — NOT a `RateLimitStore`. It has no methods, nothing calls it, and it exists only as text
 * an adapter bakes into a generated entry: `config/schemas/rate-limit.ts` accepts it,
 * `adapters/deployed-rate-limit.ts` emits it, and `createDurableRateLimiterWeb` receives the store
 * the generated code constructed from it.
 *
 * It lives beside `RateLimitStore` because the two share a config key and a reader meeting one
 * must be able to see the other. Declared once: the same shape was written inline in two modules
 * before this, and two copies of one type diverge on the first change to either.
 */
export interface BakedStoreDeclaration {
  module: string
  factory: string
  options?: Record<string, string | number | boolean>
}

export interface RateLimitStore {
  /**
   * Atomic increment-and-get. If the key is missing OR the previous
   * window expired (`now >= resetAt`), create with `count=1, resetAt=now+windowMs`.
   * Otherwise increment count by 1, preserving the original resetAt.
   */
  incr(key: string, windowMs: number): Promise<RateLimitState>

  /** Read current state. Returns `null` for missing or expired entries. */
  get(key: string): Promise<RateLimitState | null>

  /** Remove a key. Used by login throttling on success (T6.1). */
  reset(key: string): Promise<void>
}

/**
 * Default in-memory store. Backed by `Map<string, RateLimitState>`.
 *
 * GC: every 1000 `incr` calls, expired entries are removed. Pathological
 * key explosion is bounded by `MAX_ENTRIES` (LRU-evict oldest insertion).
 *
 * Single-thread by virtue of Node's event loop — `incr` is atomic at the
 * JavaScript level (no preemption between Map.get and Map.set).
 */
export class InMemoryStore implements RateLimitStore {
  private store = new Map<string, RateLimitState>()
  /** Bound the map to prevent unbounded growth from pathological inputs. */
  static readonly MAX_ENTRIES = 100_000
  /** GC sweep interval, milliseconds. */
  static readonly GC_INTERVAL_MS = 30_000

  private gcTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    // CR-007 fix: GC runs on a timer OUTSIDE the request hot path.
    // Pre-fix, every 1000th `incrSync` triggered a synchronous Map sweep
    // of up to 100K entries — an attacker with diverse client IPs could
    // keep the Map full and force a blocking sweep predictably.
    if (typeof setInterval !== 'undefined') {
      const timer = setInterval(() => {
        this.sweepExpired()
      }, InMemoryStore.GC_INTERVAL_MS)
      this.gcTimer = timer
      // Allow the process to exit even with the timer pending. `unref` is
      // Node-only; not present on browser/Cloudflare `setInterval`.
      const maybeUnref = (timer as { unref?: () => void }).unref
      if (typeof maybeUnref === 'function') maybeUnref.call(timer)
    }
  }

  /**
   * Synchronous fast-path used by the legacy sync `createRateLimiter`
   * surface (`api-middleware.ts` is sync). The async `incr` delegates to
   * this for in-memory; external adapters override `incr` directly.
   */
  incrSync(key: string, windowMs: number): RateLimitState {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new Error(
        `InMemoryStore.incr: windowMs must be a positive finite number (got ${windowMs})`,
      )
    }
    const now = Date.now()

    // Bounded LRU-ish: when over cap, drop oldest insertion.
    if (this.store.size >= InMemoryStore.MAX_ENTRIES) {
      const first = this.store.keys().next().value
      if (first !== undefined) this.store.delete(first)
    }

    const entry = this.store.get(key)
    if (!entry || now >= entry.resetAt) {
      // B-261 — the expiring window's count is carried forward rather than discarded. Without it the
      // limiter cannot tell a caller arriving fresh from one that just spent a full budget, which is
      // the whole of the boundary burst.
      const fresh = {
        count: 1,
        resetAt: now + windowMs,
        previousCount: entry === undefined ? 0 : entry.count,
      }
      this.store.set(key, fresh)
      return { ...fresh }
    }
    entry.count++
    // B-261 — `previousCount` travels with EVERY answer, not only the one that opened the window. It
    // was returned by the branch above and dropped here at first, so the weighting applied to the
    // first request of a window and to nothing after it: 10 admitted became 9 instead of 5.
    return { count: entry.count, resetAt: entry.resetAt, previousCount: entry.previousCount }
  }

  /** Sweep expired entries. Called by the GC timer; safe to call manually. */
  sweepExpired(): void {
    const now = Date.now()
    for (const [k, v] of this.store) {
      if (v.resetAt <= now) this.store.delete(k)
    }
  }

  /**
   * Stop the GC timer. Call from tests or when discarding the store. After
   * `dispose`, the store still works but no longer auto-sweeps.
   */
  dispose(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer)
      this.gcTimer = null
    }
  }

  // The async surface is required by the `RateLimitStore` interface
  // (Redis/etc. adapters are inherently async). For the in-memory case
  // we just adapt the sync implementations to Promises.
  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract: async return
  async incr(key: string, windowMs: number): Promise<RateLimitState> {
    return this.incrSync(key, windowMs)
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract: async return
  async get(key: string): Promise<RateLimitState | null> {
    const now = Date.now()
    const entry = this.store.get(key)
    if (!entry) return null
    if (now >= entry.resetAt) return null
    return { count: entry.count, resetAt: entry.resetAt }
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- interface contract: async return
  async reset(key: string): Promise<void> {
    this.store.delete(key)
  }
}
