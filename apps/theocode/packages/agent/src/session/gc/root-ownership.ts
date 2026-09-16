import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

/** What a marker this product wrote says. A future schema bumps `version` and is refused by old builds. */
interface Ownership {
  readonly product: string
  readonly version: number
}

const PRODUCT = 'theocode'
const VERSION = 1

/**
 * Beside the projects directory, never inside it.
 *
 * `listProjectDirs` enumerates everything under `projects/`, so a marker in there would be a file in
 * the middle of the one path that deletes user data. `stampPath` already made this call for
 * `.last-session-gc`; this follows it rather than re-deciding it.
 */
function markerPath(projectsRoot: string): string {
  return join(dirname(projectsRoot), OWNERSHIP_MARKER)
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
    const raw: unknown = JSON.parse(readFileSync(markerPath(projectsRoot), 'utf8'))
    const own = raw as Partial<Ownership>
    return own.product === PRODUCT && own.version === VERSION
  } catch {
    return false
  }
}

/**
 * Claim `projectsRoot` for this product, tolerantly.
 *
 * Called when the product creates its own default root. A claim that cannot be written is reported
 * by `rootIsOurs` staying false — the collector then refuses rather than sweeping a root it could
 * not mark, which is the safe direction and the honest one: a read-only home means we do not know
 * the root is ours, not that it is.
 */
export function claimRoot(projectsRoot: string): void {
  try {
    // A marker that EXISTS and is not ours is never overwritten. `rootIsOurs` cannot answer this on
    // its own — it returns false for "absent" and for "someone else's" alike, and only one of those
    // is a directory we may take. Claiming must not be a way to seize a root from whoever marked it
    // first, and a build that does not understand a future version of our own marker must not
    // downgrade it.
    if (existsSync(markerPath(projectsRoot))) return
    mkdirSync(dirname(projectsRoot), { recursive: true })
    const own: Ownership = { product: PRODUCT, version: VERSION }
    writeFileSync(markerPath(projectsRoot), `${JSON.stringify(own, null, 2)}\n`)
  } catch {
    // Deliberate: see the docblock. The absence of the marker IS the report.
  }
}
