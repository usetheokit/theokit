import { compileGlob } from './glob-match.js'

export interface RouteRule {
  maxAge?: number
  swr?: number
  tags?: string[]
}

export type RouteRules = Record<string, RouteRule>

export interface CompiledRouteRule {
  matcher: (path: string) => boolean
  rule: RouteRule
  /** Original glob pattern (for debugging). */
  pattern: string
}

/**
 * Compile route-rule glob patterns into matcher functions.
 * First-match-wins semantics (preserves insertion order).
 *
 * Patterns are matched by `compileGlob`, not picomatch: picomatch through 4.0.7 has an unpatched
 * ReDoS (GHSA-fc5q-39xc-vjpf) and no fixed release exists.
 */
export function compileRouteRules(rules: RouteRules): CompiledRouteRule[] {
  return Object.entries(rules).map(([pattern, rule]) => ({
    matcher: compileGlob(pattern),
    rule,
    pattern,
  }))
}

/**
 * Resolve the first matching rule for `path`, or `undefined` if none match.
 */
export function resolveRouteRule(
  path: string,
  compiled: CompiledRouteRule[],
): RouteRule | undefined {
  for (const c of compiled) {
    if (c.matcher(path)) return c.rule
  }
  return undefined
}
