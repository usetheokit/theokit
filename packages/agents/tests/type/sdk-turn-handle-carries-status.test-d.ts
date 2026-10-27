/**
 * B-413 (FR-005) — what `SdkTurnHandle.wait` resolves declares `status` and `error`.
 *
 * The SDK's eval runner reads `status` off the resolved turn and counts a row as finished only when
 * it is `'finished'`; any other value records `error?.message ?? 'run <status>'`
 * (`@theokit/sdk/dist/eval.js`, `executeAgent`). A handle written against a turn type without those
 * fields gives the runner nothing to read, and every row errors with `run undefined`.
 *
 * COMPILE-TIME assertions: `tsc -p packages/agents/tsconfig.test.json --noEmit` fails while either
 * field is missing: `toHaveProperty` on a key the type does not declare is a type error.
 */
import { describe, expectTypeOf, it } from 'vitest'

import type { SdkTurnHandle } from '../../src/bridge/sdk-adapter.js'

type ResolvedTurn = Awaited<ReturnType<SdkTurnHandle['wait']>>

describe('SdkTurnHandle', () => {
  it('resolves an optional status the SDK eval runner reads', () => {
    expectTypeOf<ResolvedTurn>().toHaveProperty('status').toEqualTypeOf<string | undefined>()
  })

  it('resolves an optional error carrying a message', () => {
    expectTypeOf<ResolvedTurn>()
      .toHaveProperty('error')
      .toEqualTypeOf<{ message: string } | undefined>()
  })
})
