/**
 * M31 Phase 3 — `route()` builder type-state guard: `.build()` is a compile error before `.handler()`.
 */
import { expectTypeOf, test } from 'vitest'
import { z } from 'zod'

import { route } from '../packages/theo/src/server/define/route-builder.js'
import type { RouteConfig } from '../packages/theo/src/core/contracts/route-config.js'

test('a complete chain resolves to RouteConfig', () => {
  const r = route()
    .body(z.object({ text: z.string() }))
    .handler(({ body }) => body.text)
    .build()
  expectTypeOf(r).toExtend<RouteConfig<z.ZodUndefined, z.ZodType>>()
})

test('build() before handler() is a compile error', () => {
  const assertGuard = () => {
    // @ts-expect-error — a route needs .handler(fn) before .build()
    route()
      .body(z.object({ n: z.number() }))
      .build()
  }
  expectTypeOf(assertGuard).toBeFunction()
})
