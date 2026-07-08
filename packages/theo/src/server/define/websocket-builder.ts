/**
 * M31 Phase 3 — `websocket()`, the fluent builder that replaces `defineWebSocket({...})`.
 *
 * Lifecycle setters (`onOpen/onMessage/onClose/onError`), all optional; `.build()` delegates to the
 * internal {@link defineWebSocket} (identity) — the ws handler loading path is UNCHANGED.
 *
 *   export default websocket()
 *     .onOpen((ws) => ws.send('hi'))
 *     .onMessage((ws, data) => ws.send(`echo:${data}`))
 *     .build()
 */
import { defineWebSocket, type WebSocketHandler } from './define-websocket.js'

/** The fluent WebSocket builder. Each lifecycle hook is optional; `.build()` returns the handler. */
export interface WebSocketBuilder {
  onOpen(fn: NonNullable<WebSocketHandler['onOpen']>): WebSocketBuilder
  onMessage(fn: NonNullable<WebSocketHandler['onMessage']>): WebSocketBuilder
  onClose(fn: NonNullable<WebSocketHandler['onClose']>): WebSocketBuilder
  onError(fn: NonNullable<WebSocketHandler['onError']>): WebSocketBuilder
  /** Resolve to the `WebSocketHandler` — the SAME value `defineWebSocket({...})` returns. */
  build(): WebSocketHandler
}

function makeWebSocketBuilder(spec: WebSocketHandler): WebSocketBuilder {
  const runtime: WebSocketBuilder = {
    onOpen: (fn) => makeWebSocketBuilder({ ...spec, onOpen: fn }),
    onMessage: (fn) => makeWebSocketBuilder({ ...spec, onMessage: fn }),
    onClose: (fn) => makeWebSocketBuilder({ ...spec, onClose: fn }),
    onError: (fn) => makeWebSocketBuilder({ ...spec, onError: fn }),
    build: () => defineWebSocket(spec),
  }
  return runtime
}

/** Start a fluent WebSocket definition. Chain any of the lifecycle hooks, then `.build()`. */
export function websocket(): WebSocketBuilder {
  return makeWebSocketBuilder({})
}
