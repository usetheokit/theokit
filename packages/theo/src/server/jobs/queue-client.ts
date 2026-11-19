import type { PoolLike } from '../storage/storage-types.js'

import type { JobBackend, JobEnqueueInput } from './job-backend.js'
import type { JobRegistry } from './job-types.js'
import { createOutbox, type Outbox } from './outbox.js'

/**
 * Options forwarded to `backend.enqueue` at outbox flush time.
 */
export interface EnqueueOptions {
  /** Optional idempotency key for at-most-once dispatch within TTL. */
  idempotencyKey?: string
  /** Optional delay before the job becomes available. */
  delaySeconds?: number
}

/**
 * Typed queue client. `enqueue` returns `void` and buffers
 * to the per-request outbox. `enqueueWithId` is the log-correlation
 * variant that resolves to `{ jobId }` AFTER the outbox flushes.
 *
 * Type inference: `JobName extends keyof JobRegistry`. Users extend the
 * `JobRegistry` interface via module augmentation (see `job-types.ts`).
 * Without augmentation, all enqueue calls compile-error with "Type X is
 * not assignable to type never" — documented in EC-110 as a known onboarding
 * friction.
 */
export interface QueueClient {
  /** Buffer a job to the outbox. Returns void (fire-and-forget). */
  enqueue<JobName extends keyof JobRegistry>(
    name: JobName,
    input: JobRegistry[JobName],
    opts?: EnqueueOptions,
  ): void
  /**
   * Buffer a job AND return a Promise that resolves with the jobId
   * AFTER the outbox flushes (i.e., after the response commits, or after a job or cron handler
   * returns). NOT a handle to await the job result — there is no result API. Do not await it
   * inside a job or cron handler: it settles only after the handler returns, so awaiting it there
   * never finishes.
   */
  enqueueWithId<JobName extends keyof JobRegistry>(
    name: JobName,
    input: JobRegistry[JobName],
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }>
  /**
   * Write the job NOW through `client`, a connection inside a transaction you opened, so it commits
   * or rolls back with your own writes (usetheokit/theokit#1077). It bypasses the per-request
   * outbox: the response status (or a job or cron handler's outcome) does not decide whether the
   * job exists, your transaction does.
   * Needs a backend with `enqueueInTransaction` (`PostgresJobBackend`, whose table must live in the
   * database `client` is connected to); any other backend rejects with
   * `TransactionalEnqueueUnsupportedError`.
   */
  enqueueInTransaction<JobName extends keyof JobRegistry>(
    client: PoolLike,
    name: JobName,
    input: JobRegistry[JobName],
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }>
  /**
   * Remove the queued job `(name, idempotencyKey)` through `client`, inside your transaction, so
   * the removal commits or rolls back with your writes (usetheokit/theokit#2118). Resolves `true`
   * when a job was removed, `false` when none was: a job a worker leased (even with an expired
   * lease) or that failed is left alone. A backend without `cancelInTransaction` rejects with
   * `TransactionalCancelUnsupportedError`.
   */
  cancelInTransaction(
    client: PoolLike,
    name: keyof JobRegistry,
    opts: { idempotencyKey: string },
  ): Promise<boolean>
}

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
