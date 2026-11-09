import WebSocket from 'ws'

/**
 * One `/control` turn against a started TheoClaw (moved from `control-plane.live.test.ts`, B-374
 * T3.2, so the daemon and container checks run the same turn). Every wait is a condition with a
 * deadline (`rules/testing.md` § 3).
 */
export type Frame = Record<string, unknown>

export interface ControlTurn {
  /** `finished` on a `done` frame, `failed` on a `turn_failed` error frame, `timeout` otherwise. */
  readonly status: 'finished' | 'failed' | 'timeout'
  /** The streamed text deltas, joined. */
  readonly text: string
  readonly elapsedMs: number
  /** The streamed error events and the final error frame, as JSON; empty for a finished turn. */
  readonly error: string
  readonly frames: readonly Frame[]
  /** How many frames had arrived when the final one did; frames after it would be a second ending. */
  readonly framesAtEnd: number
}

const isFinal = (frame: Frame): boolean => frame.type === 'done' || (frame.type === 'error' && frame.code === 'turn_failed')

function event(frame: Frame): { type?: unknown; content?: unknown } | undefined {
  return frame.type === 'event' ? (frame.event as { type?: unknown; content?: unknown }) : undefined
}

/**
 * Sends `prompt` and waits for the final frame until `deadlineMs`; `settleMs` keeps the socket open
 * that long after it, so a test can assert nothing follows.
 */
export async function runControlTurn(port: number, token: string, prompt: string, deadlineMs: number, settleMs = 0): Promise<ControlTurn> {
  const started = Date.now()
  const socket = new WebSocket(`ws://127.0.0.1:${port}/control`, { headers: { Authorization: `Bearer ${token}` } })
  const frames: Frame[] = []
  socket.on('message', (raw) => frames.push(JSON.parse(String(raw)) as Frame))
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    socket.send(JSON.stringify({ type: 'chat', message: prompt }))
    while (!frames.some(isFinal) && Date.now() - started < deadlineMs) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const elapsedMs = Date.now() - started
    const framesAtEnd = frames.length
    // The window in which a second final frame would show; only a caller asking for it waits.
    if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs))
    const final = frames.find(isFinal)
    const status = final === undefined ? 'timeout' : final.type === 'done' ? 'finished' : 'failed'
    const text = frames
      .map(event)
      .filter((e) => e?.type === 'text_delta' && typeof e.content === 'string')
      .map((e) => e!.content as string)
      .join('')
    const errors = frames.filter((frame) => event(frame)?.type === 'error' || frame.type === 'error')
    return { status, text, elapsedMs, error: status === 'finished' ? '' : JSON.stringify(errors), frames, framesAtEnd }
  } finally {
    socket.close()
  }
}
