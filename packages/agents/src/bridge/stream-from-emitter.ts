/**
 * Turn a producer that PUSHES events to a callback into an `AsyncIterable` a reader PULLS from, the
 * shape `generateAgentRoutes` and `streamAgentResponse` take.
 *
 * Two rules make the bridge correct: `return()` stops the producer at once, even while a read waits on
 * a silent model; and a turn that already produced a final event is not cancelled when the reader stops
 * at it.
 */

export interface StreamFromEmitterOptions<E extends { type: string }> {
  /** e.g. `request.signal`. Aborting it aborts the signal `start` receives and ends the iteration. */
  signal?: AbortSignal
  /** Default: type `done` or `error`. After a final event, `return()` does not abort the producer. */
  isFinal?: (event: E) => boolean
  /** The event emitted when `start` rejects and no error event was seen. `undefined` emits nothing. */
  onError?: (error: unknown) => E | undefined
}

const defaultIsFinal = (event: { type: string }): boolean =>
  event.type === 'done' || event.type === 'error'

export function streamFromEmitter<E extends { type: string }>(
  start: (emit: (event: E) => void, signal: AbortSignal) => Promise<unknown>,
  options: StreamFromEmitterOptions<E> = {},
): AsyncIterable<E> {
  const isFinal = options.isFinal ?? defaultIsFinal
  return {
    [Symbol.asyncIterator](): AsyncIterator<E> {
      const controller = new AbortController()
      const queue: E[] = []
      let closed = false
      let sawFinal = false
      let sawError = false
      const waiters = new Set<() => void>()

      const notify = (): void => {
        const pending = [...waiters]
        waiters.clear()
        for (const wake of pending) wake()
      }
      const close = (): void => {
        closed = true
        options.signal?.removeEventListener('abort', onAbort)
        notify()
      }
      const push = (event: E): void => {
        if (closed) return
        if (event.type === 'error') sawError = true
        if (isFinal(event)) sawFinal = true
        queue.push(event)
        notify()
      }
      function onAbort(): void {
        controller.abort(options.signal?.reason)
        close()
      }

      if (options.signal?.aborted) onAbort()
      else options.signal?.addEventListener('abort', onAbort, { once: true })

      const settle = async (): Promise<void> => {
        try {
          await start(push, controller.signal)
        } catch (error: unknown) {
          if (!sawError && !closed) {
            const event = options.onError?.(error)
            if (event !== undefined) push(event)
          }
        }
        close()
      }
      void settle()

      return {
        async next(): Promise<IteratorResult<E>> {
          for (;;) {
            const next = queue.shift()
            if (next !== undefined) return { done: false, value: next }
            if (closed) return { done: true, value: undefined }
            await new Promise<void>((resolve) => {
              waiters.add(resolve)
            })
          }
        },
        return(): Promise<IteratorResult<E>> {
          if (!sawFinal && !closed) controller.abort()
          queue.length = 0
          close()
          return Promise.resolve({ done: true, value: undefined })
        },
      }
    },
  }
}
