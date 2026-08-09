/**
 * M103 (agent-builder) — `Agent.list` re-exported by `@theokit/agents` NARROWS the SDK signature:
 * `limit` and `cursor` are ACCEPTED by the SDK's type and IGNORED by its runtime, so asking for a
 * page is a latent silent-truncation bug. These are COMPILE-TIME assertions:
 * `npx tsc --noEmit -p packages/agents/tsconfig.test.json` fails if any `@ts-expect-error` line
 * stops erroring (the guard regressed).
 *
 * The POSITIVE cases are as load-bearing as the negative ones: a narrowing that forbade EVERYTHING
 * would pass a suite made only of `@ts-expect-error`, and it would be a breaking change dressed as
 * a guard.
 */
import { expectTypeOf } from 'vitest'

import { Agent } from '../../src/index.js'

// ── 1. Paging parameters no longer compile (the guard) ────────────────────────────────────────
{
  // @ts-expect-error — `limit` is ignored by the runtime; asking for a page is a latent bug (M103).
  void Agent.list({ runtime: 'local', limit: 1 })

  // @ts-expect-error — `cursor` is ignored by the runtime; the caller would loop forever (M103).
  void Agent.list({ runtime: 'local', cursor: 'x' })
}

// ── 2. The RESULT no longer promises a cursor (nobody can branch on a lie) ────────────────────
{
  const r = await Agent.list({ runtime: 'local' })
  // The narrowed result has no `nextCursor`: the runtime never sets one, so a caller branching on
  // it branches on a value that cannot arrive.
  type HasCursor = 'nextCursor' extends keyof typeof r ? true : false
  expectTypeOf<HasCursor>().toEqualTypeOf<false>()
  expectTypeOf(r.items).toBeArray()
}

// ── 3. POSITIVE — the calls we actually make still compile ─────────────────────────────────────
{
  void Agent.list()
  void Agent.list({ runtime: 'local' })
  void Agent.list({ runtime: 'local', cwd: '/tmp/x' })
  void Agent.list({ runtime: 'cloud', includeArchived: true })
}

// ── 4. POSITIVE (MF-3) — every OTHER member of `Agent` keeps its shape ────────────────────────
// `Omit<typeof Agent, 'list'>` drops construct signatures and could silently break a published
// package. `Agent`'s constructor is `private` in the SDK (index.d.ts:483), so no external caller
// constructs it — but the statics MUST all survive, and that is what this block proves.
{
  expectTypeOf(Agent.create).toBeFunction()
  expectTypeOf(Agent.getOrCreate).toBeFunction()
  expectTypeOf(Agent.get).toBeFunction()
  expectTypeOf(Agent.delete).toBeFunction()
  expectTypeOf(Agent.archive).toBeFunction()
  expectTypeOf(Agent.unarchive).toBeFunction()
  expectTypeOf(Agent.rename).toBeFunction()
  expectTypeOf(Agent.compact).toBeFunction()
  expectTypeOf(Agent.listRuns).toBeFunction()
  expectTypeOf(Agent.getRun).toBeFunction()
  expectTypeOf(Agent.registry).not.toBeUndefined()
}
