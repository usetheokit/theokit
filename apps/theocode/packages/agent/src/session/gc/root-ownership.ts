import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { collectorRootOwner, type CollectorRootMarkerFormat } from '@theokit/agents/session'

/**
 * Which product may delete inside a transcript root.
 *
 * The transcript root moves with `THEOKIT_HOME`, and the sweep enumerates whatever is there.
 * Measured 2026-09-04 against the built binary: pointed at an empty directory it reported
 * `DRY-RUN — 0 would remove; 0 kept` and exited 0. The SDK's own docblock names that shape — "a
 * wrong path that returns nothing is a collector that quietly stopped collecting" — and it gets
 * worse the moment the root is SHARED with another product.
 *
 * That is no longer hypothetical: the home directory is becoming configurable, so an operator can
 * point this product at `.claude`. Our retention would then enumerate Claude Code's transcripts, and
 * `resolveGuards` protects only ids in OUR registry — a foreign transcript is not in it, is
 * therefore not protected, and a 30-day-old Claude Code session becomes collectable.
 *
 * WHY THE ROOT AND NOT THE FILE. Attributing per transcript means flipping the registry from a
 * protect-list to an allow-list, which stops collecting our own transcripts whose registry entry was
 * pruned — trading a data-loss bug for a silent-leak one, and re-introducing the quiet failure this
 * exists to remove. Ownership is a property of the directory, asked once, at the level the question
 * is actually about.
 *
 * The marker is CONSENT, on disk. An operator who genuinely wants this product to manage a shared
 * root can write one deliberately; nothing here does it on their behalf for a root they did not
 * point us at.
 */
export const OWNERSHIP_MARKER = '.theocode-collector.json'

/** The app name under which this product owns a root. */
export const OWNER = { app: 'theocode' } as const

const VERSION = 1

/**
 * The marker this product writes, in the framework's terms: its own file name and `{product,
 * version}` schema. A future version is not understood and is refused, never downgraded.
 */
export const THEOCODE_MARKER: CollectorRootMarkerFormat = {
  fileName: OWNERSHIP_MARKER,
  ownerOf: (parsed) => {
    const own = parsed as { product?: unknown; version?: unknown } | null
    return own?.product === OWNER.app && own.version === VERSION ? OWNER.app : undefined
  },
}

/**
 * Whether this product may delete inside `projectsRoot`.
 *
 * Every uncertain answer is `false`: no marker, unreadable marker, malformed JSON, another product's
 * name, a version this build does not know. Refusing costs a sweep; the alternative is deleting
 * under a contract we do not understand.
 */
export function rootIsOurs(projectsRoot: string): boolean {
  try {
    return collectorRootOwner(projectsRoot, { existingMarker: THEOCODE_MARKER })?.app === OWNER.app
  } catch {
    return false
  }
}

/**
 * Claim `projectsRoot` for this product, tolerantly, in this product's own marker format.
 *
 * Any marker that EXISTS and is not ours (another product's, a future version of ours, a malformed
 * file) is never overwritten: claiming must not be a way to seize a root from whoever marked it
 * first. A claim that cannot be written is reported by `rootIsOurs` staying false — the collector
 * then refuses, which is the safe direction.
 */
export function claimRoot(projectsRoot: string): void {
  try {
    if (existsSync(join(dirname(projectsRoot), OWNERSHIP_MARKER))) return
    if (collectorRootOwner(projectsRoot, { existingMarker: THEOCODE_MARKER }) !== undefined) return
    mkdirSync(dirname(projectsRoot), { recursive: true })
    const own = { product: OWNER.app, version: VERSION }
    writeFileSync(join(dirname(projectsRoot), OWNERSHIP_MARKER), `${JSON.stringify(own, null, 2)}\n`)
  } catch {
    // Deliberate: the absence of the marker IS the report.
  }
}
