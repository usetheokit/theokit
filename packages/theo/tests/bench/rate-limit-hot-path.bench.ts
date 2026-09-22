/**
 * B-027 — what the limiter costs on the path it was just put on.
 *
 * The change under audit places a rate-limit check in front of EVERY request of every deployed
 * entry, and adds an address resolution before it. Both are now per-request work that did not
 * exist, so "does it cost anything?" is a question with a number, not an opinion.
 *
 * Written in the shape of `packages/agents/tests/bench/guardrails.bench.ts`, whose header states
 * the same reason: measure the real per-call overhead so a claim is backed by data.
 *
 * What this does NOT measure: the cost inside a real runtime. This is the pure-JS work on the hot
 * path, isolated from I/O, which is the half a benchmark can honestly establish.
 */
import { bench, describe } from 'vitest'

import { createRateLimiterWeb } from '../../src/server/rate-limit/rate-limit.js'
import { resolveClientIpFromRequest } from '../../src/server/rate-limit/client-ip.js'

const WIDE = { windowMs: 60_000, max: 1_000_000_000 } as const

/** One caller, always under budget — the ordinary case, and the one that runs on every request. */
const oneCaller = createRateLimiterWeb(WIDE)

/** Many callers: the map grows, so this is the case where the store's shape starts to matter. */
const manyCallers = createRateLimiterWeb(WIDE)
const ADDRESSES = Array.from({ length: 10_000 }, (_, i) => `203.0.113.${i % 256}:${i}`)
let cursor = 0

const DIRECT = new Request('https://app.test/api/thing')
const FORWARDED = new Request('https://app.test/api/thing', {
  headers: { 'x-forwarded-for': '203.0.113.9, 198.51.100.7, 198.51.100.8' },
})

describe('rate-limit check (per request, in-memory store)', () => {
  bench('one caller, under budget', () => {
    oneCaller('203.0.113.9')
  })

  bench('10 000 distinct callers, round-robin', () => {
    manyCallers(ADDRESSES[cursor++ % ADDRESSES.length]!)
  })
})

describe('address resolution (per request)', () => {
  bench('no forwarded header — the direct case', () => {
    resolveClientIpFromRequest(DIRECT, false)
  })

  bench('forwarded chain of three, trustProxy=1', () => {
    resolveClientIpFromRequest(FORWARDED, 1)
  })
})
