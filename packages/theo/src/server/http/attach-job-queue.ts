import type { ServerResponse } from 'node:http'

import { DuplicateContextKeyError } from '../jobs/duplicate-context-key-error.js'
import type { JobBackend } from '../jobs/job-backend.js'
import { createOutbox } from '../jobs/outbox.js'
import { createOutboxDispatcher, createQueueClient } from '../jobs/queue-client.js'

/**
 * Put `ctx.queue` on a handler context and tie its outbox to the response.
 *
 * Jobs a handler enqueues are buffered and reach the backend only after the response finished
 * with a status below 400; an error status or an aborted response discards them, so a failed
 * request leaves no orphan job (T2.1, EC-107).
 *
 * Shared by the route and the action executors. It lived inline in `executeRoute` alone, which is
 * why server actions never got `ctx.queue` (usetheokit/theokit#1096).
 *
 * @throws DuplicateContextKeyError when a plugin or middleware already set `ctx.queue` (EC-202).
 */
export function attachJobQueue(
  ctx: Record<string, unknown>,
  res: ServerResponse,
  jobBackend: JobBackend,
): void {
  if (ctx.queue !== undefined) {
    throw new DuplicateContextKeyError('queue', {
      reason:
        'A plugin or middleware already decorated ctx.queue; choose a different key OR remove jobs.backend from theo.config.ts.',
    })
  }
  const outbox = createOutbox()
  ctx.queue = createQueueClient(jobBackend, outbox)

  res.on('close', () => {
    if (!res.writableFinished) outbox.discard()
  })
  res.on('finish', () => {
    if (res.statusCode >= 400) {
      outbox.discard()
      return
    }
    void outbox.flush(createOutboxDispatcher(jobBackend))
  })
}
