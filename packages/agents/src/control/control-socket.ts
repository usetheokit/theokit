/**
 * A session store served over an authenticated WebSocket: chat, interrupt and steer frames map onto
 * the store's sessions, and a closed socket cancels the turns it started.
 *
 * Ported from TheoClaw's control socket. `ws` is an optional peer, loaded when this is called.
 */
import type { IncomingMessage, Server } from 'node:http'
import { createRequire } from 'node:module'
import type { Duplex } from 'node:stream'

import type { WebSocket, WebSocketServer } from 'ws'

import type { AgentStreamEvent } from '../bridge/agent-stream-events.js'
import type { DevicePairing } from './device-pairing.js'
import { parseControlFrame, type ControlServerFrame } from './frames.js'

/** How a turn ended, as the socket needs it: `usage` is passed to `doneFields` untouched. */
export type SocketOutcome =
  | { readonly ok: true; readonly usage?: unknown }
  | { readonly ok: false; readonly code: string; readonly reason?: string }

/** What the socket asks of a session store; `SessionStore` satisfies it, so can an app's own. */
export interface SocketSessions {
  run(
    session: string,
    message: string,
    emit: (e: AgentStreamEvent) => void,
    owner: object,
  ): Promise<SocketOutcome>
  interrupt(session: string): 'cancelled' | 'no_turn'
  steer(session: string, message: string): Promise<'steered' | 'no_turn'>
  cancelOwnedBy(owner: object): void
}

/** A verdict on an upgrade: `owner` defaults to true; `revoked` returns how to stop listening. */
export interface SocketVerdict {
  /** An owner may issue setup codes and approve or revoke devices on this socket. Default true. */
  owner?: boolean
  /** Called once with a callback that closes the socket; may return a function that unsubscribes. */
  revoked?: (close: () => void) => (() => void) | undefined
}

export interface ControlSocketOptions {
  /** The upgrade path. Default '/control'. */
  path?: string
  /**
   * Accepts or refuses the `authorization` header. Return a {@link SocketVerdict} to say whether the
   * caller is an owner and to be told when the credential stops being valid: the socket is closed.
   */
  authorize: (authorization: string | undefined) => boolean | SocketVerdict
  /**
   * The named sessions. Without it a frame naming a session is `bad_frame`, and a chat with no
   * session runs through `runTurn` (or is `bad_frame` without that too).
   */
  sessions?: SocketSessions
  /** One turn for a chat naming no session; without it that chat runs on a session private to the socket. */
  runTurn?: (message: string, emit: (e: AgentStreamEvent) => void) => Promise<SocketOutcome>
  /** Fields merged into every `done` frame, from the finished turn's usage. */
  doneFields?: (usage: unknown) => Record<string, unknown>
  /** Called with each turn's outcome before its final frame is sent (for example to log usage). */
  onTurnEnd?: (end: { session?: string; outcome: SocketOutcome }) => void
  /**
   * Device management frames (`pair_code`, `pending_devices`, `approve_device`, `revoke_device`),
   * answered on an owner's socket only; any other socket gets `forbidden`.
   */
  devices?: Pick<DevicePairing, 'issueCode' | 'pending' | 'approve' | 'revokeDevice'>
  /** The largest frame accepted; a larger one closes the socket with 1009. Default 65_536. */
  maxPayloadBytes?: number
  log?: (line: string) => void
}

const DEFAULT_PATH = '/control'
const DEFAULT_MAX_PAYLOAD = 65_536
const POLICY_VIOLATION = 1008
const DEVICE_FRAMES = new Set(['pair_code', 'pending_devices', 'approve_device', 'revoke_device'])

function refuse(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

function rawToText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  return Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data).toString('utf8')
}

/** The path without its query, read by splitting: `new URL` can throw inside a listener. */
function pathOf(req: IncomingMessage): string {
  return (req.url ?? '/').split('?')[0] ?? '/'
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A text message's JSON object, or undefined. */
function readObject(text: string): { type?: unknown; id?: unknown } | undefined {
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

type Answer = Promise<Record<string, unknown>>

/** The answer to one device frame, for an owner's socket. */
function deviceAnswer(
  devices: NonNullable<ControlSocketOptions['devices']>,
  frame: { type?: unknown; id?: unknown },
): Answer {
  if (frame.type === 'pair_code')
    return Promise.resolve({ type: 'pair_code', code: devices.issueCode() })
  if (frame.type === 'pending_devices') {
    return Promise.resolve({
      type: 'pending_devices',
      devices: devices.pending().map(({ id, name, city }) => ({
        id,
        name,
        ...(city === undefined ? {} : { city }),
      })),
    })
  }
  const { id } = frame
  if (typeof id !== 'string') return Promise.resolve({ type: 'error', code: 'bad_frame' })
  if (frame.type === 'revoke_device') {
    return devices
      .revokeDevice(id)
      .then((ok) =>
        ok ? { type: 'device_revoked', id } : { type: 'error', code: 'revoke_failed' },
      )
  }
  return devices
    .approve(id)
    .then((result) =>
      result.ok
        ? { type: 'device_approved', id, name: result.name }
        : { type: 'error', code: 'approve_failed', reason: result.reason },
    )
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
  const { sessions, runTurn, devices } = options
  const wss = new (loadWs().WebSocketServer)({
    noServer: true,
    maxPayload: options.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD,
  })

  function serve(ws: WebSocket, isOwner: boolean): void {
    const owner = {}
    /** Used when a chat names no session and there is no `runTurn`: private to this socket. */
    const privateSession = `sock-${crypto.randomUUID()}`
    let turning = false
    /** The session of this socket's running turn: its own final frame answers an interrupt. */
    let current: string | undefined
    const send = (frame: Record<string, unknown> | ControlServerFrame): void => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame))
    }

    function finish(session: string | undefined, outcome: SocketOutcome): void {
      options.onTurnEnd?.({ ...(session === undefined ? {} : { session }), outcome })
      const tag = session === undefined ? {} : { session }
      if (outcome.ok) {
        const usage = outcome.usage === undefined ? {} : { usage: outcome.usage }
        const extra = outcome.usage === undefined ? {} : (options.doneFields?.(outcome.usage) ?? {})
        send({ type: 'done', ...tag, ...usage, ...extra })
      } else if (outcome.code === 'interrupted') {
        send({ type: 'interrupted', session: session ?? privateSession })
      } else {
        send({ type: 'error', code: outcome.code, ...tag })
      }
    }

    async function turn(message: string, session: string | undefined): Promise<SocketOutcome> {
      const emit = (event: AgentStreamEvent): void => {
        send({ type: 'event', event, ...(session === undefined ? {} : { session }) })
      }
      if (session !== undefined || runTurn === undefined) {
        return sessions!.run(session ?? privateSession, message, emit, owner)
      }
      // `runTurn` is a port: one that throws still ends the turn and frees the socket.
      try {
        return await runTurn(message, emit)
      } catch (error) {
        return { ok: false, code: 'turn_failed', reason: describeError(error) }
      }
    }

    async function chat(message: string, session: string | undefined): Promise<void> {
      if (turning) {
        send({ type: 'error', code: 'busy', ...(session === undefined ? {} : { session }) })
        return
      }
      turning = true
      current = session
      try {
        finish(session, await turn(message, session))
      } finally {
        turning = false
        current = undefined
      }
    }

    function control(frame: ReturnType<typeof parseControlFrame>): void {
      if (frame === undefined || (frame.session !== undefined && sessions === undefined)) {
        send({ type: 'error', code: 'bad_frame' })
        return
      }
      if (frame.type === 'chat') {
        if (frame.session === undefined && sessions === undefined && runTurn === undefined) {
          send({ type: 'error', code: 'bad_frame' })
          return
        }
        void chat(frame.message, frame.session)
      } else if (frame.type === 'interrupt') {
        const result = sessions!.interrupt(frame.session)
        if (result === 'no_turn') send({ type: 'no_turn', session: frame.session })
        // The socket that owns the turn learns from the turn's own final frame, `interrupted`.
        else if (current !== frame.session) send({ type: 'interrupt_ok', session: frame.session })
      } else {
        void sessions!.steer(frame.session, frame.message).then((result) => {
          send({ type: result === 'steered' ? 'steer_ok' : 'no_turn', session: frame.session })
        })
      }
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        send({ type: 'error', code: 'bad_frame' })
        return
      }
      const text = rawToText(data)
      const raw = devices === undefined ? undefined : readObject(text)
      if (devices !== undefined && typeof raw?.type === 'string' && DEVICE_FRAMES.has(raw.type)) {
        if (!isOwner) {
          send({ type: 'error', code: 'forbidden' })
          return
        }
        deviceAnswer(devices, raw)
          .then(send)
          .catch((error: unknown) => {
            log(`control socket: device frame failed: ${describeError(error)}`)
            send({ type: 'error', code: 'device_frame_failed' })
          })
        return
      }
      control(parseControlFrame(text))
    })
    ws.on('close', () => {
      sessions?.cancelOwnedBy(owner)
    })
    ws.on('error', (error) => {
      log(`control socket error: ${error.message}`)
    })
  }

  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (pathOf(req) !== path) {
      refuse(socket, 404, 'Not Found')
      return
    }
    let verdict: ReturnType<ControlSocketOptions['authorize']>
    try {
      verdict = options.authorize(req.headers.authorization)
    } catch (error) {
      log(`control socket: authorize threw: ${describeError(error)}`)
      verdict = false
    }
    if (verdict === false) {
      refuse(socket, 401, 'Unauthorized')
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (typeof verdict === 'object' && verdict.revoked !== undefined) {
        const stop = verdict.revoked(() => {
          ws.close(POLICY_VIOLATION, 'revoked')
        })
        if (typeof stop === 'function') ws.on('close', stop)
      }
      serve(ws, typeof verdict !== 'object' || verdict.owner !== false)
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
