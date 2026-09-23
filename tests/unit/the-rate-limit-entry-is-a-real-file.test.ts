import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildRateLimiter } from '../../packages/theo/src/server/rate-limit/build-rate-limiter.js'
import type { RateLimitStore } from '../../packages/theo/src/server/rate-limit/rate-limit-store.js'

/**
 * B-262 / T1.2 — the correction the brief's 2026-09-23 amendment records.
 *
 * The first design moved the import INSIDE the emitted string, from `theokit/server/rate-limit` to a
 * virtual id, and claimed that gave `tsc` sight of the symbol. Measured while implementing it: the
 * entry is a 215-line string returned by `renderCloudflareWorkerEntry`, and `tsconfig.json` includes
 * the package-source include pattern — source, never build output. **No string is type-checked, whatever its
 * import says.**
 *
 * For the compiler to see the symbol, the file has to BE a file. That is what the reference
 * implementations do — one injects a real `.js` module, another ships a real 28-line `.ts` preset
 * entry — and reading the technique without noticing that half of it is what produced the first
 * design.
 *
 * The first test is the one that matters, and it asserts a property of the BUILD rather than of the
 * code: this file sits under a `tsconfig` include pattern. Everything else here rests on it.
 */
describe('the rate-limit entry is a real file (B-262, T1.2)', () => {
  it('test_the_entry_file_is_covered_by_the_typecheck', () => {
    // Read the include patterns rather than trusting that they cover this path. A file moved out
    // from under them would keep every other test in this file green while silently undoing the
    // whole point of the task.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const raw = readFileSync(join(root, 'tsconfig.json'), 'utf8')
    const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '')) as { include: string[] }

    expect(
      config.include,
      'tsconfig no longer includes package source; the entry file would stop being type-checked',
    ).toContain('packages/*/src/**/*.ts')
  })

  it('test_it_builds_a_durable_limiter_when_a_store_is_supplied', async () => {
    const calls: string[] = []
    const store: RateLimitStore = {
      incr: (key) => {
        calls.push(key)
        return Promise.resolve({ count: 1, resetAt: Date.now() + 60_000 })
      },
      get: () => Promise.resolve(null),
      reset: () => Promise.resolve(),
    }

    const limit = buildRateLimiter({ windowMs: 60_000, max: 5 }, store)
    const result = await limit('1.2.3.4')

    expect(calls, 'the durable path did not reach the store').toEqual(['1.2.3.4'])
    expect(result.limited).toBe(false)
  })

  it('test_it_falls_back_to_the_in_process_limiter_with_no_store', async () => {
    // A target with a long-lived process keeps its in-process counter, which is why `node` and `bun`
    // declare `enforcesRateLimit: 'always'`. The fallback is not a degradation there.
    const limit = buildRateLimiter({ windowMs: 60_000, max: 1 }, undefined)

    expect((await limit('9.9.9.9')).limited, 'first request inside the budget').toBe(false)
    expect((await limit('9.9.9.9')).limited, 'second request over the budget').toBe(true)
  })
})
