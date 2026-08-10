/**
 * T2.3 (architecture-medium-deferrals plan, ADR D2) — WebSocket upgrade
 * handler extracted from `vite-plugin/index.ts` for SRP.
 *
 * `setupWsUpgrade(server, serverDir)` scans `<serverDir>/ws/*` and attaches an
 * upgrade handler to `server.httpServer`. Lazy-imports the `ws` package so
 * non-WS apps don't pay the cost.
 *
 * **#95:** it receives the ALREADY RESOLVED `serverDir`, instead of deriving
 * `resolve(projectRoot, 'server')`. #95 was fixed in route-serving, in the typed client, in actions
 * and in HMR, and this point was left behind — in a project with `serverDir: 'core'` the HTTP routes
 * started being found and the WebSocket ones did not. A partial fix is worse than the whole failure:
 * it makes the option look like it works.
 *
 * **EC-1 (architecture-medium-deferrals plan v1.1 MUST FIX):** must tolerate
 * `server.httpServer === null` (Vite middleware mode — embed in Express/etc).
 * Without the guard, dev embeds crash on plugin init. The function exits
 * silently when no httpServer is available; consumer can wire their own.
 *
 * Mirrors the prod surface in `cli/commands/start-websocket-handler.ts` —
 * same `onOpen`/`onMessage`/`onClose`/`onError` handler shape (EC-6 parity).
 */

import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

import type { ViteDevServer } from 'vite'

// A direct import of the scanner, not of the `internal-api.js` barrel: the barrel drags the entire
// server graph (csrf, actions, controllers) into the dev plugin, which needs ONE function. Beyond the
// cost, it was what stopped this unit from being exercised in isolation.
import { scanWebSocketRoutes } from '../server/scan/ws-scan.js'

interface WsHandler {
  onOpen?: (ws: unknown, request: unknown) => void | Promise<void>
  onMessage?: (ws: unknown, data: string) => void | Promise<void>
  onClose?: (ws: unknown, code: number, reason: Buffer) => void | Promise<void>
  onError?: (ws: unknown, err: Error) => void | Promise<void>
}

export function setupWsUpgrade(server: ViteDevServer, serverDir: string): void {
  const wsRoutes = scanWebSocketRoutes(serverDir)
  if (wsRoutes.length === 0) return

  // EC-1 — middleware-mode Vite has no httpServer. Silently skip; the host
  // platform owns its own upgrade routing in that case.
  const wsHttpServer = server.httpServer
  if (!wsHttpServer) return

  // Lazy-import `ws` so non-WS apps don't pay the cost.
  void import('ws')
    .then(({ WebSocketServer }) => {
      const wss = new WebSocketServer({ noServer: true })

      wsHttpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        void (async () => {
          const url = request.url ?? '/'
          if (!url.startsWith('/ws/')) return // Let Vite handle HMR etc.

          const wsPath = url.split('?')[0]
          const match = wsRoutes.find((r) => r.wsPath === wsPath)
          if (!match) {
            socket.destroy()
            return
          }

          try {
            const mod = await server.ssrLoadModule(match.filePath)
            const handler = ((mod as { default?: unknown }).default ?? mod) as WsHandler

            wss.handleUpgrade(request, socket, head, (ws) => {
              void handler.onOpen?.(ws, request)
              ws.on('message', (data: Buffer) => {
                void handler.onMessage?.(ws, data.toString())
              })
              ws.on('close', (code: number, reason: Buffer) => {
                void handler.onClose?.(ws, code, reason)
              })
              ws.on('error', (err: Error) => {
                void handler.onError?.(ws, err)
              })
            })
          } catch {
            socket.destroy()
          }
        })()
      })
    })
    .catch(() => {
      console.warn(
        '[Theo] WebSocket routes found but "ws" package not installed. Run: npm install ws',
      )
    })
}
