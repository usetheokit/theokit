import type { IncomingMessage } from 'node:http'

import type { WebSocketLike } from './define-websocket.js'

export interface ChannelHandler<TMessage = unknown> {
  onSubscribe?: (ws: WebSocketLike, room: string, req: IncomingMessage) => void
  onMessage?: (ws: WebSocketLike, room: string, data: TMessage) => void
  onUnsubscribe?: (ws: WebSocketLike, room: string) => void
}

/**
 * Define a channel handler for WebSocket rooms.
 * Identity function — provides type inference for channel handlers.
 */
export function defineChannel<TMessage = unknown>(
  handler: ChannelHandler<TMessage>,
): ChannelHandler<TMessage> {
  return handler
}

/**
 * T5a.2 Phase F slice 2/3 — Web-Standards channel handler.
 *
 * Mirror of `ChannelHandler<TMessage>` for the Web `Request` shape.
 * `onSubscribe` receives `request: Request` instead of `req: IncomingMessage`
 * — the rest of the surface (onMessage, onUnsubscribe) is shape-agnostic
 * (WebSocketLike is already Web-standards-compatible per `define-websocket.ts`).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase F.
 *
 * **Architectural note:** WebSocket upgrade semantics differ across
 * runtimes:
 *   - Node: `WebSocketServer.handleUpgrade(req, socket, head, cb)` —
 *     hands you `req: IncomingMessage` at the upgrade handshake.
 *   - CF Workers: `new WebSocketPair()` + `request.headers` (the upgrade
 *     handshake IS a Web Request) — hands you `request: Request`.
 *   - Bun: `server.upgrade(request, { data })` — same Web Request shape.
 *   - Deno: `Deno.upgradeWebSocket(request)` — same Web Request shape.
 *
 * Channel handlers targeting CF/Bun/Deno use `WebChannelHandler`; legacy
 * Node consumers stay on `ChannelHandler`. Cross-runtime channels ship
 * both shapes.
 */
export interface WebChannelHandler<TMessage = unknown> {
  onSubscribe?: (ws: WebSocketLike, room: string, request: Request) => void
  onMessage?: (ws: WebSocketLike, room: string, data: TMessage) => void
  onUnsubscribe?: (ws: WebSocketLike, room: string) => void
}

/**
 * Web-Standards `defineChannel` sibling. Identity function — provides
 * type inference for Web channel handlers.
 */
export function defineWebChannel<TMessage = unknown>(
  handler: WebChannelHandler<TMessage>,
): WebChannelHandler<TMessage> {
  return handler
}
