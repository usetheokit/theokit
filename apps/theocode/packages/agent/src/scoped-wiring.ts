import { recordWiring, type WiredEntity, type WiringOffReason } from '@theokit/sdk'

/** Entities of one capability that share a scope and a gate. */
interface ScopedWiringGroup {
  /** The names handed to the builder for this scope. */
  readonly names: readonly string[]
  /** Where they came from (`project`, `personal`, `operator`, …); undefined records no scope. */
  readonly scope?: string
  /** False when the posture does not govern this group (the operator's own, never project-gated). */
  readonly gated: boolean
}

/** What {@link recordScopedWiring} takes for one capability. */
export interface ScopedWiringCapability {
  readonly groups: readonly ScopedWiringGroup[]
  /** Sort the combined `active` list; otherwise it keeps group order (a precedence is not alphabetical). */
  readonly sort?: boolean
}

/** The order `Array.prototype.sort` gives, which a listing already relies on. */
function byCodeUnit(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

/**
 * `recordWiring` for capabilities whose entities come from more than one scope.
 *
 * The SDK gates a whole capability at once, so a capability with a trust-gated project share and an
 * ungated personal share cannot be recorded in one call without marking the personal share
 * suppressed. This records each group on its own (through the posture, or an open gate) and
 * combines them: `active` is the union, `entities` keeps one row per name AND scope, and `off` is
 * set only when nothing of the capability is active.
 *
 * @throws UngatedCapabilityError (from the SDK) when a gated group's capability has no posture gate.
 */
export function recordScopedWiring<K extends string>(input: {
  readonly posture: { readonly allows: Readonly<Record<string, boolean>> }
  readonly requested: Readonly<Record<K, ScopedWiringCapability>>
}): Readonly<Record<K, WiredEntity>> {
  const out = {} as Record<K, WiredEntity>
  for (const capability of Object.keys(input.requested) as K[]) {
    const { groups, sort } = input.requested[capability]
    const records = groups.map((group) => recordGroup(capability, group, input.posture))
    const active = [...new Set(records.flatMap((r) => r.active))]
    const off: WiringOffReason | undefined =
      active.length === 0 ? records.find((r) => r.off !== undefined)?.off : undefined
    out[capability] = {
      active: sort === true ? [...active].sort(byCodeUnit) : active,
      requested: [...new Set(records.flatMap((r) => r.requested))],
      suppressedByTrust: records.some((r) => r.suppressedByTrust),
      entities: records.flatMap((r) => r.entities),
      off,
    }
  }
  return out
}

function recordGroup(
  capability: string,
  group: ScopedWiringGroup,
  posture: { readonly allows: Readonly<Record<string, boolean>> },
): WiredEntity {
  const { scope } = group
  const record = recordWiring<string>({
    posture: group.gated ? posture : { allows: { [capability]: true } },
    requested: { [capability]: group.names },
    ...(scope !== undefined ? { scopes: { [capability]: group.names.map(() => scope) } } : {}),
  })
  return record[capability]
}
