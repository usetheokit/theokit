/**
 * M31 Phase 3 — `plugin()`, the fluent builder that replaces `definePlugin({...})`.
 *
 * Collects lifecycle hooks + request decorations and SYNTHESIZES the `register(app)` function, so
 * authors never write the imperative `register` body. `.build()` returns a `TheoPlugin` the plugin
 * runner consumes UNCHANGED.
 *
 *   export default plugin('request-id')
 *     .onRequest((ctx) => { ctx.ctx.requestId = crypto.randomUUID() })
 *     .onResponse((ctx) => { ctx.response.setHeader('x-request-id', String(ctx.ctx.requestId)) })
 *     .build()
 */
import {
  definePlugin,
  type TheoPlugin,
  type TheoApp,
  type OnRequestHook,
  type PreHandlerHook,
  type OnResponseHook,
  type OnErrorHook,
} from '../plugin-types.js'

/** The fluent plugin builder. `name` is set at entry; every hook is optional and may repeat. */
export interface PluginBuilder {
  /** Register an `onRequest` hook (runs before the CSRF gate). May be called multiple times. */
  onRequest(fn: OnRequestHook): PluginBuilder
  /** Register a `preHandler` hook (after CSRF, before the route handler). */
  preHandler(fn: PreHandlerHook): PluginBuilder
  /** Register an `onResponse` hook (after the handler returns). */
  onResponse(fn: OnResponseHook): PluginBuilder
  /** Register an `onError` hook (error path). */
  onError(fn: OnErrorHook): PluginBuilder
  /** Decorate every request with a key/value pair (available on `ctx.ctx[key]`). */
  decorateRequest<T>(key: string, value: T): PluginBuilder
  /** Resolve to the `TheoPlugin` — a synthesized `{ name, register }` the runner consumes. */
  build(): TheoPlugin
}

interface PluginSpecAccumulator {
  name: string
  onRequest: OnRequestHook[]
  preHandler: PreHandlerHook[]
  onResponse: OnResponseHook[]
  onError: OnErrorHook[]
  decorations: { key: string; value: unknown }[]
}

function makePluginBuilder(spec: PluginSpecAccumulator): PluginBuilder {
  const runtime: PluginBuilder = {
    onRequest: (fn) => makePluginBuilder({ ...spec, onRequest: [...spec.onRequest, fn] }),
    preHandler: (fn) => makePluginBuilder({ ...spec, preHandler: [...spec.preHandler, fn] }),
    onResponse: (fn) => makePluginBuilder({ ...spec, onResponse: [...spec.onResponse, fn] }),
    onError: (fn) => makePluginBuilder({ ...spec, onError: [...spec.onError, fn] }),
    decorateRequest: (key, value) =>
      makePluginBuilder({ ...spec, decorations: [...spec.decorations, { key, value }] }),
    build: () =>
      definePlugin({
        name: spec.name,
        register(app: TheoApp): void {
          for (const fn of spec.onRequest) app.addHook('onRequest', fn)
          for (const fn of spec.preHandler) app.addHook('preHandler', fn)
          for (const fn of spec.onResponse) app.addHook('onResponse', fn)
          for (const fn of spec.onError) app.addHook('onError', fn)
          for (const d of spec.decorations) app.decorateRequest(d.key, d.value)
        },
      }),
  }
  return runtime
}

/** Start a fluent plugin definition. `name` is required; chain hooks/decorations, then `.build()`. */
export function plugin(name: string): PluginBuilder {
  return makePluginBuilder({
    name,
    onRequest: [],
    preHandler: [],
    onResponse: [],
    onError: [],
    decorations: [],
  })
}
