import { createWriteQueue } from '@theokit/tui/terminal'

/**
 * THE write queue for this application (B-104).
 *
 * The implementation moved to `@theokit/tui/terminal`, where it is a factory rather than
 * module-level state — correct for a library, since two consumers in one process must not serialise
 * against each other. An application has one of everything, so the instance belongs here, at the
 * only place that can guarantee there is exactly one.
 *
 * That guarantee is the whole reason this file still exists instead of every caller creating its
 * own. Two queues over the same file would interleave writes to it, and nothing would fail loudly:
 * the file would simply be wrong, occasionally, under concurrency.
 */
const queue = createWriteQueue()

/** Run `op` after everything already queued under `key`. */
export const enqueue = <T>(key: string, op: () => Promise<T>): Promise<T> => queue.enqueue(key, op)

/** Resolve once every key has settled. Used at shutdown. */
export const drainAll = (): Promise<void> => queue.drainAll()
