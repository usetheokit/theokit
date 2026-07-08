/**
 * M33 Phase 1 — the ctx reconciliation contract (ADR-0044 D4 / blueprint §5.2, §8.5).
 *
 * ## The problem the deep research verified against our own code
 *
 * At runtime (`execute.ts:122-165`) the handler's `ctx` is written by THREE sources, not one:
 *
 *   1. **the user `context.ts` factory** — via `runMiddlewareAndContext` (`execute.ts:131`). This is
 *      the ONLY writer the author controls + declares a shape for. **This is the typed surface.**
 *   2. **plugin decorations** — `pluginRunner.applyDecorations(ctx)` (`execute.ts:124,136`). Plugins
 *      add arbitrary keys (`decorateRequest`) whose types the route author does not see.
 *   3. **the jobs backend** — `ctx.queue` injected when `jobs.backend` is configured (`execute.ts:141-150`).
 *
 * A naive "infer `TCtx` from everything on `ctx`" would LIE — it cannot see writers (2) and (3), so
 * `ctx.queue` / plugin keys would be typed as present when they are not (or vice-versa). That is the
 * exact Hono/global-augmentation failure the blueprint refuted (§8.5). oRPC/tRPC avoid it only
 * because middleware is their SOLE ctx writer; TheoKit is multi-writer.
 *
 * ## The reconciliation (what this contract locks)
 *
 * The typed `TCtx` a route handler sees reflects **only writer (1)** — the user `context.ts` factory
 * (`ContextValue` below). Writers (2) and (3) are **explicitly untyped** on the route surface:
 *
 *   - `ctx.queue` (jobs) is reached through the dedicated {@link JobsAugmentedCtx} helper, NOT the
 *     inferred `TCtx` — a handler that needs the queue opts into the augmented type explicitly.
 *   - plugin-decorated keys are `unknown` by design (a plugin is a cross-cutting, per-app concern;
 *     typing them into every route's `TCtx` would couple routes to plugin internals — G5).
 *
 * This keeps the LOCKED 5-arity `RouteConfig` generic (`route-config-generic-arity.test.ts`, GAP-4)
 * intact — `TCtx` stays the single typed ctx slot; we only define WHICH writer it corresponds to,
 * so `runtime ⊇ type` holds honestly (the type is a sound subset of the runtime ctx, never a lie).
 *
 * Type-tests proving this live in `tests/ctx-reconciliation.test-d.ts`.
 */

/**
 * The typed run-context a route handler sees = the return of the user `context.ts` factory.
 * `TValue` is inferred from that factory at the web adapter seam; it EXCLUDES plugin decorations and
 * `ctx.queue` (those are not part of the author-declared shape).
 */
export type ContextValue<TValue extends Record<string, unknown> = Record<string, unknown>> = TValue

/** The `ctx.queue` client shape injected by the jobs backend (writer 3). Reached explicitly. */
export interface QueueClientLike {
  enqueue(name: string, input: unknown): void | Promise<void>
}

/**
 * Opt-in augmentation for handlers that read `ctx.queue`. A route that uses the jobs queue annotates
 * its ctx as `JobsAugmentedCtx<MyCtx>` — making the jobs dependency explicit in the type, instead of
 * silently assuming `ctx.queue` exists on every route (which would lie when `jobs.backend` is unset).
 */
export type JobsAugmentedCtx<TValue extends Record<string, unknown> = Record<string, unknown>> =
  TValue & { queue: QueueClientLike }

/**
 * The three runtime ctx writers, named for documentation + the type-test. This is the reconciliation
 * artifact the plan requires as a deliverable (not a footnote).
 */
export const CTX_WRITERS = {
  /** Writer 1 — user `context.ts` factory. THE typed surface (`TCtx`). execute.ts:131 */
  contextFactory: 'context.ts',
  /** Writer 2 — plugin `decorateRequest`. Untyped on the route surface. execute.ts:124,136 */
  pluginDecorations: 'pluginRunner.applyDecorations',
  /** Writer 3 — jobs backend `ctx.queue`. Reached via JobsAugmentedCtx, not TCtx. execute.ts:141-150 */
  jobsQueue: 'jobBackend',
} as const
