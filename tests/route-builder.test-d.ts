/**
 * M31 Phase 3 — `route()` builder type-state guard: `.build()` is a compile error before `.handler()`.
 */
import { expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { route } from '../packages/theo/src/server/define/route-builder.js'
import type { RouteConfig } from '../packages/theo/src/core/contracts/route-config.js'
import type { RouteContext } from '../packages/theo/src/core/contracts/route-context.js'

test('a complete chain resolves to RouteConfig', () => {
  const r = route()
    .body(z.object({ text: z.string() }))
    .handler(({ body }) => body.text)
    .build()
  expectTypeOf(r).toExtend<RouteConfig<z.ZodUndefined, z.ZodType>>()
})

test('build() before handler() is a compile error', () => {
  const assertGuard = () => {
    route()
      .body(z.object({ n: z.number() }))
      // @ts-expect-error — a route needs .handler(fn) before .build()
      .build()
  }
  expectTypeOf(assertGuard).toBeFunction()
})

// usetheokit/theokit#1073 — the handler's ctx was `unknown`, so `ctx.queue` was TS18046 in every
// route. It is the augmentable RouteContext: undeclared keys read as `unknown`, and a key an app
// declares on RouteContext (the scaffold's `types/jobs.d.ts` declares `queue`) is typed.
test('the handler ctx is RouteContext, whose undeclared keys are unknown', () => {
  route()
    .policy('public')
    .handler(({ ctx }) => {
      expectTypeOf(ctx).toEqualTypeOf<RouteContext>()
      expectTypeOf(ctx.anyKeyNobodyDeclared).toBeUnknown()
      return null
    })
    .build()
})
