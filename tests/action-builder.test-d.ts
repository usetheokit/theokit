/**
 * M31 Phase 3 — `action()` builder type-state guards: input + handler required before build.
 */
import { expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { action } from '../packages/theo/src/server/define/action-builder.js'
import { defineAction } from '../packages/theo/src/server/define/define-action.js'
import type { RouteContext } from '../packages/theo/src/core/contracts/route-context.js'

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

// usetheokit/theokit#1096 — an action handler's ctx was `unknown`, so `ctx.queue` was TS18046 in
// every action, the same defect #1073 fixed for routes. Actions now get the route's ctx type.
test('the action handler ctx is RouteContext, whose undeclared keys are unknown', () => {
  action()
    .input(z.object({ n: z.number() }))
    .handler(({ ctx }) => {
      expectTypeOf(ctx).toEqualTypeOf<RouteContext>()
      expectTypeOf(ctx.anyKeyNobodyDeclared).toBeUnknown()
      return null
    })
    .build()
})

test('defineAction defaults its ctx to RouteContext too', () => {
  const config = defineAction({ input: z.object({ n: z.number() }), handler: ({ ctx }) => ctx })
  expectTypeOf(config.handler).returns.toEqualTypeOf<unknown>()
  expectTypeOf<Parameters<typeof config.handler>[0]['ctx']>().toEqualTypeOf<RouteContext>()
})
