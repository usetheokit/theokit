import type { UIMessage } from 'ai'
import { useCallback, useRef, useState } from 'react'

import { consumeUIMessageStream } from './consume-ui-message-stream.js'

/**
 * M2 (theokit-ai-first) — `useAgent`, the typed client hook for the `agents/*.ts` convention.
 *
 * A thin React hook over `consumeUIMessageStream` (which reuses `ai`'s own UIMessageStream
 * reader). `useAgent('support')` binds to `POST /api/agents/support`; the generated
 * `@theo/agents` module (`.theokit/agents.d.ts`) types `send` to the agent's `input` schema,
 * so the request shape is inferred end-to-end from the server `defineAgent({ input })` with
 * ZERO manual wiring (DoD line 2).
 *
 * Transport: fetch + ReadableStream (POST needs a body; EventSource is GET-only). `ai` is
 * loaded lazily by `consumeUIMessageStream` so non-agent apps never pay for it.
 */
export type UseAgentStatus = 'idle' | 'streaming' | 'done' | 'error'

export interface UseAgentReturn<TInput = unknown, TToolNames extends string = string> {
  /** Reconstructed assistant messages so far (ai `UIMessage[]`). */
  messages: UIMessage[]
  status: UseAgentStatus
  /** The last error, or `undefined`. */
  error: Error | undefined
  /** Send a request; opens a new stream. Typed to the agent's `input` schema. */
  send: (input: TInput) => void
  /** Abort an in-flight stream. */
  abort: () => void
  /** Clear messages + error, back to idle. */
  reset: () => void
  /**
   * The union of tool names this agent can emit (M8), carried end-to-end from the `agent()`
   * builder's accumulated tool-name type through the generated `@theo/agents` client. Type-only
   * witness (never populated at runtime) — narrow a streamed `tool-<name>` part against it. Resolves
   * to the literal union for builder agents (`'read_file' | 'count_lines'`), `string` otherwise.
   */
  readonly __toolNames?: TToolNames
}

export interface UseAgentOptions {
  /** Extra request headers (e.g., auth). */
  headers?: Record<string, string>
  /** Override fetch (primarily for tests). */
  fetch?: typeof fetch
}

/**
 * Bind to the agent endpoint at `path` (`/api/agents/<name>`). Prefer the generated
 * `useAgent` from `@theo/agents` (typed by agent name); this base accepts an explicit path.
 */
export function useAgent<TInput = unknown>(
  path: string,
  options: UseAgentOptions = {},
): UseAgentReturn<TInput> {
  const [messages, setMessages] = useState<UIMessage[]>([])
  const [status, setStatus] = useState<UseAgentStatus>('idle')
  const [error, setError] = useState<Error | undefined>(undefined)
  const controllerRef = useRef<AbortController | null>(null)

  const abort = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
  }, [])

  const reset = useCallback(() => {
    abort()
    setMessages([])
    setError(undefined)
    setStatus('idle')
  }, [abort])

  const send = useCallback(
    (input: TInput) => {
      abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setMessages([])
      setError(undefined)
      setStatus('streaming')

      const fetchImpl = options.fetch ?? globalThis.fetch
      void (async () => {
        try {
          const response = await fetchImpl(path, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              accept: 'text/event-stream',
              'X-Theo-Action': '1',
              ...options.headers,
            },
            body: JSON.stringify(input),
            signal: controller.signal,
          })
          await consumeUIMessageStream(response, (message) => {
            setMessages((prev) => {
              const next = [...prev]
              const idx = next.findIndex((m) => m.id === message.id)
              if (idx >= 0) next[idx] = message
              else next.push(message)
              return next
            })
          })
          setStatus('done')
        } catch (err) {
          if (controller.signal.aborted) return
          setError(err instanceof Error ? err : new Error(String(err)))
          setStatus('error')
        }
      })()
    },
    [abort, options.fetch, options.headers, path],
  )

  return { messages, status, error, send, abort, reset }
}
