/**
 * An app that writes a plugin can import the types of what it is writing (#575).
 *
 * They existed and were unexported from `theokit/server/define`, which a probe compiled inside a
 * real app's own tsconfig reported precisely:
 *
 *     TS2459: Module 'theokit/server/define' declares 'TheoPlugin' locally, but it is not exported.
 *     TS2305: Module 'theokit/server/define' has no exported member 'PreHandler'.
 *
 * TS2459 is the interesting one — the type is there and deliberately withheld. So the app declared
 * structural copies:
 *
 *     interface HookContext { request: Request; ctx: Record<string, unknown> }
 *     interface PluginApp { addHook(name: 'preHandler', fn: (c: HookContext) => …): void }
 *
 * Those compile, because structural typing does not care, and they keep compiling after the
 * framework's shape changes — until something fails at runtime. A copied type stops tracking what it
 * describes, silently, which is the whole cost.
 *
 * This is a type-level contract, so it is asserted with `expectTypeOf` rather than at runtime: a
 * `typeof x === 'undefined'` check cannot see an unexported type at all.
 */
import { describe, expectTypeOf, it } from 'vitest'

import type {
  HookName,
  OnErrorHook,
  OnRequestHook,
  OnResponseHook,
  PluginContext,
  PluginErrorContext,
  PreHandlerHook,
  TheoPlugin,
} from '../../packages/theo/src/server/define/index.js'

describe('the plugin authoring surface is importable (#575)', () => {
  it('a plugin can be typed by the framework rather than by a copy', () => {
    // The exact shape the reporting app hand-rolled. Written against the real types, it now fails to
    // compile if the framework's shape moves — which is what the copy could never do.
    const identityPlugin: TheoPlugin = {
      name: 'app-identity',
      register(app) {
        app.addHook('preHandler', (ctx) => {
          expectTypeOf(ctx).toEqualTypeOf<PluginContext>()
        })
      },
    }

    expectTypeOf(identityPlugin).toEqualTypeOf<TheoPlugin>()
  })

  it('a standalone hook can be typed, which is the case `plugin()` does not cover', () => {
    // `plugin()` is the preferred surface and wraps the hook seam. A hook written as its own
    // function — passed around, tested in isolation, shared between plugins — still needs a name for
    // its own signature.
    const preHandler: PreHandlerHook = (ctx) => {
      expectTypeOf(ctx).toEqualTypeOf<PluginContext>()
    }
    const onRequest: OnRequestHook = () => {}
    const onResponse: OnResponseHook = () => {}
    const onError: OnErrorHook = (ctx) => {
      expectTypeOf(ctx).toEqualTypeOf<PluginErrorContext>()
    }

    expectTypeOf(preHandler).toBeFunction()
    expectTypeOf(onRequest).toBeFunction()
    expectTypeOf(onResponse).toBeFunction()
    expectTypeOf(onError).toBeFunction()
  })

  it('the hook names are a union, so a typo is a compile error rather than a dead hook', () => {
    expectTypeOf<HookName>().toEqualTypeOf<'onRequest' | 'preHandler' | 'onResponse' | 'onError'>()
  })

  it('an error hook context carries what a plain one does, plus the error', () => {
    // Asserted because the app's copy conflated the two, and the difference is the only reason
    // `onError` has its own type.
    expectTypeOf<PluginErrorContext>().toExtend<PluginContext>()
  })
})
