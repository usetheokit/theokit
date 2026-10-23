import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

import { type RawData, WebSocket, WebSocketServer } from 'ws'

import { describeError, TheoClawConfigError } from './errors.js'
import type { TurnRunner } from './turn.js'

export interface ControlSocketOptions {
  /** The bearer token an upgrade must carry; at least 32 characters. */
  readonly token: string
  readonly runTurn: TurnRunner
}

/** What the listener holds of the socket server: the clients it must end before closing. */
export interface ControlSocket {
  close(): Promise<void>
}

const CONTROL_PATH = '/control'
const MAX_FRAME_BYTES = 65_536
const MIN_TOKEN_LENGTH = 32
const BEARER = /^bearer (.+)$/i

type Refuse = (socket: Duplex, status: '401 Unauthorized' | '404 Not Found') => void

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Compared as SHA-256 digests, so the comparison takes the same time whatever the length. */
function tokenMatches(authorization: string | undefined, expected: Buffer): boolean {
  const presented = BEARER.exec(authorization ?? '')?.[1]
  return presented !== undefined && timingSafeEqual(digest(presented), expected)
}

/** The path without its query. Read by splitting, not `new URL`, which can throw in a listener. */
function pathOf(request: IncomingMessage): string {
  return (request.url ?? '/').split('?')[0] ?? '/'
}

/** The chat message of a text frame, or undefined for anything that is not a chat frame. */
function chatMessage(raw: RawData, isBinary: boolean): string | undefined {
  if (isBinary) return undefined
  try {
    const frame = JSON.parse(String(raw)) as { type?: unknown; message?: unknown } | null
    const message = frame?.type === 'chat' ? frame.message : undefined
    return typeof message === 'string' && message !== '' ? message : undefined
  } catch {
    // Not JSON is a malformed frame, answered `bad_frame` by the caller: the parse error has no
    // more to say than that.
    return undefined
  }
}

/**
 * One accepted socket: one turn at a time, frames sent only while the socket is open (a turn whose
 * socket closed runs to its end and its frames are dropped, EC-1), and one final frame per turn.
 */
function serve(ws: WebSocket, options: ControlSocketOptions, stderr: (line: string) => void): void {
  let busy = false
  const send = (frame: unknown): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
  }
  ws.on('error', (error) => stderr(`theoclaw: control socket error: ${describeError(error)}`))
  ws.on('message', (raw, isBinary) => {
    const message = chatMessage(raw, isBinary)
    if (message === undefined) return send({ type: 'error', code: 'bad_frame' })
    if (busy) return send({ type: 'error', code: 'busy' })
    busy = true
    // `runTurn` is a port: a runner that throws or rejects still ends the turn with turn_failed and
    // frees the socket, rather than leaving it busy forever or rejecting unheard.
    void Promise.resolve()
      .then(() => options.runTurn(message, (event) => send({ type: 'event', event })))
      .catch((error: unknown) => ({ ok: false, code: 'turn_failed', reason: describeError(error) }) as const)
      .then((outcome) => {
        busy = false
        if (outcome.ok) return send({ type: 'done' })
        stderr(`theoclaw: turn failed: ${outcome.reason}`)
        send({ type: 'error', code: outcome.code })
      })
  })
}

/**
 * Accept WebSocket upgrades on `/control` that carry the bearer token, on the listener's own server
 * (`ws` in `noServer` mode). Every other upgrade is refused before any agent exists: 404 for
 * another path, 401 for a missing or wrong token.
 */
export function attachControlSocket(
  server: Server,
  options: ControlSocketOptions,
  refuse: Refuse,
  stderr: (line: string) => void,
): ControlSocket {
  if (options.token.length < MIN_TOKEN_LENGTH) {
    throw new TheoClawConfigError(`THEOCLAW_CONTROL_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`, {
      variable: 'THEOCLAW_CONTROL_TOKEN',
    })
  }
  const expected = digest(options.token)
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (pathOf(request) !== CONTROL_PATH) return refuse(socket, '404 Not Found')
    if (!tokenMatches(request.headers.authorization, expected)) return refuse(socket, '401 Unauthorized')
    wss.handleUpgrade(request, socket, head, (ws) => serve(ws, options, stderr))
  })
  return {
    close: () =>
      new Promise((resolve, reject) => {
        for (const client of wss.clients) client.terminate()
        wss.close((error) => (error === undefined ? resolve() : reject(error)))
      }),
  }
}
