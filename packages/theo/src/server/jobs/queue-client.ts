import type { JobBackend, JobEnqueueInput } from './job-backend.js'
import type { QueueClient } from './job-types.js'
import { createOutbox, type Outbox } from './outbox.js'

export type { EnqueueOptions, QueueClient } from './job-types.js'

/** `ctx.queue.cancelInTransaction` was called with a `jobs.backend` that has no such method. */
export class TransactionalCancelUnsupportedError extends Error {
  readonly code = 'TRANSACTIONAL_CANCEL_UNSUPPORTED'
  readonly backend: string
  constructor(backend: string) {
    super(
      `jobs.backend (${backend}) cannot cancel a job inside the caller's transaction: it has no ` +
        'cancelInTransaction method. Use PostgresJobBackend with its table in the database the ' +
        'transaction runs on.',
    )
    this.name = 'TransactionalCancelUnsupportedError'
    this.backend = backend
  }
}

/**
 * `ctx.queue.enqueueInTransaction` was called with a `jobs.backend` that cannot write through the
 * caller's connection. Enqueueing through the outbox instead would drop the atomicity the caller
 * asked for, so the call fails.
 */
export class TransactionalEnqueueUnsupportedError extends Error {
  readonly code = 'TRANSACTIONAL_ENQUEUE_UNSUPPORTED'
  readonly backend: string
  constructor(backend: string) {
    super(
      `jobs.backend (${backend}) cannot enqueue inside the caller's transaction: it has no ` +
        'enqueueInTransaction method. Use PostgresJobBackend with its table in the database the ' +
        'transaction runs on, or use ctx.queue.enqueue for the after-response outbox.',
    )
    this.name = 'TransactionalEnqueueUnsupportedError'
    this.backend = backend
  }
}

interface CreateQueueClientOptions {
  /** W3C traceparent to propagate to enqueued jobs. */
  traceparent?: string
}

/**
 * Create a per-request queue client wired to a backend + outbox.
 *
 * The backend is referenced only to resolve `enqueueWithId` jobIds at
 * flush time — `enqueue` itself does NOT call backend on the hot path
 * (the transactional outbox guarantee).
 */
export function createQueueClient(
  backend: JobBackend,
  outbox: Outbox,
  opts: CreateQueueClientOptions = {},
): QueueClient {
  const traceparent = opts.traceparent

  return {
    enqueue(name, input, enqueueOpts) {
      const entry: JobEnqueueInput = {
        name: name,
        input,
        idempotencyKey: enqueueOpts?.idempotencyKey,
        delaySeconds: enqueueOpts?.delaySeconds,
        traceparent,
      }
      outbox.push(entry)
    },

    enqueueWithId(name, input, enqueueOpts) {
      let resolveJobId!: (v: { jobId: string }) => void
      let rejectJobId!: (e: unknown) => void
      const promise = new Promise<{ jobId: string }>((resolve, reject) => {
        resolveJobId = resolve
        rejectJobId = reject
      })
      // Prevent unhandled rejection if the response is discarded
      void promise.catch(() => {
        /* swallow — jobId promise is best-effort log correlation */
      })

      // Wrap the entry so the outbox flush resolves the promise.
      const entry: JobEnqueueInput & {
        readonly __resolveJobId?: (v: { jobId: string }) => void
        readonly __rejectJobId?: (e: unknown) => void
      } = {
        name: name,
        input,
        idempotencyKey: enqueueOpts?.idempotencyKey,
        delaySeconds: enqueueOpts?.delaySeconds,
        traceparent,
        __resolveJobId: resolveJobId,
        __rejectJobId: rejectJobId,
      }
      outbox.push(entry)
      return promise
    },

    async enqueueInTransaction(client, name, input, enqueueOpts) {
      if (backend.enqueueInTransaction === undefined) {
        throw new TransactionalEnqueueUnsupportedError(backend.name)
      }
      return backend.enqueueInTransaction(client, {
        name: name,
        input,
        idempotencyKey: enqueueOpts?.idempotencyKey,
        delaySeconds: enqueueOpts?.delaySeconds,
        traceparent,
      })
    },

    async cancelInTransaction(client, name, cancelOpts) {
      if (backend.cancelInTransaction === undefined) {
        throw new TransactionalCancelUnsupportedError(backend.name)
      }
      return backend.cancelInTransaction(client, {
        name,
        idempotencyKey: cancelOpts.idempotencyKey,
      })
    },
  }
}

/**
 * Outbox dispatcher that bridges enqueueWithId's hidden promise channel
 * (`__resolveJobId` / `__rejectJobId`) to the backend.enqueue result.
 *
 * Use this when the request lifecycle hooks call `outbox.flush(...)`.
 */
export function createOutboxDispatcher(
  backend: JobBackend,
): (entry: JobEnqueueInput) => Promise<unknown> {
  return async (entry) => {
    const augmented = entry as JobEnqueueInput & {
      __resolveJobId?: (v: { jobId: string }) => void
      __rejectJobId?: (e: unknown) => void
    }
    try {
      const result = await backend.enqueue(entry)
      augmented.__resolveJobId?.(result)
      return result
    } catch (err) {
      augmented.__rejectJobId?.(err)
      throw err
    }
  }
}

/** A queue bound to one job or cron invocation: buffered jobs go out after the handler returns. */
export interface HandlerQueue {
  readonly queue: QueueClient
  /** Dispatch what the handler buffered. Call after it returned. Per-entry failures are logged. */
  flush(): Promise<void>
  /** Drop what the handler buffered. Call after it threw. */
  discard(): void
}

/**
 * Create the `ctx.queue` of one job or cron invocation, with its own outbox so concurrent
 * invocations never see each other's jobs. With no `backend`, every call rejects (or throws) with
 * an error naming the missing `jobs.backend`, rather than buffering jobs nothing can dispatch.
 */
export function createHandlerQueue(
  backend: JobBackend | undefined,
  opts: CreateQueueClientOptions = {},
): HandlerQueue {
  if (backend === undefined) {
    const fail = (): never => {
      throw new Error(
        'ctx.queue is unavailable: no jobs.backend is configured for this run. Set jobs.backend in theo.config.ts.',
      )
    }
    return {
      queue: {
        enqueue: fail,
        enqueueWithId: () => Promise.reject(new Error('ctx.queue is unavailable: no jobs.backend')),
        enqueueInTransaction: () =>
          Promise.reject(new Error('ctx.queue is unavailable: no jobs.backend')),
        cancelInTransaction: () =>
          Promise.reject(new Error('ctx.queue is unavailable: no jobs.backend')),
      },
      flush: () => Promise.resolve(),
      discard: () => undefined,
    }
  }
  const outbox = createOutbox()
  return {
    queue: createQueueClient(backend, outbox, opts),
    flush: () => outbox.flush(createOutboxDispatcher(backend)),
    discard: () => {
      outbox.discard()
    },
  }
}
