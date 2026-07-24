/**
 * Typed authoring failures for `@theokit/agents`.
 *
 * This module lives at the package root and imports NOTHING — deliberately. `bridge/` and
 * `capability/` both need to throw the same typed error, and the class used to live inside
 * `capability/capabilities.ts`, which imports `bridge/agent-compiler.js`. Having `bridge/` import
 * it back from there would close an import cycle, so the error moved to a leaf module that neither
 * layer owns (`rules/architecture.md` § 2 — a shared contract belongs to neither side of a
 * boundary).
 *
 * M56 removed the compatibility re-export that `capability/capabilities.ts` carried: one class with
 * two import paths was a concession to not-breaking-consumers, not a design. Import it from here.
 */

/** Typed authoring failure — surfaced at build time, never a silent bad agent. */
export class ConfigurationError extends Error {
  override readonly name = 'ConfigurationError'
}
