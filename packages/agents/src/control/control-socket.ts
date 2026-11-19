/**
 * A session store served over an authenticated WebSocket: chat, interrupt and steer frames map onto
 * the store's sessions, and a closed socket cancels the turns it started.
 *
 * Ported from TheoClaw's control socket. `ws` is an optional peer, loaded when this is called.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import { createRequire } from 'node:module'
import type { Duplex } from 'node:stream'

import type { WebSocket, WebSocketServer } from 'ws'

import { parseControlFrame, type ControlServerFrame } from './frames.js'
import type { SessionStore } from './session-store.js'

export interface ControlSocketOptions {
  /** The upgrade path. Default '/control'. */
  path?: string
  /**
   * Accepts or refuses the `authorization` header. Return `{ revoked }` to be told when the
   * credential stops being valid: the socket is then closed.
   */
  authorize: (authorization: string | undefined) => boolean | { revoked: (cb: () => void) => void }
  sessions: SessionStore
  /** The largest frame accepted; a larger one closes the socket with 1009. Default 65_536. */
  maxPayloadBytes?: number
  log?: (line: string) => void
}

const DEFAULT_PATH = '/control'
const DEFAULT_MAX_PAYLOAD = 65_536
const POLICY_VIOLATION = 1008

function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

function rawToText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8')
}

function loadWs(): { WebSocketServer: typeof WebSocketServer } {
  try {
    return createRequire(import.meta.url)('ws') as { WebSocketServer: typeof WebSocketServer }
  } catch (error) {
    throw new Error(
      'attachControlSocket needs the optional peer dependency "ws": install it with your package manager',
      { cause: error },
    )
  }
}

export function attachControlSocket(
  server: Server,
  options: ControlSocketOptions,
): { close(): Promise<void> } {
  const path = options.path ?? DEFAULT_PATH
  const log = options.log ?? ((): void => undefined)
  const { sessions } = options
  const wss = new (loadWs().WebSocketServer)({
    noServer: true,
    maxPayload: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD,
  })

  function serve(ws: WebSocket): void {
    const owner = {}
    /** Used when a chat names no session: private to this socket. */
    const privateSession = `sock-${randomUUID()}`
    let turning = false
    const send = (frame: ControlServerFrame): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame))
    }

    async function chat(message: string, session: string | undefined): Promise<void> {
      if (turning) {
        send({ type: 'error', code: 'busy', ...(session === undefined ? {} : { session }) })
        return
      }
      turning = true
      const tag = session === undefined ? {} : { session }
      try {
        const outcome = await sessions.run(
          session ?? privateSession,
          message,
          (event) => {
            send({ type: 'event', event, ...tag })
          },
          owner,
        )
        if (outcome.ok) {
          const usage = outcome.usage === undefined ? {} : { usage: outcome.usage }
          send({ type: 'done', ...tag, ...usage })
        } else if (outcome.code === 'interrupted') {
          send({ type: 'interrupted', session: session ?? privateSession })
        } else {
          send({ type: 'error', code: outcome.code, ...tag })
        }
      } finally {
        turning = false
      }
    }

    ws.on('message', (data, isBinary) => {
      const frame = isBinary ? undefined : parseControlFrame(rawToText(data))
      if (frame === undefined) {
        send({ type: 'error', code: 'bad_frame' })
        return
      }
      if (frame.type === 'chat') {
        void chat(frame.message, frame.session)
      } else if (frame.type === 'interrupt') {
        const result = sessions.interrupt(frame.session)
        send({ type: result === 'cancelled' ? 'interrupt_ok' : 'no_turn', session: frame.session })
      } else {
        void sessions.steer(frame.session, frame.message).then((result) => {
          send({ type: result === 'steered' ? 'steer_ok' : 'no_turn', session: frame.session })
        })
      }
    })
    ws.on('close', () => {
      sessions.cancelOwnedBy(owner)
    })
    ws.on('error', (error) => {
      log(`control socket: ${error.message}`)
    })
  }

  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    if (pathname !== path) {
      refuse(socket, 404, 'Not Found')
      return
    }
    let verdict: ReturnType<ControlSocketOptions['authorize']>
    try {
      verdict = options.authorize(req.headers.authorization)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log(`control socket: authorize threw: ${reason}`)
      verdict = false
    }
    if (verdict === false) {
      refuse(socket, 401, 'Unauthorized')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (typeof verdict === 'object')
        verdict.revoked(() => {
          ws.close(POLICY_VIOLATION, 'revoked')
        })
      serve(ws)
    })
  }

  server.on('upgrade', onUpgrade)

  return {
    close: () => {
      server.off('upgrade', onUpgrade)
      for (const client of wss.clients) client.terminate()
      return new Promise<void>((resolve) => {
        wss.close(() => {
          resolve()
        })
      })
    },
  }
}
