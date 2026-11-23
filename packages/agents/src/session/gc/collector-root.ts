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

/** Reported as the owner of a marker file the caller's format could not interpret. */
const UNRECOGNISED_MARKER = '(unrecognised marker)'

/**
 * A marker another app already wrote, under its own file name and schema. The file sits beside
 * `projects/` like the standard one. `ownerOf` receives the parsed JSON and returns the owning app's
 * name, or `undefined` when the content is not a marker it understands (a future version, a foreign
 * schema): that is refused as ambiguous, never read as "unowned".
 */
export interface CollectorRootMarkerFormat {
  readonly fileName: string
  readonly ownerOf: (parsed: unknown) => string | undefined
}

/** Options for reading or claiming a root that may carry a marker in another format. */
export interface CollectorRootOptions {
  /** Consulted when the standard marker is absent. The standard marker wins when both exist. */
  readonly existingMarker?: CollectorRootMarkerFormat
}

function markerPathOf(projectsRoot: string, fileName: string = COLLECTOR_ROOT_MARKER): string {
  return join(dirname(projectsRoot), fileName)
}

function readMarkerText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new CollectorRootError(path, 'read', error)
  }
}

/**
 * The app that owns the root, or `undefined` when there is no marker or it is malformed (a malformed
 * marker authorises nothing). With `options.existingMarker`, a marker under that file name is read
 * when the standard one is absent; a file there the format does not recognise is reported as owned
 * by the sentinel app `"(unrecognised marker)"`, so it can never match a caller and never be claimed.
 *
 * @throws {CollectorRootError} when the marker exists but cannot be read.
 */
export function collectorRootOwner(
  projectsRoot: string,
  options: CollectorRootOptions = {},
): { app: string } | undefined {
  const text = readMarkerText(markerPathOf(projectsRoot))
  if (text !== undefined) {
    try {
      const parsed = JSON.parse(text) as { app?: unknown; version?: unknown } | null
      if (parsed !== null && typeof parsed.app === 'string' && parsed.app.length > 0) {
        return { app: parsed.app }
      }
    } catch {
      // malformed: authorises nothing, so the caller's existing marker (if any) is still consulted
    }
  }
  const format = options.existingMarker
  if (format === undefined) return undefined
  const legacy = readMarkerText(markerPathOf(projectsRoot, format.fileName))
  if (legacy === undefined) return undefined
  let owner: string | undefined
  try {
    owner = format.ownerOf(JSON.parse(legacy) as unknown)
  } catch {
    owner = undefined
  }
  return { app: owner !== undefined && owner.length > 0 ? owner : UNRECOGNISED_MARKER }
}

/**
 * Claim the root for `owner`. Idempotent for the same app; never replaces another app's marker. With
 * `options.existingMarker`, a marker already written in that format counts as the owner's claim and
 * is left as it is; nothing new is written beside it.
 *
 * @throws {CollectorRootNotOwnedError} when another app already owns the root, or a marker exists that cannot be interpreted.
 * @throws {CollectorRootError} when the marker cannot be read or written.
 */
export function claimCollectorRoot(
  projectsRoot: string,
  owner: { app: string },
  options: CollectorRootOptions = {},
): void {
  const existing = collectorRootOwner(projectsRoot, options)
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
