/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time scanner: walks `serverDir/routes/` derived from cwd.
 * No HTTP input ever reaches these fs calls.
 */
import { existsSync, statSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'

import { walkSourceFiles } from '../_internal/scan-walker.js'

import { detectExportedHttpMethods } from './detect-http-methods.js'
import { RouterConventionError } from './errors.js'
import { compilePattern, type ServerRouteNode } from './match.js'

const ROUTE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

// EC-4: Co-located unit/spec tests must be silently skipped by the scanner,
// BEFORE the dotted-basename check fires. Matches `*.test.ts|tsx|js|jsx`
// and `*.spec.ts|tsx|js|jsx`.
const TEST_OR_SPEC_RE = /\.(test|spec)\.[jt]sx?$/

function isTestOrSpecFile(filePath: string): boolean {
  return TEST_OR_SPEC_RE.test(basename(filePath))
}

function hasDotOutsideBrackets(segment: string): boolean {
  let depth = 0
  for (const ch of segment) {
    if (ch === '[') depth++
    else if (ch === ']') depth--
    else if (ch === '.' && depth === 0) return true
  }
  return false
}

function splitDottedSegmentOutsideBrackets(segment: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  for (const ch of segment) {
    if (ch === '[') {
      depth++
      current += ch
    } else if (ch === ']') {
      depth--
      current += ch
    } else if (ch === '.' && depth === 0) {
      if (current) parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current) parts.push(current)
  return parts
}

function buildDirectoryNestedSuggestion(filePath: string, routesDir: string): string {
  const rel = relative(routesDir, filePath).replace(/\\/g, '/')
  const ext = extname(rel)
  const withoutExt = rel.slice(0, -ext.length)
  const segments = withoutExt.split('/').flatMap(splitDottedSegmentOutsideBrackets)
  return `routes/${segments.join('/')}${ext}`
}

function assertNoDottedSegment(filePath: string, routesDir: string): void {
  const rel = relative(routesDir, filePath).replace(/\\/g, '/')
  const ext = extname(rel)
  const withoutExt = rel.slice(0, -ext.length)
  const segments = withoutExt.split('/')
  for (const seg of segments) {
    if (hasDotOutsideBrackets(seg)) {
      throw new RouterConventionError({
        file: filePath,
        suggestion: buildDirectoryNestedSuggestion(filePath, routesDir),
      })
    }
  }
}

function fileToRoutePath(filePath: string, routesDir: string): string {
  let rel = relative(routesDir, filePath)
  // Strip extension
  const ext = extname(rel)
  rel = rel.slice(0, -ext.length)
  // Normalize separators
  rel = rel.replace(/\\/g, '/')
  // Strip index suffix
  if (rel.endsWith('/index')) {
    rel = rel.slice(0, -6)
  } else if (rel === 'index') {
    rel = ''
  }
  // Replace [...param] with :...param (catch-all, before regular params).
  // Replace [param] with :param. Inputs are file paths bounded by the
  // OS filename limit; the bracket capture is bounded by `]`.
  rel = rel.replace(/\[\.\.\.([^\]]+)\]/g, ':...$1')
  // eslint-disable-next-line sonarjs/slow-regex -- bounded by `]`; input is a single filename
  rel = rel.replace(/\[([^\]]+)\]/g, ':$1')
  return `/api/${rel}`
}

export function scanServerRoutes(serverDir: string): ServerRouteNode[] {
  const routesDir = join(serverDir, 'routes')
  if (!existsSync(routesDir) || !statSync(routesDir).isDirectory()) {
    return []
  }

  const results: ServerRouteNode[] = []
  walkSourceFiles(routesDir, { extensions: ROUTE_EXTENSIONS }, (absPath) => {
    // EC-4: skip co-located test/spec files BEFORE the dotted-basename check
    if (isTestOrSpecFile(absPath)) return

    // G6 T1.1: reject dotted basenames (legacy convention that produced wrong
    // paramNames due to greedy `:(?:\.\.\.)?([^/]+)` regex in compilePattern).
    assertNoDottedSegment(absPath, routesDir)

    const routePath = fileToRoutePath(absPath, routesDir)
    const { pattern, paramNames } = compilePattern(routePath)
    const methods = detectExportedHttpMethods(absPath)
    results.push({
      filePath: absPath,
      routePath,
      paramNames,
      pattern,
      methods,
    })
  })

  // T1.4 / EC-2 — refuse to scan if a user route collides with the reserved
  // batch endpoint path. User must rename or disable batching.
  const conflicting = results.find((r) => r.routePath === '/api/__theo_batch__')
  if (conflicting) {
    throw new Error(
      `Server route ${conflicting.filePath} resolves to '/api/__theo_batch__' which is reserved for the batch endpoint. Rename the route or disable batching in theo.config.ts.`,
    )
  }

  // Sort: static first, then dynamic, then catch-all last
  const isCatchAll = (route: ServerRouteNode) => route.routePath.includes(':...')
  results.sort((a, b) => {
    const aStatic = a.paramNames.length === 0
    const bStatic = b.paramNames.length === 0
    const aCatchAll = isCatchAll(a)
    const bCatchAll = isCatchAll(b)

    // Static routes first
    if (aStatic && !bStatic) return -1
    if (!aStatic && bStatic) return 1
    // Catch-all routes last
    if (aCatchAll && !bCatchAll) return 1
    if (!aCatchAll && bCatchAll) return -1
    return a.routePath.localeCompare(b.routePath)
  })

  return results
}
