import type { IncomingMessage } from 'node:http'

export interface WebSocketLike {
  send(data: string | Buffer): void
  close(code?: number, reason?: string): void
}

export interface WebSocketHandler {
  onOpen?: (ws: WebSocketLike, req: IncomingMessage) => void
  onMessage?: (ws: WebSocketLike, data: string | Buffer) => void
  onClose?: (ws: WebSocketLike, code: number, reason: Buffer) => void
  onError?: (ws: WebSocketLike, error: Error) => void
}

/**
 * Define a WebSocket endpoint handler.
 * Identity function — provides type inference for WebSocket handlers.
 */
export function defineWebSocket(handler: WebSocketHandler): WebSocketHandler {
  return handler
}

/**
 * T5a.2 Phase F slice 3/3 — Web-Standards WebSocket endpoint handler.
 *
 * Mirror of `WebSocketHandler` for the Web `Request` shape. `onOpen`
 * receives `request: Request` instead of `req: IncomingMessage`. The
 * rest of the lifecycle (onMessage, onClose, onError) is shape-agnostic
 * (`WebSocketLike` is already Web-standards-compatible per the existing
 * design — `send(string | Buffer)` works on both Node `ws` and Web
 * `WebSocket` instances; CF Workers / Bun / Deno coerce as needed at
 * the adapter boundary).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase F (closes Phase F).
 *
 * **Architectural note — WebSocket upgrade semantics differ across runtimes:**
 *   - Node + `ws`: `WebSocketServer.handleUpgrade(req, socket, head, cb)` —
 *     `req` is `IncomingMessage`. Use `WebSocketHandler`.
 *   - CF Workers: `new WebSocketPair()` + `request.headers` (the upgrade
 *     handshake IS a Web Request). Use `WebSocketHandlerWeb`.
 *   - Bun: `server.upgrade(request, { data })` — same Web Request shape.
 *   - Deno: `Deno.upgradeWebSocket(request)` — same Web Request shape.
 *
 * Cross-runtime WebSocket endpoints ship BOTH `WebSocketHandler` +
 * `WebSocketHandlerWeb` exports; the runtime adapter picks the matching
 * one. This is the canonical Hono / Nitric pattern.
 */
export interface WebSocketHandlerWeb {
  onOpen?: (ws: WebSocketLike, request: Request) => void
  onMessage?: (ws: WebSocketLike, data: string | Uint8Array) => void
  onClose?: (ws: WebSocketLike, code: number, reason: string) => void
  onError?: (ws: WebSocketLike, error: Error) => void
}

/**
 * Web-Standards `defineWebSocket` sibling. Identity function — provides
 * type inference for Web WebSocket handlers.
 *
 * **Type difference note vs Node path:**
 *   - `onMessage` data is `string | Uint8Array` instead of `string | Buffer`
 *     (Web standards have no `Buffer`; Node's Buffer is a Uint8Array
 *     subclass so the Node path's Buffer values flow through unchanged
 *     when adapters wrap them).
 *   - `onClose` reason is `string` instead of `Buffer` (Web `CloseEvent`
 *     exposes the reason as a UTF-8 string natively).
 */
export function defineWebSocketWeb(handler: WebSocketHandlerWeb): WebSocketHandlerWeb {
  return handler
}
