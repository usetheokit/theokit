import { BasePlatformAdapter } from '@theokit/gateway'
import type { MessageEvent, OutboundMessage, PlatformName, SendResult } from '@theokit/gateway'

/** A promise the test settles by hand, to hold a connect or a handler at a chosen point. */
export interface Deferred<T> {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

export interface FakeAdapterOptions {
  /** What `connect()` does. Default: resolves true at once. */
  readonly connect?: () => Promise<boolean>
  /** What `sendMessage()` resolves. Default: `{ ok: true, messageId: 'sent-<n>' }`. */
  readonly send?: (message: OutboundMessage) => Promise<SendResult>
}

/**
 * An adapter with no network: it counts connects and disconnects, records what it sent, and
 * delivers through the base class's own `runHandler`, as every real adapter does.
 */
export class FakeAdapter extends BasePlatformAdapter {
  connects = 0
  disconnects = 0
  readonly sent: OutboundMessage[] = []
  #handler: ((event: MessageEvent) => Promise<void>) | undefined

  constructor(
    readonly platform: PlatformName,
    private readonly options: FakeAdapterOptions = {},
  ) {
    super()
  }

  async connect(): Promise<boolean> {
    this.connects += 1
    return this.options.connect ? this.options.connect() : true
  }

  async disconnect(): Promise<void> {
    this.disconnects += 1
  }

  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message)
    return this.options.send ? this.options.send(message) : { ok: true, messageId: `sent-${this.sent.length}` }
  }

  onInbound(handler: (event: MessageEvent) => Promise<void>): () => void {
    this.#handler = handler
    return () => {
      this.#handler = undefined
    }
  }

  deliver(event: MessageEvent): Promise<'ok' | 'no_handler' | 'handler_threw'> {
    return this.runHandler(this.#handler, event)
  }
}

/**
 * An inbound message as `platform` would produce it. The platform-specific block is a stub: the
 * code under test reads only the base fields.
 */
export function messageEvent(platform: PlatformName, text: string, senderId = 'user-1'): MessageEvent {
  return {
    id: `${platform}-message-${senderId}`,
    platform,
    sender: { id: senderId },
    channel: { id: `${platform}-channel-${senderId}`, type: 'dm' },
    text,
    receivedAt: 0,
    [platform]: { raw: null },
  } as unknown as MessageEvent
}

/** The ten platforms of FR-001, in the order the loop starts them. */
export const TEN_PLATFORMS: readonly PlatformName[] = [
  'telegram',
  'discord',
  'slack',
  'matrix',
  'mattermost',
  'email',
  'line',
  'whatsapp',
  'teams',
  'sms',
]

/**
 * Poll `condition` until it holds, failing with `what` once `timeoutMs` passes. Tests wait for a
 * condition, never for a guessed duration (`rules/testing.md` § 3).
 */
export async function waitFor(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/** A stream frame as `@theokit/sdk` emits it, narrowed to what the presenter reads. */
export type SdkFrame = { readonly type: string } & Readonly<Record<string, unknown>>

/** The model's thinking: the presenter drops it from a chat reply. */
export function thinking(text: string): SdkFrame {
  return { type: 'thinking', text }
}

/** An assistant message carrying one text block. */
export function assistant(text: string): SdkFrame {
  return { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }
}

/** The turn's terminal status frame. */
export function finished(): SdkFrame {
  return { type: 'status', status: 'FINISHED' }
}

export interface FakeTurn {
  /** What the stream yields, fixed or computed from the text sent. */
  readonly frames: readonly SdkFrame[] | ((text: string) => readonly SdkFrame[])
  /** Thrown by the stream after its frames. */
  readonly streamError?: Error
  /** What `wait()` resolves. Default `{ status: 'finished' }`. */
  readonly result?: { readonly status: string; readonly error?: { readonly code?: string } }
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
    signal.addEventListener('abort', () => resolve(), { once: true })
    void gate.then(resolve)
  })
}

const never = new Promise<void>(() => undefined)

/** A timeline event as `run.events()` yields it. */
export type FakeTimelineEvent =
  | { readonly kind: 'delta'; readonly update: Readonly<Record<string, unknown>> }
  | { readonly kind: 'message'; readonly message: SdkFrame; readonly textAlreadyStreamed: boolean }

/**
 * An agent with no model: it records what it was sent and the signal each send carried. A run
 * honours its signal as the SDK's does: an abort ends `stream()` and `events()` at the next frame,
 * releases a held `before`, and makes `wait()` resolve `cancelled`.
 */
export class FakeAgent {
  readonly sent: string[] = []
  readonly signals: (AbortSignal | undefined)[] = []
  cancels = 0

  constructor(private readonly turn: FakeTurn) {}

  async send(text: string, options?: { readonly signal?: AbortSignal }) {
    this.sent.push(text)
    const signal = options?.signal
    this.signals.push(signal)
    const turn = this.turn
    if (turn.sendGate) await turn.sendGate
    const frames = typeof turn.frames === 'function' ? turn.frames(text) : turn.frames
    const aborted = (): boolean => signal?.aborted === true
    const deltas = turn.deltas ?? []
    return {
      async *stream(): AsyncGenerator<SdkFrame> {
        await until(turn.before, signal)
        for (const frame of frames) {
          if (aborted()) return
          yield frame
        }
        if (turn.streamError) throw turn.streamError
      },
      async *events(): AsyncGenerator<FakeTimelineEvent> {
        await until(turn.before, signal)
        if (turn.toolHeld === true) {
          if (aborted()) return
          yield { kind: 'delta', update: { type: 'tool-call-started', callId: 'call-1', toolCall: { name: turn.toolName ?? 'read', args: {} } } }
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
          yield { kind: 'message', message: frame, textAlreadyStreamed: deltas.length > 0 }
        }
        if (turn.streamError) throw turn.streamError
      },
      cancel: async () => {
        this.cancels += 1
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

/** A fake agent that counts its disposals, as the session store disposes through `Symbol.asyncDispose`. */
export class DisposableFake extends FakeAgent {
  disposed = 0
  async [Symbol.asyncDispose](): Promise<void> {
    this.disposed += 1
  }
}
