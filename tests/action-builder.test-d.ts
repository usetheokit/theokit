/**
 * M31 Phase 3 — `action()` builder type-state guards: input + handler required before build.
 */
import { expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { action } from '../packages/theo/src/server/define/action-builder.js'

test('build() is a compile error until BOTH .input() and .handler() are set', () => {
  const assertGuards = () => {
    // @ts-expect-error — an action needs .input() and .handler() before .build()
    action().build()

    action()
      .input(z.object({ n: z.number() }))
      // @ts-expect-error — .handler(fn) must be set before .build()
      .build()
  }
  expectTypeOf(assertGuards).toBeFunction()
})
