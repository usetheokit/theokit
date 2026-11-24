import { BasePlatformAdapter } from '@theokit/gateway'
import type { MessageEvent, OutboundMessage, PlatformName, SendResult } from '@theokit/gateway'
import { FakeAgent } from '@theokit/agents/testing'
import type { SdkMessage } from '@theokit/agents/bridge'
import type { SdkFrame } from '@theokit/agents/testing'

import type { TurnMessage } from '../src/agent-port.js'

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
    return this.options.send
      ? this.options.send(message)
      : { ok: true, messageId: `sent-${this.sent.length}` }
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
export function messageEvent(
  platform: PlatformName,
  text: string,
  senderId = 'user-1',
): MessageEvent {
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
 * condition, never for a guessed duration (`rules/testing.md` § 3). A function for `what` is read at
 * the deadline, so a description that shows a screen shows the screen that failed, not the one the
 * wait began on.
 */
export async function waitFor(
  condition: () => boolean,
  timeoutMs: number,
  what: string | (() => string),
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${timeoutMs} ms waiting for ${typeof what === 'function' ? what() : what}`,
      )
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
}

export type { FakeTimelineEvent, FakeTurn, SdkFrame } from '@theokit/agents/testing'
export { FakeAgent }

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

/** A fake agent that counts its disposals, as the session store disposes through `Symbol.asyncDispose`. */
export class DisposableFake extends FakeAgent {
  disposed = 0
  async [Symbol.asyncDispose](): Promise<void> {
    this.disposed += 1
  }
}

/** The text of a message the port carries, whether it was sent as a string or with images. */
export function turnText(message: TurnMessage): string {
  return typeof message === 'string' ? message : message.text
}

/** A loosely built frame as the bridge's `SdkMessage`: the one trusted cast of a hand-written fake stream. */
export function sdkMessage(frame: { readonly type: string } & Readonly<Record<string, unknown>>): SdkMessage {
  return frame as unknown as SdkMessage
}
