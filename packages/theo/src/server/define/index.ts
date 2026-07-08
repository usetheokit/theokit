/**
 * Public authoring barrel — M31 builder-only API.
 *
 * The fluent builders (`route/action/websocket/middleware/tool/plugin` + `config`/`agent` elsewhere)
 * are the ONLY public authoring surface. The legacy `define*` FUNCTIONS are intentionally NOT
 * re-exported here (removed from the public API per ADR-0043 D1) — they remain as internal
 * implementation that each builder's `.build()` delegates to (imported by source path, not this
 * barrel). Their TYPES are still public (consumers annotate with `RouteConfig`, `CustomTool`, …).
 *
 * Scope boundary (ADR-0043): the 8 planned surfaces are builder-only. `defineChannel` /
 * `defineWebChannel` (M27 channels) are OUTSIDE M31's 8-surface scope and have no builder yet, so
 * they remain exported until a `channel()` builder ships (tracked as an M31 follow-up).
 */

// --- Types (public — consumers annotate with these) ---
export type { RouteConfig } from './define-route.js'
export type { ActionAccept, ActionConfig } from './define-action.js'
export type { WebSocketLike, WebSocketHandler, WebSocketHandlerWeb } from './define-websocket.js'
export type { MiddlewareHandler } from './define-middleware.js'
export type { CustomTool, ToolTransform, DefineAgentToolSpec } from './define-agent-tool.js'

// --- Fluent builders (the public authoring surface) ---
export { route, type RouteBuilder } from './route-builder.js'
export { action, type ActionBuilder } from './action-builder.js'
export { websocket, type WebSocketBuilder } from './websocket-builder.js'
export { middleware, type MiddlewareBuilder } from './middleware-builder.js'
export { tool, type ToolBuilder } from './tool-builder.js'
export { plugin, type PluginBuilder } from './plugin-builder.js'

// --- Non-define runtime utilities (kept public) ---
export { applyTransform } from './define-agent-tool.js'
export * from './ui-message-stream-response.js'

// --- Channels (M27) — outside M31's 8-surface scope, retained until channel() ships ---
export * from './define-channel.js'

// --- Reserved routes (health/ready) for the convention server ---
export * from './health-route.js'
