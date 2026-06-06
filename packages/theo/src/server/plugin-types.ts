import type { IncomingMessage, ServerResponse } from 'node:http'

export interface PluginContext {
  request: IncomingMessage
  response: ServerResponse
  ctx: Record<string, unknown>
  requestId: string
}

export interface PluginErrorContext extends PluginContext {
  error: unknown
}

export interface RunHookOptions {
  inErrorPath?: boolean
}

export interface HookResult {
  shortCircuited: boolean
}

export type OnRequestHook = (ctx: PluginContext) => void | Promise<void>
export type PreHandlerHook = (ctx: PluginContext) => void | Promise<void>
export type OnResponseHook = (ctx: PluginContext) => void | Promise<void>
export type OnErrorHook = (ctx: PluginErrorContext) => void | Promise<void>

export type HookName = 'onRequest' | 'preHandler' | 'onResponse' | 'onError'

export type HookByName<K extends HookName> = K extends 'onError'
  ? OnErrorHook
  : K extends 'onRequest'
    ? OnRequestHook
    : K extends 'preHandler'
      ? PreHandlerHook
      : K extends 'onResponse'
        ? OnResponseHook
        : never

export interface TheoApp {
  addHook<K extends HookName>(name: K, fn: HookByName<K>): void
  // `T` lets plugin authors document the per-key shape of decorations.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T documents the value type for plugin authors
  decorateRequest<T>(key: string, value: T): void
}

export interface TheoPlugin {
  name: string
  register(app: TheoApp): void | Promise<void>
}

/**
 * Identity function for plugin authors. Provides auto-completion + type
 * inference at the call site (TanStack/Vite/Astro pattern). Pure runtime
 * no-op — returns the input unchanged.
 *
 * @example
 *   import { definePlugin } from 'theokit/server'
 *   export default definePlugin({
 *     name: 'my-plugin',
 *     register(app) {
 *       app.addHook('onRequest', (req) => { ... })
 *     },
 *   })
 *
 * Equivalent to `const p: TheoPlugin = {...}` but more ergonomic. See
 * ADR-0008 (D1 + D6) for the rationale.
 */
export function definePlugin(plugin: TheoPlugin): TheoPlugin {
  return plugin
}

// ===== T5a.2 Phase F slice 1/3 — Web-Standards plugin context types =====
//
// Mirror of the IncomingMessage/ServerResponse-shaped `PluginContext` for
// the Web `Request`/`Headers` shape. Per `docs/plans/t5a2-incoming-message-
// to-request-shape-refactor-plan.md` v1.0 § Phase F.
//
// **Key difference vs IncomingMessage path:** the Web path has no
// `ServerResponse` to mutate. Plugins instead get a `responseHeaders: Headers`
// instance they can append to (e.g., add Set-Cookie, CORS headers) and the
// runtime composes the final `Response` after the hook chain runs. The
// `response` object (if any) is the in-flight Response constructed by the
// handler — present only during `onResponse` / `onError` hooks AFTER the
// handler returned, NOT during `onRequest` / `preHandler` (which fire BEFORE
// the handler runs).
//
// This split mirrors Hono's `c.res` + Fastify's `reply.headers` semantics
// — plugins mutate headers freely; the body is the handler's responsibility.

/**
 * Web-Standards plugin context. Available during all 4 hook lifecycle
 * stages (onRequest, preHandler, onResponse, onError).
 *
 * - `request` — the incoming Web Request (read-only at the runtime level;
 *   plugins can call `request.headers.get()`, `request.clone()`, etc.).
 * - `responseHeaders` — a mutable `Headers` instance the runtime threads
 *   through the hook chain. Plugins append (e.g., CORS, Set-Cookie); the
 *   final Response composes these.
 * - `response` — set to the handler's Response AFTER the handler returns.
 *   Available during `onResponse` / `onError`. `undefined` during
 *   `onRequest` / `preHandler` (which fire before the handler runs).
 * - `ctx` / `requestId` — same semantics as the IncomingMessage path.
 */
export interface WebPluginContext {
  request: Request
  responseHeaders: Headers
  response?: Response
  ctx: Record<string, unknown>
  requestId: string
}

export interface WebPluginErrorContext extends WebPluginContext {
  error: unknown
}

export type WebOnRequestHook = (ctx: WebPluginContext) => void | Promise<void>
export type WebPreHandlerHook = (ctx: WebPluginContext) => void | Promise<void>
export type WebOnResponseHook = (ctx: WebPluginContext) => void | Promise<void>
export type WebOnErrorHook = (ctx: WebPluginErrorContext) => void | Promise<void>

export type WebHookByName<K extends HookName> = K extends 'onError'
  ? WebOnErrorHook
  : K extends 'onRequest'
    ? WebOnRequestHook
    : K extends 'preHandler'
      ? WebPreHandlerHook
      : K extends 'onResponse'
        ? WebOnResponseHook
        : never

/**
 * Web-Standards `TheoApp` facade. Same `addHook` + `decorateRequest`
 * surface as the IncomingMessage path; only the hook function signatures
 * differ (they receive `WebPluginContext` instead of `PluginContext`).
 *
 * Plugin authors who target both shapes can branch on the context type
 * via a type guard (`'responseHeaders' in ctx`) OR ship two separate
 * `register()` exports — one for each runtime adapter. Most plugins
 * register hooks at the IncomingMessage path today (legacy); future
 * Web-native plugins will register against `WebTheoApp`.
 */
export interface WebTheoApp {
  addHook<K extends HookName>(name: K, fn: WebHookByName<K>): void
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T documents the value type for plugin authors
  decorateRequest<T>(key: string, value: T): void
}

/**
 * Web-Standards plugin shape. Identical to `TheoPlugin` except the
 * `register(app)` argument is `WebTheoApp` instead of `TheoApp`.
 *
 * Cross-runtime plugins ship BOTH `TheoPlugin` + `WebTheoPlugin` exports;
 * the adapter (Node, CF Workers, Bun, Deno) picks the matching one based
 * on which runtime executes the plugin chain. This is the canonical
 * Hono/Nitro pattern.
 */
export interface WebTheoPlugin {
  name: string
  register(app: WebTheoApp): void | Promise<void>
}

/**
 * Identity function for Web plugin authors — same auto-completion +
 * type-inference DX as `definePlugin`, but for the Web-shaped `WebTheoApp`.
 */
export function defineWebPlugin(plugin: WebTheoPlugin): WebTheoPlugin {
  return plugin
}
