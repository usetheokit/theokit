import type { UIMessage } from 'ai'

import { AgentClient, type AgentClientState } from './agent-client.js'
import type { AgentTransport, ApprovalDecision, RequestContext } from './transport.js'

export interface CreateAgentClientOptions {
  /**
   * M43 — per-request context attached to every turn (`headers` → HTTP; `metadata` → in-process/channel).
   * A value OR a resolver. **To keep context live across sends, pass a RESOLVER** (`() => ({...})`) — a
   * plain value is captured at construction and not re-read, so mutating `options.context` afterwards has
   * no effect (unlike `useAgent`, which reads a live ref). A resolver is re-evaluated every send/reconnect.
   */
  context?: RequestContext | (() => RequestContext | undefined)
}

/**
 * M44 (ADR-0053) — the standalone (no-React) agent client. A plain handle over the framework-agnostic
 * {@link AgentClient} store: drive a turn, observe state, settle HITL — from a node script, a CLI, a
 * test, or a non-React UI, over ANY {@link AgentTransport}.
 */
export interface AgentClientHandle<TInput = unknown> {
  /** Send a typed input; opens a fresh stream (replaces prior messages). */
  send(input: TInput): void
  /** Abort an in-flight stream. */
  abort(): void
  /** Clear messages + error, back to idle. */
  reset(): void
  /** Settle a paused HITL approval via the transport's HITL path. */
  approve(approvalId: string, decision: ApprovalDecision): Promise<void>
  /** Resume an interrupted stream (no-op when the transport can't). */
  reconnect(): void
  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(listener: () => void): () => void
  /** The current immutable snapshot (messages / status / error). */
  getState(): AgentClientState
  /**
   * Drive one turn and yield the assistant `UIMessage` as it streams (progressive snapshots); iteration
   * ends when the turn settles. A `for await` script takes the last yielded value as the final result;
   * a failed turn rejects the iterator with the run error.
   */
  stream(input: TInput): AsyncIterable<UIMessage>
}

/** Drive a turn on the store and yield the latest assistant message on each streaming update. */
function streamTurn<TInput>(client: AgentClient<TInput>, input: TInput): AsyncIterable<UIMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      const pending: UIMessage[] = []
      let finished = false
      let streamError: Error | undefined
      let notify: (() => void) | null = null
      // Read via functions — `finished`/`streamError` flip ASYNC in the subscribe callback, so a direct
      // read would be wrongly narrowed to its initial literal by control-flow analysis (M41 pattern).
      const isFinished = (): boolean => finished
      const takeError = (): Error | undefined => streamError

      const unsubscribe = client.subscribe(() => {
        const snapshot = client.getSnapshot()
        if (snapshot.status === 'streaming') {
          // Push the growing assistant message ONLY on streaming updates. The terminal ('done'/'error')
          // emit carries the SAME final message already yielded on the last streaming update — pushing it
          // again would yield a duplicate. So the terminal emit only flips `finished` (+ captures error).
          const last = snapshot.messages.at(-1)
          if (last !== undefined) pending.push(last)
        } else {
          if (snapshot.status === 'error') streamError = snapshot.error
          finished = true
        }
        notify?.()
      })

      client.send(input)
      try {
        for (;;) {
          while (pending.length > 0) {
            const message = pending.shift()
            if (message !== undefined) yield message
          }
          if (isFinished()) break
          await new Promise<void>((resolve) => {
            notify = resolve
            // Close the lost-wakeup window: an emit may have fired during the drain, BEFORE `notify` was
            // set (its `notify?.()` was then a no-op). If work already arrived, resolve now, don't sleep.
            if (pending.length > 0 || isFinished()) resolve()
          })
          notify = null
        }
        const err = takeError()
        if (err !== undefined) throw err
      } finally {
        // Runs on normal completion AND on early `break` (the for-await calls the generator's return()):
        // stop observing, and abort the turn so an early-exiting consumer doesn't leave it running (abort
        // is a no-op once the turn has settled).
        unsubscribe()
        client.abort()
      }
    },
  }
}

/**
 * Create a standalone (no-React) agent client over a transport. `useAgent` is the React binding over the
 * same store; this is the equivalent for any JS runtime — one agent, consumable everywhere on the seam.
 */
export function createAgentClient<TInput = unknown>(
  transport: AgentTransport,
  options: CreateAgentClientOptions = {},
): AgentClientHandle<TInput> {
  const { context } = options
  const contextResolver =
    context === undefined
      ? undefined
      : (): RequestContext | undefined => (typeof context === 'function' ? context() : context)
  const client = new AgentClient<TInput>(transport, contextResolver)

  return {
    send: client.send,
    abort: client.abort,
    reset: client.reset,
    approve: client.approve,
    reconnect: client.reconnect,
    subscribe: client.subscribe,
    getState: client.getSnapshot,
    stream: (input: TInput) => streamTurn(client, input),
  }
}
