import type { BasePlatformAdapter } from '@theokit/gateway'

/** Platforms drop a typing indicator after a few seconds, so it is renewed this often. */
export const TYPING_RENEW_MS = 4_000

/** How a turn reaches its platform's typing indicator (OC-106). */
export interface TypingOptions {
  /** The started adapter of a platform, or undefined while it is not started. */
  readonly adapterFor: (platform: string) => BasePlatformAdapter | undefined
  /** Renewal period; default `TYPING_RENEW_MS`. */
  readonly renewMs?: number
  /** `THEOCLAW_ACK_REACTION`: the emoji that reacts to an inbound message when its turn starts. */
  readonly ackReaction?: string
}

/** The reaction method a gateway adapter may offer; an adapter without it cannot acknowledge. */
interface ReactingAdapter {
  addReaction(channelId: string, messageId: string, emoji: string): Promise<unknown>
}

/** The emoji `THEOCLAW_ACK_REACTION` names, or undefined while it is unset or `off`. */
export function readAckReaction(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const value = env.THEOCLAW_ACK_REACTION?.trim()
  return value === undefined || value === '' || value.toLowerCase() === 'off' ? undefined : value
}

/** React to the inbound message with the ack emoji. Best effort: it never fails the turn. */
export function ackInbound(options: TypingOptions | undefined, platform: string, channelId: string, messageId: string): void {
  const emoji = options?.ackReaction
  const adapter = options?.adapterFor(platform) as Partial<ReactingAdapter> | undefined
  if (emoji === undefined || typeof adapter?.addReaction !== 'function') return
  void Promise.resolve()
    .then(() => adapter.addReaction?.(channelId, messageId, emoji))
    .catch(() => undefined)
}

/**
 * Show a typing indicator in `channelId` until the returned function is called. Best effort: an
 * adapter that cannot show one, or that throws, never fails the turn. The stop is idempotent.
 */
export function showTyping(options: TypingOptions | undefined, platform: string, channelId: string): () => Promise<void> {
  const adapter = options?.adapterFor(platform)
  if (options === undefined || adapter === undefined) return async () => undefined
  const start = (): void => {
    void adapter.startTyping(channelId).catch(() => undefined)
  }
  start()
  const timer = setInterval(start, options.renewMs ?? TYPING_RENEW_MS)
  timer.unref()
  let stopped = false
  return async () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    await adapter.stopTyping(channelId).catch(() => undefined)
  }
}
