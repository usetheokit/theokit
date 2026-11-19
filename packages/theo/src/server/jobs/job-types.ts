/**
 * Job primitive types (R0.5.5-9).
 */

/**
 * Type registry for jobs. Users extend via module augmentation:
 *
 * ```ts
 * declare module 'theokit/server/jobs' {
 *   interface JobRegistry {
 *     'process-document': { documentId: string }
 *     'send-email': { to: string; subject: string }
 *   }
 * }
 * ```
 *
 * Augment `theokit/server/jobs`, the module `QueueClient` is declared in. The deprecated
 * `theokit/server` reaches `QueueClient` only when some file also imports that umbrella, so in an
 * app that imports subpaths only every job name stayed `never` (usetheokit/theokit#1074).
 *
 * Once augmented, `ctx.queue.enqueue<'process-document'>(...)` gets full
 * type inference on the `input` argument.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface JobRegistry {}
