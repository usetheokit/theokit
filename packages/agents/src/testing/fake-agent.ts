import type { InteractionUpdate } from '@theokit/sdk'

import type { SdkMessage, SdkTimelineEvent } from '../bridge/index.js'

/** A stream frame as `@theokit/sdk` emits it, narrowed to what the presenter reads. */
export type SdkFrame = { readonly type: string } & Readonly<Record<string, unknown>>

export interface FakeTurn {
  /** What the stream yields, fixed or computed from the text sent. */
  readonly frames: readonly SdkFrame[] | ((text: string) => readonly SdkFrame[])
  /** Thrown by the stream after its frames. */
  readonly streamError?: Error
  /** What `wait()` resolves. Default `{ status: 'finished' }`. */
  readonly result?: {
    readonly status: string
    readonly error?: { readonly code?: string }
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
    readonly cost?: { readonly amountUsd?: number }
  }
  /** The stream waits on this before its first frame; an aborted signal releases it. */
  readonly before?: Promise<void>
  /** `send` waits on this before it returns the run (the pending window of EC-1). */
  readonly sendGate?: Promise<void>
  /** Text deltas `events()` yields before the frames, which then arrive marked `textAlreadyStreamed`. */
  readonly deltas?: readonly string[]
  /** `events()` waits on this after the deltas, before the completed messages. */
  readonly afterDeltas?: Promise<void>
  /** `events()` opens one tool call and holds inside it until the signal aborts. */
  readonly toolHeld?: boolean
  /** The held tool call's name. Default `read`. */
  readonly toolName?: string
  /** A run that was not aborted resolves `wait()` only once this settles (events ended, outcome pending). */
  readonly waitGate?: Promise<void>
  /** A cancelled run's `wait()` resolves only once this settles (a run still unwinding). */
  readonly teardown?: Promise<void>
}

/** Resolves when `gate` settles or `signal` aborts, whichever is first. */
function until(gate: Promise<void> | undefined, signal: AbortSignal | undefined): Promise<void> {
  if (gate === undefined) return Promise.resolve()
  if (signal === undefined) return gate
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true },
    )
    void gate.then(resolve)
  })
}

/**
 * A frame as the bridge's `SdkMessage`. The fake's frames are loose test data, so this is the one
 * place they are trusted to be the SDK's messages; a real run yields `SdkMessage`s without it.
 */
function asMessage(frame: SdkFrame): SdkMessage {
  return frame as unknown as SdkMessage
}

const never = new Promise<void>(() => undefined)

/** A timeline event as `run.events()` yields it. */
export type FakeTimelineEvent =
  | { readonly kind: 'delta'; readonly update: InteractionUpdate }
  | { readonly kind: 'message'; readonly message: SdkFrame; readonly textAlreadyStreamed: boolean }

/**
 * An agent with no model: it records what it was sent and the signal each send carried. A run
 * honours its signal as the SDK's does: an abort ends `stream()` and `events()` at the next frame,
 * releases a held `before`, and makes `wait()` resolve `cancelled`.
 */
export class FakeAgent {
  readonly sent: string[] = []
  readonly signals: (AbortSignal | undefined)[] = []
  readonly queueModes: (string | undefined)[] = []
  cancels = 0

  constructor(private readonly turn: FakeTurn) {}

  async send(
    text: string,
    options?: { readonly signal?: AbortSignal; readonly queueMode?: string },
  ) {
    this.sent.push(text)
    this.queueModes.push(options?.queueMode)
    const signal = options?.signal
    this.signals.push(signal)
    const turn = this.turn
    if (turn.sendGate) await turn.sendGate
    const frames = typeof turn.frames === 'function' ? turn.frames(text) : turn.frames
    const aborted = (): boolean => signal?.aborted === true
    const deltas = turn.deltas ?? []
    return {
      async *stream(): AsyncGenerator<SdkMessage> {
        await until(turn.before, signal)
        for (const frame of frames) {
          if (aborted()) return
          yield asMessage(frame)
        }
        if (turn.streamError) throw turn.streamError
      },
      async *events(): AsyncGenerator<SdkTimelineEvent> {
        await until(turn.before, signal)
        if (turn.toolHeld === true) {
          if (aborted()) return
          yield {
            kind: 'delta',
            update: {
              type: 'tool-call-started',
              callId: 'call-1',
              modelCallId: 'call-1',
              toolCall: { callId: 'call-1', name: turn.toolName ?? 'read', args: {} },
            },
          }
          await until(never, signal)
          return
        }
        for (const delta of deltas) {
          if (aborted()) return
          yield { kind: 'delta', update: { type: 'text-delta', text: delta } }
        }
        await until(turn.afterDeltas, signal)
        for (const frame of frames) {
          if (aborted()) return
          yield {
            kind: 'message',
            message: asMessage(frame),
            textAlreadyStreamed: deltas.length > 0,
          }
        }
        if (turn.streamError) throw turn.streamError
      },
      cancel: () => {
        this.cancels += 1
        return Promise.resolve()
      },
      wait: async () => {
        if (!aborted()) {
          if (turn.waitGate) await turn.waitGate
          return turn.result ?? { status: 'finished' }
        }
        if (turn.teardown) await turn.teardown
        return { status: 'cancelled' }
      },
    }
  }
}
