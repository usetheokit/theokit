/**
 * JobRegistry augmentation — REQUIRED for typed `ctx.queue.enqueue` calls.
 *
 * Without this augmentation, `ctx.queue.enqueue('foo', ...)` errors with:
 *   "Type 'foo' is not assignable to type 'never'"
 *
 * This is the canonical TheoKit jobs onboarding bug (EC-110). To add a
 * job:
 *
 * 1. Create `src/server/jobs/<name>.ts` exporting `defineJob('<name>', ...)`
 * 2. Add `'<name>': { ...inputShape }` below
 * 3. Set `jobs.backend` in `theo.config.ts` and uncomment the
 *    `RouteContext` block at the end of this file
 * 4. Use `ctx.queue.enqueue('<name>', { ...input })` from any route handler
 *
 * The registry lives in `theokit/server/jobs`, the module `QueueClient` comes
 * from, so it works in an app that imports only `theokit/server/<domain>`
 * subpaths.
 */
declare module 'theokit/server/jobs' {
  interface JobRegistry {
    // Add your jobs here. Examples (uncomment and customize):
    //
    // 'process-document': { documentId: string }
    // 'send-email': { to: string; subject: string; body: string }
  }
}

// `ctx.queue` exists on every route only when theo.config.ts sets
// `jobs.backend`, which is why this block starts commented out. Uncomment it
// once yours does, and `ctx.queue` is typed in `route().handler(({ ctx }) => ...)`:
//
// declare module 'theokit/server/define' {
//   interface RouteContext {
//     queue: import('theokit/server/jobs').QueueClient
//   }
// }

export {}
