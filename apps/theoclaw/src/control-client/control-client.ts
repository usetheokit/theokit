import WebSocket from 'ws'

import { describeError } from '../control-plane/errors.js'
import type { TurnEvent } from '../control-plane/turn.js'

/** A frame the instance sends on `/control` for a session turn. */
export type ControlFrame =
  | { readonly type: 'event'; readonly event: TurnEvent; readonly session: string }
  | { readonly type: 'done'; readonly session: string }
  | { readonly type: 'interrupted'; readonly session: string }
  | { readonly type: 'error'; readonly code: string; readonly session?: string }
  | { readonly type: 'interrupt_ok' | 'no_turn'; readonly session: string }

/** The connection to the instance failed or ended in a way a surface reports. Never carries the token. */
export class TheoClawControlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TheoClawControlError'
  }
}

export interface ControlClient {
  /** Send `message` on `session` and yield that turn's frames, ending with its final frame. */
  chat(message: string, session: string): AsyncIterable<ControlFrame>
  /** Ask the instance to stop the session's running turn. */
  interrupt(session: string): void
  close(): Promise<void>
}

/** The close code `ws` uses when a frame exceeds the server's `maxPayload`. */
const MESSAGE_TOO_BIG = 1009

const FINAL = new Set(['done', 'interrupted', 'error'])

function closedError(code: number): TheoClawControlError {
  return new TheoClawControlError(
    code === MESSAGE_TOO_BIG
      ? 'the chat frame exceeds the 65,536-byte frame limit of the instance'
      : 'connection closed before the turn ended',
  )
}

/** Open the socket, or reject naming the address or the HTTP status; the token never appears. */
function open(url: string, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } })
    socket.once('open', () => resolve(socket))
    socket.once('unexpected-response', (_request, response) => {
      socket.terminate()
      reject(new TheoClawControlError(`the instance at ${url} refused the connection: HTTP ${response.statusCode}`))
    })
    socket.once('error', (error) => {
      reject(new TheoClawControlError(`cannot reach the instance at ${url}: ${describeError(error)}`))
    })
  })
}

/**
 * Turn the socket's frames into a pull queue: `next()` resolves with the next frame, or rejects
 * once the socket closed with no frame left.
 */
function frameQueue(socket: WebSocket): { next(): Promise<ControlFrame> } {
  const frames: ControlFrame[] = []
  const waiters: { resolve(frame: ControlFrame): void; reject(error: Error): void }[] = []
  let closed: TheoClawControlError | undefined
  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as ControlFrame
    const waiter = waiters.shift()
    if (waiter === undefined) frames.push(frame)
    else waiter.resolve(frame)
  })
  socket.on('close', (code) => {
    closed = closedError(code)
    for (const waiter of waiters.splice(0)) waiter.reject(closed)
  })
  // After the open, a socket error is followed by `close`, which is what a turn reports.
  socket.on('error', () => undefined)
  return {
    next: () => {
      const frame = frames.shift()
      if (frame !== undefined) return Promise.resolve(frame)
      if (closed !== undefined) return Promise.reject(closed)
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
    },
  }
}

/**
 * The client both surfaces use (FR-007, plan D1): a connection to the running instance's `/control`
 * socket with the owner token. It builds no agent; a turn is the instance's, on the named session.
 */
export async function createControlClient(options: { readonly url: string; readonly token: string }): Promise<ControlClient> {
  const socket = await open(options.url, options.token)
  const queue = frameQueue(socket)
  return {
    async *chat(message, session) {
      socket.send(JSON.stringify({ type: 'chat', message, session }))
      for (;;) {
        const frame = await queue.next()
        // Answers to an interrupt this client sent for another session's turn are not this turn's.
        if (frame.type === 'interrupt_ok' || frame.type === 'no_turn') continue
        if (frame.session !== undefined && frame.session !== session) continue
        yield frame
        if (FINAL.has(frame.type)) return
      }
    },
    interrupt: (session) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'interrupt', session }))
    },
    close: () =>
      new Promise((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) return resolve()
        socket.once('close', () => resolve())
        socket.close()
      }),
  }
}
