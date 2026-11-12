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

/** True when the error says the container does not know `Ctor` itself. */
function isMissingCtor(err: unknown, Ctor: Function): boolean {
  if (typeof err !== 'object' || err === null) return false
  const { name, message } = err as { name?: unknown; message?: unknown }
  return (
    (name === 'MissingInjectableError' || name === 'TokenNotFoundError') &&
    typeof message === 'string' &&
    Ctor.name !== '' &&
    message.includes(Ctor.name) &&
    // a missing dependency of Ctor names that dependency first, not Ctor
    !/\bwhile resolving\b|\brequired by\b|\bdependency\b/i.test(message)
  )
}

/**
 * Resolve a class via DI container if provided; otherwise fall back to bare `new`.
 * The fallback applies only when the container has no registration for `Ctor`
 * itself; any other container error (missing dependency, scope violation,
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
        if (!isMissingCtor(err, Ctor)) throw err
      }
    }
  }
  return new (Ctor as new () => object)()
}
