/**
 * Shared DI resolution helper for guards, interceptors, and middleware.
 * Extracted to avoid DRY violation (EC-3) — was duplicated in create-server.ts
 * and theokit-plugin.ts.
 */

/** DI container interface — structural match for @theokit/di Container. */
export interface DiContainer {
  resolve<T>(token: Function): T
}

/**
 * Resolve a class via DI container if provided; otherwise fall back to bare `new`.
 * Guards, interceptors, and middleware classes all use this pattern.
 */
export function resolveOrNew(Ctor: Function, container?: DiContainer): object {
  if (container) {
    try {
      return container.resolve(Ctor)
    } catch {
      // MissingInjectableError or similar — fall back to bare new
    }
  }
  return new (Ctor as new () => object)()
}
