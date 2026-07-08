/**
 * M33 Phase 1 — type-tests for the ctx reconciliation contract (ADR-0044 D4 / blueprint §5.2, §8.5).
 *
 * Proves the typed `TCtx` a handler sees corresponds to the user `context.ts` factory ONLY, and that
 * the two non-middleware writers (`execute.ts:122-165` — plugin decorations + `ctx.queue`) are NOT
 * silently typed onto the route surface (which would reproduce the refuted `runtime==type` lie).
 */
import { expectTypeOf, test } from 'vitest'
import type { z } from 'zod'

import type { RouteConfig } from '../packages/theo/src/core/contracts/route-config.js'
import type {
  ContextValue,
  JobsAugmentedCtx,
  QueueClientLike,
} from '../packages/theo/src/server/http/ctx-reconciliation.js'

test('the 5-arity RouteConfig generic is preserved — TCtx is the single typed ctx slot (GAP-4)', () => {
  // The LOCKED 5-arity shape stays; reconciliation only defines WHICH writer TCtx corresponds to.
  // A handler ctx exposes exactly the 5 fields, with `ctx` = the typed run-context slot.
  type Handler = RouteConfig<z.ZodType, z.ZodType, z.ZodType, { userId: string }>['handler']
  type HandlerCtx = Parameters<Handler>[0]
  expectTypeOf<HandlerCtx>().toHaveProperty('query')
  expectTypeOf<HandlerCtx>().toHaveProperty('body')
  expectTypeOf<HandlerCtx>().toHaveProperty('params')
  expectTypeOf<HandlerCtx>().toHaveProperty('request')
  // The typed ctx slot IS the 4th generic (writer 1 — the context.ts factory value), nothing more.
  expectTypeOf<HandlerCtx['ctx']>().toEqualTypeOf<{ userId: string }>()
})

test('ContextValue is exactly the author-declared factory shape (writer 1 only)', () => {
  expectTypeOf<ContextValue<{ userId: string }>>().toEqualTypeOf<{ userId: string }>()
})

test('JobsAugmentedCtx adds queue explicitly on top of the base ctx (writer 3 is opt-in, not on TCtx)', () => {
  type Augmented = JobsAugmentedCtx<{ userId: string }>
  expectTypeOf<Augmented['queue']>().toEqualTypeOf<QueueClientLike>()
  expectTypeOf<Augmented['userId']>().toEqualTypeOf<string>()
})

test('the base typed ctx does NOT carry queue — reaching it without JobsAugmentedCtx is an error', () => {
  const assertBaseCtxHasNoQueue = (ctx: ContextValue<{ userId: string }>): void => {
    // @ts-expect-error — `queue` (writer 3) is not on the base TCtx; must use JobsAugmentedCtx.
    const _q = ctx.queue
    // @ts-expect-error — arbitrary plugin-decorated keys (writer 2) are not typed onto the route.
    const _p = ctx.somePluginKey
    expectTypeOf({ _q, _p }).toBeObject()
  }
  expectTypeOf(assertBaseCtxHasNoQueue).toBeFunction()
})
