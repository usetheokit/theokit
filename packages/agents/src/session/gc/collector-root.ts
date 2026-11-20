import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * Which app owns a `projects/` root. A JSON marker sits NEXT TO `projects/` (in its parent), so two
 * apps sharing one home directory cannot sweep each other's data. Applying a cross-project GC plan
 * requires the marker to name the applying app.
 */

/** The marker file name, in the parent of the projects root. */
const COLLECTOR_ROOT_MARKER = '.theokit-collector.json'

const MARKER_VERSION = 1

/** The marker could not be read or written. A permission failure is never reported as "not ours". */
export class CollectorRootError extends TheokitAgentError {
  override readonly name = 'CollectorRootError'

  constructor(
    readonly markerPath: string,
    action: 'read' | 'write',
    cause: unknown,
  ) {
    super(
      `[@theokit/agents] cannot ${action} the collector-root marker "${markerPath}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      { code: 'collector_root_error', isRetryable: false, cause },
    )
  }
}

/** The projects root belongs to another app (or to none), so a sweep over it is refused. */
export class CollectorRootNotOwnedError extends TheokitAgentError {
  override readonly name = 'CollectorRootNotOwnedError'

  constructor(
    readonly projectsRoot: string,
    readonly expected: string,
    readonly actual: string | undefined,
  ) {
    super(
      `[@theokit/agents] refusing to collect "${projectsRoot}": this app is "${expected}" but the root is ` +
        (actual === undefined ? 'not claimed by any app' : `owned by "${actual}"`) +
        `. Claim it with claimCollectorRoot() only if it is yours.`,
      { code: 'collector_root_not_owned', isRetryable: false },
    )
  }
}

function markerPathOf(projectsRoot: string): string {
  return join(dirname(projectsRoot), COLLECTOR_ROOT_MARKER)
}

/**
 * The app that owns the root, or `undefined` when there is no marker or it is malformed (a malformed
 * marker authorises nothing).
 *
 * @throws {CollectorRootError} when the marker exists but cannot be read.
 */
export function collectorRootOwner(projectsRoot: string): { app: string } | undefined {
  const path = markerPathOf(projectsRoot)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new CollectorRootError(path, 'read', error)
  }
  try {
    const parsed = JSON.parse(text) as { app?: unknown; version?: unknown } | null
    if (parsed !== null && typeof parsed.app === 'string' && parsed.app.length > 0) {
      return { app: parsed.app }
    }
  } catch {
    // malformed: treated as unowned
  }
  return undefined
}

/**
 * Claim the root for `owner`. Idempotent for the same app; never replaces another app's marker.
 *
 * @throws {CollectorRootNotOwnedError} when another app already owns the root.
 * @throws {CollectorRootError} when the marker cannot be read or written.
 */
export function claimCollectorRoot(projectsRoot: string, owner: { app: string }): void {
  const existing = collectorRootOwner(projectsRoot)
  if (existing !== undefined) {
    if (existing.app === owner.app) return
    throw new CollectorRootNotOwnedError(projectsRoot, owner.app, existing.app)
  }
  const path = markerPathOf(projectsRoot)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify({ app: owner.app, version: MARKER_VERSION }) + '\n', 'utf8')
  } catch (error) {
    throw new CollectorRootError(path, 'write', error)
  }
}
