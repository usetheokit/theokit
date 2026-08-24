/**
 * One object per PROCESS, whatever the bundler did to the module holding it.
 *
 * ## The defect this exists to remove
 *
 * A module-level `let x` gives one instance per **module instance**, and a bundler is free to place
 * the same source in more than one chunk. When it does, each chunk gets its own `x` and any state
 * written through one is invisible through the other.
 *
 * Measured in this repository's own `dist` (usetheokit/theokit#401) by grepping the built chunks for
 * each module's marker: `provider-resolver` lands in two chunks, and `approval-registry` in two.
 * Neither copy is redundant — one of the provider chunks is tree-shaken to `resolveProvider` and
 * does not carry `resetProviderRegistry` at all, which is precisely how the halves diverge: an
 * application calling `registerProvider` — public API, with a documented self-hosting example —
 * mutated the array in one chunk while `theokit start` resolved against the array in the other.
 *
 * The second is worse in kind, because `approval-registry.ts` states the requirement in its own
 * source: *"the approval a request awaits and the approval the route resolves MUST be the same
 * object, so a single instance per process is not a convenience but a correctness requirement."* A
 * chunk boundary can break that silently, and the symptom would be a HITL pause that never resumes.
 *
 * ## Why `globalThis` and not better chunking
 *
 * Chunking is a bundler heuristic that changes between versions and with the shape of the import
 * graph. A fix that depends on tsup continuing to place this module in exactly one chunk is a fix
 * that holds until someone adds an import. `Symbol.for` gives a key that is equal across every
 * module instance in the realm, so identity stops depending on the build at all.
 *
 * @internal
 */

/** Namespaced so a key cannot collide with an unrelated global. */
const NAMESPACE = 'theokit.singleton.'

/**
 * The object registered under `key`, creating it with `factory` the first time.
 *
 * `factory` runs at most once per process. A later call with the same key returns what the first
 * call built and never replaces it — replacing it is the same defect wearing a different hat, since
 * two callers would again hold different objects.
 */
export function processSingleton<T extends object>(key: string, factory: () => T): T {
  const slot = Symbol.for(NAMESPACE + key)
  const host = globalThis as unknown as Record<symbol, T | undefined>

  const existing = host[slot]
  if (existing !== undefined) return existing

  const created = factory()
  host[slot] = created
  return created
}
