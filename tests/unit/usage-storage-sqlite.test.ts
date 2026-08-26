/**
 * Usage survives a restart (usetheokit/theokit#459).
 *
 * `UsageStorageAdapter` is an interface so a deployment can answer "what did this tenant cost last
 * month". Every implementation in the organisation was in-memory, so no question spanning a process
 * lifetime could be answered at all — which for anything that bills, meters or caps per tenant is
 * the whole point of recording usage.
 *
 * The load-bearing test is the second one: write, close, reopen, and still get the number back.
 * Everything else here also passes against the in-memory adapter, so on its own it would prove
 * nothing about durability.
 *
 * `node:sqlite` rather than a dependency: no install time, no native build step, and the
 * alternative was adding a native driver to a framework whose install weight is itself an open
 * issue (#460).
 *
 * It is NOT available at this package's engine floor. `engines.node` says `>=22.12` and the module
 * arrived unflagged later in 22.x, so these SKIP there rather than fail — the adapter is opt-in
 * behind its own subpath, and a deployment on 22.12 uses a different one. The first version of this
 * file assumed otherwise and CI's `22.12` leg said `No such built-in module: node:sqlite`.
 *
 * The skip is deliberately narrow: only the availability of the module is conditional. If it IS
 * present, every assertion runs — a skip that swallowed a real failure would be worse than the
 * gap it covers.
 *
 * NOT covered here, and stated rather than left to be discovered: the refusal message itself. It
 * fires only where the module is absent, which is exactly where these skip. An attempt to simulate
 * the floor by intercepting module resolution did not work — `createRequire` does not route
 * builtins through the hook — and a test that appeared to prove it while proving nothing is worse
 * than this paragraph. What CI's `22.12` leg does verify is the regression that mattered: importing
 * this file no longer crashes on a runtime without `node:sqlite`.
 */

/** Does this runtime have the module at all? The floor `22.12` does not. */
const HAS_SQLITE = (() => {
  try {
    createRequire(import.meta.url)('node:sqlite')
    return true
  } catch {
    return false
  }
})()
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SqliteUsageStorage } from '../../packages/theo/src/server/cost/sqlite/index.js'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theo-usage-'))
  file = join(dir, 'usage.db')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const AT = (iso: string) => new Date(iso)

function llm(userId: string, at: string, input: number, output: number, costUsd: number) {
  return {
    kind: 'llm' as const,
    userId,
    model: 'claude-sonnet-5',
    tokens: { input, output },
    costUsd,
    timestamp: AT(at),
    conversationId: 'c1',
  }
}

const WHOLE_2026 = { from: AT('2026-01-01T00:00:00Z'), to: AT('2026-12-31T23:59:59Z') }

describe.skipIf(!HAS_SQLITE)('SqliteUsageStorage', () => {
  it('sums tokens, cost and runs for a user in a period', async () => {
    const store = new SqliteUsageStorage(file)
    await store.record(llm('u1', '2026-03-01T10:00:00Z', 100, 50, 0.001))
    await store.record(llm('u1', '2026-03-02T10:00:00Z', 200, 25, 0.002))

    expect(await store.getUsage({ userId: 'u1', period: WHOLE_2026 })).toEqual({
      totalTokens: 375,
      totalCostUsd: 0.003,
      runs: 2,
    })
    await store.dispose()
  })

  it('SURVIVES A RESTART — the whole point (#459)', async () => {
    const first = new SqliteUsageStorage(file)
    await first.record(llm('u1', '2026-03-01T10:00:00Z', 100, 50, 0.001))
    await first.dispose()

    // A different instance over the same file is what a process restart looks like.
    const second = new SqliteUsageStorage(file)
    expect(await second.getUsage({ userId: 'u1', period: WHOLE_2026 })).toEqual({
      totalTokens: 150,
      totalCostUsd: 0.001,
      runs: 1,
    })
    await second.dispose()
  })

  it('keeps tenants apart', async () => {
    const store = new SqliteUsageStorage(file)
    await store.record(llm('u1', '2026-03-01T10:00:00Z', 100, 0, 0.001))
    await store.record(llm('u2', '2026-03-01T10:00:00Z', 900, 0, 0.009))

    expect((await store.getUsage({ userId: 'u1', period: WHOLE_2026 })).totalTokens).toBe(100)
    await store.dispose()
  })

  it('respects the period boundaries, inclusive at both ends', async () => {
    const store = new SqliteUsageStorage(file)
    await store.record(llm('u1', '2026-03-01T00:00:00Z', 10, 0, 0.1))
    await store.record(llm('u1', '2026-03-31T23:59:59Z', 20, 0, 0.2))
    await store.record(llm('u1', '2026-04-01T00:00:00Z', 40, 0, 0.4)) // outside

    const march = {
      userId: 'u1',
      period: { from: AT('2026-03-01T00:00:00Z'), to: AT('2026-03-31T23:59:59Z') },
    }
    // Both edges counted, the day after excluded — the same rule the in-memory adapter applies
    // (`t < from || t > to`), so an adapter swap does not change an invoice.
    expect((await store.getUsage(march)).totalTokens).toBe(30)
    await store.dispose()
  })

  it('records a tool call without letting it reach the token totals', async () => {
    const store = new SqliteUsageStorage(file)
    await store.record(llm('u1', '2026-03-01T10:00:00Z', 100, 0, 0.001))
    await store.record({
      kind: 'tool',
      userId: 'u1',
      conversationId: 'c1',
      toolName: 'search',
      callId: 'call-1',
      success: true,
      durationMs: 42,
      timestamp: AT('2026-03-01T10:00:01Z'),
    })

    // Tools have no token or cost dimension; counting them as runs would inflate an invoice.
    expect(await store.getUsage({ userId: 'u1', period: WHOLE_2026 })).toEqual({
      totalTokens: 100,
      totalCostUsd: 0.001,
      runs: 1,
    })
    await store.dispose()
  })

  it('normalizes a legacy record with no `kind` to an LLM call (EC-9)', async () => {
    const store = new SqliteUsageStorage(file)
    const { kind: _drop, ...legacy } = llm('u1', '2026-03-01T10:00:00Z', 100, 0, 0.001)
    await store.record(legacy)

    expect((await store.getUsage({ userId: 'u1', period: WHOLE_2026 })).runs).toBe(1)
    await store.dispose()
  })
})
