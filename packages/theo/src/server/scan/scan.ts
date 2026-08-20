/* eslint-disable security/detect-non-literal-fs-filename --
 * Build-time scanner: walks `serverDir/routes/` derived from cwd.
 * No HTTP input ever reaches these fs calls.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, join, relative } from 'node:path'

import type { HttpMethod } from '../../core/contracts/http-methods.js'
import { walkSourceFiles } from '../_internal/scan-walker.js'

import { detectExportedHttpMethods } from './detect-http-methods.js'
import { detectMethodsWithDeclaredPolicy } from './detect-route-policy.js'
import { MissingRoutePolicyError, RouterConventionError } from './errors.js'
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

/**
 * ADR 0001, Decision point 5 — a route declares its policy explicitly, `public`
 * included, and absence stops meaning open.
 *
 * The refusal lives here, next to the dotted-basename refusal, because this is
 * the one place every entry point passes through: `theo build`, `theo start`,
 * `theo dev`, `theo routes` and each deployment adapter all reach routes by
 * calling `scanServerRoutes`. A gate wired into the build command instead would
 * have to be remembered by six adapters that generate their own entry file, and
 * a gate you can forget to call is a gate that reports on the routes somebody
 * remembered.
 *
 * The blast radius stops at the file system. A `RouteConfig` built in memory and
 * handed to `executeWebRequest` or `callProcedure` never passed a scanner, so it
 * never reaches this function — the runtime still treats an undeclared policy as
 * "not declared", exactly as `evaluateRoutePolicy` documents. Absence is refused
 * where an application DECLARES its routes, not where a caller passes one.
 */
function assertEveryMethodDeclaresPolicy(
  filePath: string,
  routePath: string,
  methods: readonly HttpMethod[],
  source: string,
): void {
  if (methods.length === 0) return
  const declared = detectMethodsWithDeclaredPolicy(filePath, source)
  const missing = methods.filter((method) => !declared.has(method))
  if (missing.length === 0) return
  throw new MissingRoutePolicyError({ file: filePath, routePath, methods: missing })
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
    const source = readFileSync(absPath, 'utf-8')
    const methods = detectExportedHttpMethods(absPath, source)
    assertEveryMethodDeclaresPolicy(absPath, routePath, methods, source)
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

  results.sort((a, b) => compareRouteSpecificity(a.routePath, b.routePath))

  return results
}

/** How constrained one path segment is. Lower is more specific. */
const SEGMENT_STATIC = 0
const SEGMENT_DYNAMIC = 1
const SEGMENT_CATCH_ALL = 2

function segmentSpecificity(segment: string): number {
  if (segment.startsWith(':...')) return SEGMENT_CATCH_ALL
  if (segment.startsWith(':')) return SEGMENT_DYNAMIC
  return SEGMENT_STATIC
}

/**
 * Order two route paths by specificity, most specific first.
 *
 * `matchRoute` returns on the first pattern that matches, so this order IS the
 * precedence contract — not a presentation detail of the manifest.
 *
 * Segments are compared position by position, and the first position where they
 * disagree decides: a literal beats a parameter, and a parameter beats a
 * catch-all. That is the rule the URL itself expresses, and it is the rule a
 * whole-path comparison cannot express, because a whole-path comparison reads
 * characters across segment boundaries. Comparing `/api/:resource/settings`
 * with `/api/users/:id` that way put the generic route first — `:` precedes `u`
 * in every collation — so `/api/users/settings` reached the generic handler and
 * an authorization check placed on the specific route was bypassed
 * (usetheokit/theokit#348).
 *
 * Only the segments the two paths have in common are ranked. Past that point
 * one path is a strict prefix of the other, and two such routes cannot match
 * the same URL — so there is nothing to decide, only a stable order to pick.
 *
 * The final fallback compares by code unit rather than with `localeCompare`.
 * Collation is locale-dependent, so the same route table would order
 * differently under a different `LANG` — the cross-machine divergence
 * usetheokit/theokit#346 removed from the sibling scanner. The tiebreak only
 * has to be total and stable; it does not have to be alphabetical for a human.
 */
export function compareRouteSpecificity(a: string, b: string): number {
  const aSegments = a.split('/')
  const bSegments = b.split('/')
  const shared = Math.min(aSegments.length, bSegments.length)

  for (let i = 0; i < shared; i++) {
    const difference = segmentSpecificity(aSegments[i]) - segmentSpecificity(bSegments[i])
    if (difference !== 0) return difference
  }

  if (a < b) return -1
  if (a > b) return 1
  return 0
}
