/**
 * Shared DI resolution helper for guards, interceptors, and middleware.
 * Extracted to avoid DRY violation (EC-3) — was duplicated in create-server.ts
 * and theokit-plugin.ts.
 */

/** DI container interface — structural match for @theokit/di Container. */
export interface DiContainer {
  resolve(token: Function): unknown
  /** @theokit/di Container has it; optional so other containers keep working. */
  has?(token: Function): boolean
}

/** True when `err` says the container has no registration for `Ctor` itself. */
function isMissingSelf(err: unknown, Ctor: Function): boolean {
  if (!(err instanceof Error)) return false
  if (err.name !== 'MissingInjectableError' && err.name !== 'TokenNotFoundError') return false
  const token = (err as { token?: unknown }).token
  if (token !== undefined) return Object.is(token, Ctor)
  return err.message.includes(Ctor.name)
}

/**
 * Resolve a class via DI container if provided; otherwise fall back to bare `new`.
 * Guards, interceptors, and middleware classes all use this pattern.
 *
 * The fallback applies only when the container has no registration for `Ctor`
 * itself. Any other container error (missing dependency, scope violation,
 * cycle, throwing constructor) propagates to the caller.
 */
export function resolveOrNew(Ctor: Function, container?: DiContainer): object {
  if (container) {
    if (container.has !== undefined) {
      if (container.has(Ctor)) return container.resolve(Ctor) as object
    } else {
      try {
        return container.resolve(Ctor) as object
      } catch (err) {
        if (!isMissingSelf(err, Ctor)) throw err
      }
    }
  }
  return new (Ctor as new () => object)()
}
