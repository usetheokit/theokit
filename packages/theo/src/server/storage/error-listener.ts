import type { TheoLogger } from '../observability/logger.js'

import type { PoolLike } from './storage-types.js'

/**
 * Node throws an `error` event nobody listens to, and the drivers theokit is handed emit one on
 * ordinary network trouble: `pg.Pool` for every idle client the server disconnects, node-redis for a
 * dropped socket. One `pg_terminate_backend` exited `theokit start` with `Unhandled 'error' event`
 * (usetheokit/theokit#1019, #1037). These helpers attach a logging listener to such an emitter when
 * it has none; a listener the user attached is their decision and stays the only one.
 */
interface ErrorEvents {
  on: (event: 'error', listener: (err: Error & { code?: string }) => void) => unknown
  listenerCount?: (event: 'error') => number
}

function hasEventApi<T extends object>(emitter: T): emitter is T & ErrorEvents {
  return typeof (emitter as Partial<ErrorEvents>).on === 'function'
}

/**
 * Attach `listener` as the `error` handler of `emitter` unless it has no event API or already has
 * an `error` listener.
 */
export function listenForErrorsUnlessHandled(
  emitter: object,
  listener: (err: Error & { code?: string }) => void,
): void {
  if (!hasEventApi(emitter)) return
  if (typeof emitter.listenerCount === 'function' && emitter.listenerCount('error') > 0) return
  emitter.on('error', listener)
}

/**
 * Keep a Postgres pool's `error` event from exiting the process: log it as a structured warning
 * with `fields` (which name the pool's owner) plus the Postgres error code. `pg-pool` has already
 * discarded the dead client, so the next query opens a new connection.
 */
export function keepPoolErrorsFromExitingTheProcess(
  pool: PoolLike,
  logger: TheoLogger,
  fields: Record<string, unknown>,
): void {
  listenForErrorsUnlessHandled(pool, (err) => {
    logger.warn('postgres pool error; the client was discarded and the pool reconnects', {
      ...fields,
      code: err.code,
      error: err.message,
    })
  })
}
