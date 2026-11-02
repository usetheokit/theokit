/**
 * The `ctx` a `route()` handler receives, open to declaration merging.
 *
 * At runtime `ctx` holds what `server/context.ts` returns, what plugins decorate and, when
 * `theo.config.ts` sets `jobs.backend`, `ctx.queue`. The framework cannot see the config from a
 * route file, so it types none of those keys: each is `unknown` until the app declares it, which is
 * the stance of `ctx-reconciliation.ts` (a key typed as present on a route where it is absent is the
 * lie that contract rules out). Before this interface the whole `ctx` was `unknown`, so even
 * `ctx.queue` needed a cast (usetheokit/theokit#1073).
 *
 * An app declares what its config provides, once, in a `.d.ts` file. The scaffold's
 * `types/jobs.d.ts` carries this block, commented out, for apps that set `jobs.backend`:
 *
 * ```ts
 * declare module 'theokit/server/define' {
 *   interface RouteContext {
 *     queue: import('theokit/server/jobs').QueueClient
 *   }
 * }
 * ```
 */
// An interface, not `Record<string, unknown>`: only an interface can be augmented by declaration
// merging, and merging is how an app types the keys its config provides.
// eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
export interface RouteContext {
  [key: string]: unknown
}
