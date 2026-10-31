import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

import { WebSocket, WebSocketServer } from 'ws'

import { bearerCheck, MIN_BEARER_TOKEN_LENGTH } from './bearer.js'
import type { ControlSessions, SessionOutcome } from './control-sessions.js'
import { describeError, TheoClawConfigError } from './errors.js'
import type { TurnRunner } from './turn.js'

export interface ControlSocketOptions {
  /** The bearer token an upgrade must carry; at least 32 characters. */
  readonly token: string
  readonly runTurn: TurnRunner
  /**
   * The named sessions (B-376). Without it a frame naming a session, and every interrupt frame, is
   * `bad_frame`, so a caller that never passes it keeps the sessionless protocol unchanged.
   */
  readonly sessions?: ControlSessions
}

/** What the listener holds of the socket server: the clients it must end before closing. */
export interface ControlSocket {
  close(): Promise<void>
}

const CONTROL_PATH = '/control'
const MAX_FRAME_BYTES = 65_536

type Refuse = (socket: Duplex, status: '401 Unauthorized' | '404 Not Found') => void

/** The path without its query. Read by splitting, not `new URL`, which can throw in a listener. */
function pathOf(request: IncomingMessage): string {
  return (request.url ?? '/').split('?')[0] ?? '/'
}

/** A frame the socket acts on: a chat turn, optionally on a session, or an interrupt of one. */
type Frame =
  | { readonly kind: 'chat'; readonly message: string; readonly session?: string }
  | { readonly kind: 'interrupt'; readonly session: string }

/**
 * The frame's `session`, when it is a string. `null` reads as absent, as the field was ignored
 * before sessions existed. Validated by the session store, not here.
 */
function sessionOf(frame: { session?: unknown }): string | undefined {
  return typeof frame.session === 'string' ? frame.session : undefined
}

/**
 * The frame a text message carries, or undefined for anything else. The frame is typed by what is
 * read of it rather than as `RawData`, a name the `ws` package itself does not export (only
 * `@types/ws` declares it).
 */
function parseFrame(raw: { toString(): string }, isBinary: boolean): Frame | undefined {
  if (isBinary) return undefined
  let frame: { type?: unknown; message?: unknown; session?: unknown } | null
  try {
    frame = JSON.parse(String(raw)) as typeof frame
  } catch {
    // Not JSON is a malformed frame, answered `bad_frame` by the caller: the parse error has no
    // more to say than that.
    return undefined
  }
  const session = frame === null ? undefined : sessionOf(frame)
  if (frame?.type === 'interrupt') return session === undefined ? undefined : { kind: 'interrupt', session }
  const message = frame?.type === 'chat' ? frame.message : undefined
  if (typeof message !== 'string' || message === '') return undefined
  if (frame?.session !== undefined && frame.session !== null && session === undefined) return undefined
  return session === undefined ? { kind: 'chat', message } : { kind: 'chat', message, session }
}

/** The final frame of a session turn, and the stderr line an interrupted or failed one writes. */
function sessionEnd(session: string, outcome: SessionOutcome, stderr: (line: string) => void): Record<string, unknown> {
  if (outcome.ok) return { type: 'done', session }
  if (outcome.code === 'interrupted') {
    stderr(`theoclaw: control session ${session} turn interrupted`)
    return { type: 'interrupted', session }
  }
  if (outcome.code === 'turn_failed') stderr(`theoclaw: turn failed: ${outcome.reason}`)
  return { type: 'error', code: outcome.code, session }
}

/**
 * One accepted socket: one turn at a time whatever its sessions (FR-004), frames sent only while the
 * socket is open, and one final frame per turn. A sessionless turn whose socket closed runs to its
 * end and its frames are dropped (EC-1); a session turn whose socket closed is cancelled (FR-005).
 */
function serve(ws: WebSocket, options: ControlSocketOptions, stderr: (line: string) => void): void {
  let busy = false
  let current: string | undefined
  const send = (frame: unknown): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame))
  }
  const { sessions } = options
  ws.on('error', (error) => stderr(`theoclaw: control socket error: ${describeError(error)}`))
  ws.on('close', () => sessions?.cancelOwnedBy(ws))
  const sessionTurn = (store: ControlSessions, message: string, session: string): Promise<void> =>
    store
      .run(session, message, (event) => send({ type: 'event', event, session }), ws)
      .then((outcome) => send(sessionEnd(session, outcome, stderr)))
  // `runTurn` is a port: a runner that throws or rejects still ends the turn with turn_failed and
  // frees the socket, rather than leaving it busy forever or rejecting unheard.
  const sessionlessTurn = (message: string): Promise<void> =>
    Promise.resolve()
      .then(() => options.runTurn(message, (event) => send({ type: 'event', event })))
      .catch((error: unknown) => ({ ok: false, code: 'turn_failed', reason: describeError(error) }) as const)
      .then((outcome) => {
        if (outcome.ok) return send({ type: 'done' })
        stderr(`theoclaw: turn failed: ${outcome.reason}`)
        send({ type: 'error', code: outcome.code })
      })
  ws.on('message', (raw, isBinary) => {
    const frame = parseFrame(raw, isBinary)
    if (frame === undefined) return send({ type: 'error', code: 'bad_frame' })
    const session = frame.session
    if (session !== undefined && sessions === undefined) return send({ type: 'error', code: 'bad_frame' })
    if (frame.kind === 'interrupt') {
      const answer = sessions!.interrupt(frame.session)
      if (answer === 'no_turn') return send({ type: 'no_turn', session })
      // The socket that owns the turn learns from the turn's own final frame, `interrupted`.
      if (current !== session) send({ type: 'interrupt_ok', session })
      return
    }
    if (busy) return send(session === undefined ? { type: 'error', code: 'busy' } : { type: 'error', code: 'busy', session })
    busy = true
    current = session
    const turn = session === undefined ? sessionlessTurn(frame.message) : sessionTurn(sessions!, frame.message, session)
    void turn.finally(() => {
      busy = false
      current = undefined
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
  if (options.token.length < MIN_BEARER_TOKEN_LENGTH) {
    throw new TheoClawConfigError(`THEOCLAW_CONTROL_TOKEN must be at least ${MIN_BEARER_TOKEN_LENGTH} characters`, {
      variable: 'THEOCLAW_CONTROL_TOKEN',
    })
  }
  const tokenMatches = bearerCheck(options.token)
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (pathOf(request) !== CONTROL_PATH) return refuse(socket, '404 Not Found')
    if (!tokenMatches(request.headers.authorization)) return refuse(socket, '401 Unauthorized')
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
