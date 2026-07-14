import type { UIMessage } from 'ai'
import { useMemo, useRef, useSyncExternalStore } from 'react'

import { AgentClient, type UseAgentStatus } from './agent-client.js'
import { HttpTransport } from './http-transport.js'
import type { AgentTransport, ApprovalDecision, RequestContext } from './transport.js'

/**
 * M2 (theokit-ai-first) / M41 (ADR-0050) — `useAgent`, the ONE typed client hook for the
 * `agents/*.ts` convention, unified across surfaces.
 *
 * Pass an endpoint path (web) OR an {@link AgentTransport} (terminal/desktop). A string is wrapped in
 * an {@link HttpTransport} (exact back-compat with the pre-M41 fetch+SSE hook); an `InProcessTransport`
 * drives the SAME hook in a single process. The hook is a thin binding over the framework-agnostic
 * {@link AgentClient} store via React's native `useSyncExternalStore` (no test-DOM dependency). The
 * generated `@theo/agents` module types `send` to the agent's `input` schema — inferred end-to-end
 * from the server `defineAgent({ input })` with ZERO manual wiring.
 */
export type { UseAgentStatus }

export interface UseAgentReturn<TInput = unknown, TToolNames extends string = string> {
  /** The CURRENT turn's assistant messages (per-turn; reset each `send`). Back-compat since M41. */
  messages: UIMessage[]
  /**
   * M46 — the full conversation to render: committed turns + the current turn's user + in-flight
   * assistant, accumulated across sends with stable ids. Prefer this over hand-rolling a transcript
   * from `messages`. Same shape on every surface (web/desktop/TUI) — it lives in the core store.
   */
  thread: UIMessage[]
  status: UseAgentStatus
  /** The last error, or `undefined`. */
  error: Error | undefined
  /** Send a request; opens a new stream. Typed to the agent's `input` schema. */
  send: (input: TInput) => void
  /** Abort an in-flight stream. */
  abort: () => void
  /** Clear messages + error, back to idle. */
  reset: () => void
  /** Settle a paused HITL approval (HTTP `POST /approve/<id>` for web; the inline callback in-process). */
  approve: (approvalId: string, decision: ApprovalDecision) => Promise<void>
  /** Resume an interrupted stream (M37 durable transport for web; a no-op in-process). */
  reconnect: () => void
  /**
   * The union of tool names this agent can emit (M8), carried end-to-end from the `agent()` builder's
   * accumulated tool-name type through the generated `@theo/agents` client. Type-only witness (never
   * populated at runtime). Resolves to the literal union for builder agents, `string` otherwise.
   */
  readonly __toolNames?: TToolNames
}

export interface UseAgentOptions {
  /**
   * Extra request headers (e.g., auth) — applied when a string path builds an `HttpTransport`. Read on
   * EVERY request, so a value that changes across renders (a rotating JWT) is never sent stale.
   */
  headers?: Record<string, string>
  /** Override fetch (primarily for tests) — captured when a string path builds an `HttpTransport`. */
  fetch?: typeof fetch
  /**
   * M43 — per-request context attached uniformly to EVERY transport (`headers` → HTTP request headers;
   * `metadata` → the in-process runner / Tauri invoke). A value OR a resolver evaluated on every
   * send/reconnect, so a rotating token/tenant is never stale.
   */
  context?: RequestContext | (() => RequestContext | undefined)
}

/**
 * Bind to an agent by endpoint path (`/api/agents/<name>`) or by an explicit {@link AgentTransport}.
 * Prefer the generated `useAgent` from `@theo/agents` (typed by agent name); this base accepts a path
 * or a transport. The store is created once per binding identity — memoize a transport before passing it.
 */
export function useAgent<TInput = unknown>(
  pathOrTransport: string | AgentTransport,
  options: UseAgentOptions = {},
): UseAgentReturn<TInput> {
  // Track the latest options so the built HttpTransport reads current headers per request (dynamic
  // auth is never stale) without rebuilding the store — which would drop in-flight messages.
  const optionsRef = useRef(options)
  optionsRef.current = options

  const client = useMemo(
    () =>
      new AgentClient<TInput>(
        typeof pathOrTransport === 'string'
          ? new HttpTransport({
              api: pathOrTransport,
              headers: () => optionsRef.current.headers,
              fetch: optionsRef.current.fetch,
            })
          : pathOrTransport,
        // M43 — resolve context live from the ref each send/reconnect (never stale). A value or a resolver.
        () => {
          const ctx = optionsRef.current.context
          return typeof ctx === 'function' ? ctx() : ctx
        },
      ),
    // Identity is the binding; headers/context are resolved live via optionsRef, fetch captured at creation.
    [pathOrTransport],
  )

  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)

  return {
    messages: state.messages,
    thread: state.thread,
    status: state.status,
    error: state.error,
    send: client.send,
    abort: client.abort,
    reset: client.reset,
    approve: client.approve,
    reconnect: client.reconnect,
  }
}
