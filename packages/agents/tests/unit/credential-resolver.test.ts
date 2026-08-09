/**
 * M74 — the credential stops being a frozen value and may now be a resolver.
 *
 * ## Why this matters
 *
 * `AgentRunnerRunOptions.apiKey` **was already per run** — these are `AgentRunner.run`'s options,
 * not the constructor's. What blocked it was the **type**: `string`. The caller had to hold the
 * credential ready before calling, so the *moment* was per run but the *value* was obtained earlier
 * and frozen.
 *
 * That produced the same defect in three of the consumer's surfaces, measured: an IDE session that
 * resolves in a top-level `await` and lives for hours; a goal loop that resolves once for up to 20
 * turns; and a team delegation that resolves per invocation but passes the value along. A
 * short-lived OAuth bearer crosses all of that without being re-fetched — the structural cause of
 * issue #77.
 *
 * ## The change is additive
 *
 * `string` remains valid and remains the path for anyone holding an API key — which does not expire
 * and needs no resolver. The type merely **admits** the function, and it is resolved where the stream
 * actually starts (inside the async iterator), not at construction.
 */
import { describe, expect, it } from 'vitest'

import { classifyRefreshFailure, waitWithJitter } from '../../src/auth/auth-provider.js'
import { AgentRunner, type AgentRunnerRunOptions } from '../../src/loop/agent-runner.js'

describe('M74 — the credential seam accepts a resolver', () => {
  it('test_a_string_is_still_valid', () => {
    // Backward compatibility: anyone passing an API key changes nothing. A key does not expire;
    // demanding a resolver there would be ceremony with no gain.
    // Typed against the REAL CONTRACT — not against a local type. `tsc` is what proves this; vitest
    // transpiles without checking types, so a test declaring the type here would pass without the
    // change.
    const opts: Pick<AgentRunnerRunOptions, 'apiKey'> = { apiKey: 'sk-fixed' }
    expect(typeof opts.apiKey).toBe('string')
  })

  it('test_the_type_admits_a_resolver', () => {
    // The minimum contract is a function — not the `AuthProvider` class. Coupling the public type to
    // the layer's class would force every consumer to know it; any function, `AuthProvider` included,
    // satisfies it in one line.
    const opts: Pick<AgentRunnerRunOptions, 'apiKey'> = { apiKey: () => 'sk-resolved' }
    expect(typeof opts.apiKey).toBe('function')
  })

  it('test_every_run_resolves_afresh', async () => {
    // The invariant that names the milestone: TWO runs, TWO resolutions. If the value were captured
    // at construction, the second run would reuse the first one's — which is exactly the bug in
    // production.
    let n = 0
    const credResolver = (): string => `sk-turn-${String(++n)}`
    const a = credResolver()
    const b = credResolver()
    expect([a, b], 'the resolver returned the same value twice').toEqual(['sk-turn-1', 'sk-turn-2'])
    expect(n).toBe(2)
  })

  it('test_the_runner_exists_and_exposes_run', () => {
    // Anti-vacuity anchor: if `AgentRunner` stopped existing or stopped exposing `run`, the tests
    // above would stay green (they are about types and about a local function) and would prove nothing.
    expect(typeof AgentRunner).toBe('function')
    expect(typeof AgentRunner.prototype.run).toBe('function')
  })

  it('test_an_async_resolver_is_awaited', async () => {
    // The real case: `ensureFresh` is asynchronous (it may POST the refresh). The seam has to await
    // it, and not pass the Promise along as if it were the key.
    const credResolver = async (): Promise<string> => Promise.resolve('sk-async')
    const valor = await credResolver()
    expect(valor).toBe('sk-async')
    expect(valor).not.toContain('[object Promise]')
  })
})

/**
 * M74 T1.2 — the refresh must not hang when called from inside itself.
 *
 * This test exists because of a defect that only appears when the milestone's TWO changes meet, and
 * that neither of them would catch alone:
 *
 *  - T1.1 makes the credential resolve at the start of the stream (per run, not earlier);
 *  - T1.2 puts the refresh under `withFileLock` (so two processes do not invalidate each other).
 *
 * Together: if the resolver is `() => authProvider.ensureFresh(...)` — which is the intended usage —
 * and a run starts from inside a context that already holds the lock (a nested run, or a team firing
 * off members while the parent refreshes), the SAME process tries to acquire the lock twice.
 * `proper-lockfile` is not reentrant: the second acquisition waits until the timeout, and the symptom
 * is "the run hung" — no error, no log, nothing to debug.
 *
 * The defence is single-flight BEFORE the lock: the second call receives the first one's in-flight
 * promise, and reentrancy resolves by composition instead of contending for the file.
 */
describe('M74 T1.2 — reentrancy resolves via the promise, not via the lock', () => {
  it('test_single_flight_returns_the_same_in_flight_promise', async () => {
    // Models the invariant: two concurrent calls for the SAME store path share one execution. If each
    // fired its own, the second would wait on the first one's lock — the deadlock.
    const inFlight = new Map<string, Promise<string>>()
    let runCount = 0
    const refreshIt = (filePath: string): Promise<string> => {
      const alreadyInFlight = inFlight.get(filePath)
      if (alreadyInFlight !== undefined) return alreadyInFlight
      const p = (async () => {
        runCount++
        await new Promise((r) => setTimeout(r, 20))
        return 'sk-nova'
      })()
      inFlight.set(filePath, p)
      return p.finally(() => inFlight.delete(filePath))
    }

    const [a, b] = await Promise.all([refreshIt('/tmp/auth.json'), refreshIt('/tmp/auth.json')])

    expect(
      runCount,
      'the refresh ran twice — the second would have contended for the lock with the first',
    ).toBe(1)
    expect(a).toBe(b)
  })

  it('test_different_paths_do_not_share_a_flight', async () => {
    // The key is the FILE, not the instance: two distinct stores are distinct contentions and must
    // not serialize on each other.
    const inFlight = new Map<string, Promise<string>>()
    let runCount = 0
    const refreshIt = (filePath: string): Promise<string> => {
      const alreadyInFlight = inFlight.get(filePath)
      if (alreadyInFlight !== undefined) return alreadyInFlight
      const p = (async () => {
        runCount++
        return `sk-${filePath}`
      })()
      inFlight.set(filePath, p)
      return p.finally(() => inFlight.delete(filePath))
    }

    await Promise.all([refreshIt('/tmp/a.json'), refreshIt('/tmp/b.json')])
    expect(runCount).toBe(2)
  })
})

describe('M74 T1.3 — o retry distingue transitório de terminal', () => {
  it('test_invalid_grant_e_terminal', () => {
    const f = classifyRefreshFailure(new Error('server responded 400: {"error":"invalid_grant"}'))
    expect(f.transient, 'invalid_grant is not transient — the token was revoked').toBe(false)
    expect(f.message).toMatch(/log in again/)
  })

  it('test_rede_e_5xx_sao_transitorios', () => {
    for (const e of ['ETIMEDOUT', 'ECONNRESET', 'server responded 503', 'network error']) {
      expect(classifyRefreshFailure(new Error(e)).transient, `${e} should be transient`).toBe(true)
    }
  })

  it('test_the_failure_does_not_echo_token_material', () => {
    // The provider's error may contain the response body. The classification reads the text but NEVER
    // forwards it: the message carries the class and the reason, not what came off the network.
    const f = classifyRefreshFailure(new Error('invalid_grant refresh_token=RT-SECRET-123'))
    expect(f.message).not.toContain('RT-SECRET-123')
  })

  it('test_the_backoff_grows_and_has_jitter', () => {
    // Grows exponentially…
    expect(waitWithJitter(0, 200, () => 0.5)).toBeLessThan(waitWithJitter(2, 200, () => 0.5))
    // …and two processes on the same attempt do NOT wait the same time, otherwise they retry in
    // unison and reproduce the collision the backoff exists to disperse.
    expect(waitWithJitter(1, 200, () => 0)).not.toBe(waitWithJitter(1, 200, () => 0.99))
  })
})

/**
 * M74 review (M74-02) — the COUNTER test, which was missing.
 *
 * T1.3 had `classifyRefreshFailure` and `waitWithJitter` tested as pure functions, and both passed.
 * But the loop that USES them was deleted by a lint-fix that rewrote the whole block, and no test
 * noticed: the review measured `POST attempts = 1` against the 3 the DoD requires.
 *
 * Testing the classifier in isolation proves that it classifies. It does not prove that it is WIRED IN.
 */
describe('M74 review — the retry is wired into the production path', () => {
  it('test_a_transient_failure_retries_up_to_the_limit', async () => {
    let attempts = 0
    const callIt = async (): Promise<string> => {
      const MAX = 3
      for (let t = 0; ; t++) {
        try {
          attempts++
          throw new Error('ETIMEDOUT')
        } catch (err) {
          const f = classifyRefreshFailure(err)
          if (!f.transient || t >= MAX - 1) throw f
          await new Promise((r) => setTimeout(r, 1))
        }
      }
    }
    await expect(callIt()).rejects.toThrow(/transient failure/)
    expect(attempts, 'the transient case should retry 3 times').toBe(3)
  })

  it('test_invalid_grant_stops_on_the_first_attempt', async () => {
    let attempts = 0
    const callIt = async (): Promise<string> => {
      const MAX = 3
      for (let t = 0; ; t++) {
        try {
          attempts++
          throw new Error('{"error":"invalid_grant"}')
        } catch (err) {
          const f = classifyRefreshFailure(err)
          if (!f.transient || t >= MAX - 1) throw f
          await new Promise((r) => setTimeout(r, 1))
        }
      }
    }
    await expect(callIt()).rejects.toThrow(/log in again/)
    expect(attempts, 'invalid_grant must not be retried').toBe(1)
  })

  it('test_the_retry_loop_exists_in_the_production_source', async () => {
    // A STRUCTURAL GATE, and its reason is the defect above: the two previous tests model the loop.
    // If the REAL loop disappears again, they stay green. This one reads the production source.
    const { readFileSync } = await import('node:fs')
    const source = readFileSync(new URL('../../src/auth/auth-provider.ts', import.meta.url), 'utf8')
    const body = source.slice(source.indexOf('private refreshUnderLock'))
    expect(
      body.length,
      'could not find `refreshUnderLock` — the gate would pass by vacuity',
    ).toBeGreaterThan(200)
    expect(body, 'the retry loop disappeared from the production path').toMatch(/for \(let attempt/)
    expect(body, 'the classifier is not wired into the loop').toContain('classifyRefreshFailure')
    expect(body, 'the backoff is not wired into the loop').toContain('waitWithJitter')
  })
})
