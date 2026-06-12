/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time scanner: walks `serverDir/actions/` derived from cwd.
 * No HTTP input ever reaches these fs calls.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

import { walkSourceFiles } from '../_internal/scan-walker.js'

export interface ActionNode {
  filePath: string
  actionPath: string
}

/**
 * Enriched manifest entry per plan g3-server-actions-and-useaction v1.2
 * § Phase 1 / T1.4 + ADR D4. Consumed by virtual module `@theo/actions`
 * (T3.1) and G4 devtools "Actions" tab (T5.1).
 */
export interface ActionManifestEntry {
  name: string
  filePath: string
  urlPath: string
  accept: 'form' | 'json'
  hasInput: boolean
  /**
   * P#4 plugin-forms shared-schema convention (per plan p4-plugin-forms v1.1 T1.1).
   * When present, points to an isomorphic schema file at
   * `<serverDir>/actions/schemas/<basename>.ts` exporting `export const schema = z.object(...)`.
   * Virtual module emits `import {schema} from '<schemaFilePath>'` + attaches as
   * `actions.X.__zodSchema` so client-side <TheoForm> can drive zodResolver.
   * Undefined when convention not followed (graceful degrade — TheoForm still
   * works via explicit `schema={...}` prop escape hatch).
   */
  schemaFilePath?: string
}

/**
 * EC-2: structured error for scan-time defects (name collision, reserved
 * identifier, etc.). Throw at scan time to fail loud — silent shadowing is
 * a security/correctness footgun.
 */
export class ActionScanError extends Error {
  readonly code: 'NAME_COLLISION' | 'RESERVED_NAME'
  readonly conflictingPaths: readonly string[]

  constructor(
    code: 'NAME_COLLISION' | 'RESERVED_NAME',
    message: string,
    conflictingPaths: readonly string[],
  ) {
    super(message)
    // T4.1 fix: identify class by name so serverErrorToEnvelope boundary
    // translator can route via class-name lookup (without this, runtime
    // `err.name` defaults to 'Error' and the meta.name diagnostic is wrong).
    this.name = 'ActionScanError'
    this.code = code
    this.conflictingPaths = conflictingPaths
  }
}

const ACTION_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/
const RESERVED_NAMES = new Set(['index', 'constructor', '__proto__', 'prototype', 'hasOwnProperty'])

/**
 * Backward-compatible: original simple-shape scanner used by existing
 * consumers. Preserved verbatim; new consumers should call
 * `scanServerActionsEnriched`.
 */
export function scanServerActions(serverDir: string): ActionNode[] {
  const actionsDir = join(serverDir, 'actions')
  if (!existsSync(actionsDir) || !statSync(actionsDir).isDirectory()) {
    return []
  }

  const results: ActionNode[] = []
  walkSourceFiles(actionsDir, { extensions: ACTION_EXTENSIONS }, (absPath) => {
    if (TEST_FILE_RE.test(absPath)) return
    let rel = relative(actionsDir, absPath)
    rel = rel.replace(/\\/g, '/')
    rel = rel.slice(0, -extname(rel).length)
    results.push({
      filePath: absPath,
      actionPath: rel,
    })
  })
  return results
}

/**
 * Enriched scan: light AST detection of `accept: 'form'|'json'` + `input:`
 * presence via regex-after-comment-stripping (EC-9). Throws ActionScanError
 * on file/dir name collision (EC-2) or reserved JS identifier names.
 *
 * Output `ActionManifestEntry[]` is sorted by `name` for deterministic
 * `.theokit/actions-manifest.json` emission.
 */
export function scanServerActionsEnriched(serverDir: string): ActionManifestEntry[] {
  const actionsDir = join(serverDir, 'actions')
  if (!existsSync(actionsDir) || !statSync(actionsDir).isDirectory()) {
    return []
  }

  const seenNames = new Set<string>()
  const entries: ActionManifestEntry[] = []

  // Collect first; collision-check after the full walk.
  walkSourceFiles(actionsDir, { extensions: ACTION_EXTENSIONS }, (absPath) => {
    if (TEST_FILE_RE.test(absPath)) return
    const rel = relative(actionsDir, absPath).replace(/\\/g, '/')
    // P#4 plugin-forms — `schemas/` subdir holds isomorphic zod schemas
    // for the shared-schema convention (T1.1). NOT executable actions; skip.
    if (rel.startsWith('schemas/')) return
    const name = rel.slice(0, -extname(rel).length)

    const basename = name.includes('/') ? (name.split('/').pop() ?? name) : name
    if (RESERVED_NAMES.has(basename)) {
      throw new ActionScanError(
        'RESERVED_NAME',
        `Reserved JS identifier "${basename}" cannot be an action name (${absPath})`,
        [absPath],
      )
    }
    // File-level collision (one file appearing twice) is impossible via the
    // walker; per-export collision check happens inside the export loop below.
    const source = readFileSync(absPath, 'utf8')
    const stripped = stripComments(source)
    const accept = /\baccept\s*:\s*['"]form['"]/.test(stripped) ? 'form' : 'json'
    const hasInput = /\binput\s*:\s*z\./.test(stripped) || /\binput\s*:\s*\w+\(/.test(stripped)

    // T7.1 wire fix — extract exports so the urlPath includes the second
    // segment required by action-middleware (`/api/__actions/<file>/<export>`).
    // Each named action export becomes its own manifest entry.
    // Proxy key on the EXPORT name (so consumers write `actions.saveMemory(input)`).
    // URL keeps the runtime 2-segment shape `/api/__actions/<file>/<export>`
    // expected by action-middleware. Cross-file export collisions become a
    // scan error to surface the ambiguity early.
    const exportNames = extractActionExportNames(stripped)
    // P#4 plugin-forms shared-schema convention: check for
    // `<actionsDir>/schemas/<basename>.ts` (or .tsx/.js/.jsx).
    // Skip when actions live in subdirs (`schemas/` is flat by convention).
    const schemaFilePath = name.includes('/') ? undefined : detectSchemaFile(actionsDir, basename)
    for (const exportName of exportNames) {
      const proxyKey = exportName === 'default' ? name : exportName
      if (seenNames.has(proxyKey)) {
        throw new ActionScanError(
          'NAME_COLLISION',
          `Duplicate action proxy key "${proxyKey}" (two files export the same name)`,
          [absPath],
        )
      }
      seenNames.add(proxyKey)
      const entry: ActionManifestEntry = {
        name: proxyKey,
        filePath: absPath,
        urlPath: `/api/__actions/${name}/${exportName}`,
        accept,
        hasInput,
      }
      if (schemaFilePath !== undefined) {
        entry.schemaFilePath = schemaFilePath
      }
      entries.push(entry)
    }
  })

  // EC-2: detect file vs dir collisions (e.g., foo.ts AND foo/bar.ts).
  // After walk completes, any name that has children prefixed `name/` triggers collision.
  for (const entry of entries) {
    const childPrefix = `${entry.name}/`
    const conflictingChild = entries.find((other) => other.name.startsWith(childPrefix))
    if (conflictingChild) {
      throw new ActionScanError(
        'NAME_COLLISION',
        `Action "${entry.name}" conflicts with directory of same name containing "${conflictingChild.name}"`,
        [entry.filePath, conflictingChild.filePath],
      )
    }
  }

  entries.sort((a, b) => {
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    return 0
  })
  return entries
}

/**
 * Strip JavaScript line + block comments from source. Simple state machine
 * (does not parse strings — false positives if a comment marker appears
 * inside a string literal, but that's an acceptable trade-off for v1 vs
 * full AST parse).
 */
/**
 * Extract action export names via regex over comment-stripped source.
 * Matches `export const <name> = defineAction(...)`, `export default
 * defineAction(...)`, and `export function <name>(...)` forms. Returns
 * `['default']` when no named action exports are found (best-effort fallback
 * for default-export shapes the regex misses).
 */
function extractActionExportNames(stripped: string): string[] {
  const names = new Set<string>()
  const namedRe = /\bexport\s+(?:const|let|var|function\*?)\s+([a-zA-Z_$][\w$]*)\s*[=(]/g
  let m: RegExpExecArray | null
  while ((m = namedRe.exec(stripped)) !== null) {
    const name = m[1]
    if (typeof name === 'string' && name.length > 0) names.add(name)
  }
  if (/\bexport\s+default\s+defineAction\b/.test(stripped)) {
    names.add('default')
  }
  if (names.size === 0) names.add('default')
  return [...names]
}

/**
 * P#4 plugin-forms shared-schema convention helper (per plan p4-plugin-forms v1.1 T1.1).
 * Returns the resolved path to `<actionsDir>/schemas/<basename>.<ext>` if it exists.
 * Tries `.ts`, `.tsx`, `.js`, `.jsx` in that order. Returns undefined when no match.
 */
function detectSchemaFile(actionsDir: string, basename: string): string | undefined {
  const schemasDir = join(actionsDir, 'schemas')
  if (!existsSync(schemasDir)) return undefined
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
    const candidate = join(schemasDir, `${basename}${ext}`)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

function stripComments(source: string): string {
  let out = ''
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      // Line comment: skip until newline
      while (i < source.length && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && next === '*') {
      // Block comment: skip until */
      i += 2
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}
