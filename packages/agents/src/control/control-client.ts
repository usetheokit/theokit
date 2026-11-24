/**
 * A typed client for the control socket (`attachControlSocket`): open with a credential, send a chat
 * on a session and read that turn's frames as an async iterable, interrupt and steer.
 *
 * Ported from TheoClaw's control client. `ws` is an optional peer, loaded when this is called.
 * No message carries the credential, and a refused upgrade is reported by HTTP status only.
 */
import { createRequire } from 'node:module'

import { TheokitAgentError } from '@theokit/sdk/errors'
import type { WebSocket as WsSocket } from 'ws'

import type { ControlClientFrame, ControlServerFrame } from './frames.js'

/** A refused, failed or closed control connection. The message never contains the credential. */
export class ControlConnectionError extends TheokitAgentError {
  override readonly name = 'ControlConnectionError'
  constructor(message: string) {
    super(message, { code: 'CONTROL_CONNECTION', isRetryable: false })
  }
}

export interface ControlClient {
  /** Sends a chat on `session` and yields that turn's frames; ends after the final frame. */
  chat(message: string, session: string): AsyncIterable<ControlServerFrame>
  interrupt(session: string): void
  steer(session: string, message: string): void
  close(): Promise<void>
}

const FRAME_LIMIT_CLOSE = 1009

function loadWs(): typeof WsSocket {
  try {
    return createRequire(import.meta.url)('ws') as typeof WsSocket
  } catch {
    throw new ControlConnectionError(
      'createControlClient needs the optional peer dependency "ws": install it with your package manager',
    )
  }
}

/** The address without user info, query or fragment, for messages. */
function describeAddress(url: URL): string {
  return `${url.protocol}//${url.host}${url.pathname}`
}

const ACKNOWLEDGEMENTS = new Set(['interrupt_ok', 'steer_ok', 'no_turn'])

function isFinal(frame: ControlServerFrame): boolean {
  return frame.type === 'done' || frame.type === 'interrupted' || frame.type === 'error'
}

export async function createControlClient(options: {
  url: string
  authorization: string
  /** Stamps each frame's `arrivedAt` as it comes off the socket, so a caller can order frames against its own events. */
  stamp?: () => number
  /** Drop interrupt_ok, steer_ok and no_turn from chat(). Default false. */
  dropAcknowledgements?: boolean
}): Promise<ControlClient> {
  let url: URL
  try {
    url = new URL(options.url)
  } catch {
    throw new ControlConnectionError('the address must start with ws:// or wss://')
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new ControlConnectionError('the address must start with ws:// or wss://')
  }
  const address = describeAddress(url)
  const Ws = loadWs()
  const { authorization } = options

  const ws = await new Promise<WsSocket>((resolve, reject) => {
    const socket = new Ws(url.href, { headers: { authorization } })
    socket.once('open', () => {
      resolve(socket)
    })
    socket.once('unexpected-response', (_req, res) => {
      res.resume()
      reject(
        new ControlConnectionError(
          `the instance at ${address} refused the connection: HTTP ${String(res.statusCode)}`,
        ),
      )
      socket.terminate()
    })
    socket.once('error', () => {
      // The raw error can echo request details: report the address only.
      reject(new ControlConnectionError(`could not connect to the instance at ${address}`))
    })
  })

  const queue: ControlServerFrame[] = []
  let wake: (() => void) | undefined
  let closeCode: number | undefined
  let closed = false
  let active = false

  const notify = (): void => {
    const w = wake
    wake = undefined
    w?.()
  }
  ws.on('message', (data) => {
    try {
      let text: string
      if (Array.isArray(data)) text = Buffer.concat(data).toString('utf8')
      else if (Buffer.isBuffer(data)) text = data.toString('utf8')
      else text = Buffer.from(data).toString('utf8')
      const frame = JSON.parse(text) as Partial<ControlServerFrame> | null
      if (typeof frame === 'object' && frame !== null && typeof frame.type === 'string') {
        const arrived = options.stamp === undefined ? {} : { arrivedAt: options.stamp() }
        queue.push({ ...frame, ...arrived } as ControlServerFrame)
        notify()
      }
    } catch {
      // not a frame: ignore
    }
  })
  ws.on('close', (code) => {
    closed = true
    closeCode = code
    notify()
  })
  ws.on('error', () => {
    // a failure is followed by 'close'; nothing here may reach a message
  })

  function send(frame: ControlClientFrame): void {
    if (closed || ws.readyState !== ws.OPEN) {
      throw new ControlConnectionError('the connection is closed')
    }
    ws.send(JSON.stringify(frame))
  }

  async function* chat(message: string, session: string): AsyncGenerator<ControlServerFrame> {
    if (active) {
      throw new ControlConnectionError('a chat is already running on this connection')
    }
    active = true
    try {
      queue.length = 0
      send({ type: 'chat', message, session })
      for (;;) {
        const frame = queue.shift()
        if (frame !== undefined) {
          if (frame.session !== undefined && frame.session !== session) continue
          if (options.dropAcknowledgements === true && ACKNOWLEDGEMENTS.has(frame.type)) continue
          yield frame
          if (isFinal(frame)) return
          continue
        }
        if (closed) {
          throw new ControlConnectionError(
            closeCode === FRAME_LIMIT_CLOSE
              ? 'the chat frame exceeds the 65,536-byte frame limit of the instance'
              : 'connection closed before the turn ended',
          )
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    } finally {
      active = false
    }
  }

  return {
    chat: (message, session) => chat(message, session),
    interrupt: (session) => {
      send({ type: 'interrupt', session })
    },
    steer: (session, message) => {
      send({ type: 'steer', session, message })
    },
    close: () =>
      new Promise<void>((resolve) => {
        if (closed) {
          resolve()
          return
        }
        ws.once('close', () => {
          resolve()
        })
        ws.close()
      }),
  }
}
