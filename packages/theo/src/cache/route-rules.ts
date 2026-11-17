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

function matcherFor(pattern: string): (path: string) => boolean {
  const re = globToRegExp(pattern)
  return (path) => re.test(path)
}

/**
 * Translate a glob to an anchored RegExp. Supported: `*` (within a segment), `**` (across
 * segments; `**` followed by `/` also matches no segment), `?`, and `{a,b}` alternation (nestable).
 * Dotfiles match, as before. Extglobs (`+(...)`) are not supported: `(` and `+` are literals.
 * Every quantifier is over a single character class, so matching cannot backtrack exponentially.
 */
function globToRegExp(pattern: string): RegExp {
  let out = ''
  let depth = 0
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        while (pattern[i + 1] === '*') i++
        if (pattern[i + 1] === '/') {
          i++
          out += '(?:[^/]+/)*'
        } else {
          out += '.*'
        }
      } else {
        out += '[^/]*'
      }
    } else if (c === '?') {
      out += '[^/]'
    } else if (c === '{') {
      depth++
      out += '(?:'
    } else if (c === '}' && depth > 0) {
      depth--
      out += ')'
    } else if (c === ',' && depth > 0) {
      out += '|'
    } else {
      out += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
    }
  }
  out += ')'.repeat(depth)
  return new RegExp(`^${out}$`)
}

/**
 * Compile route-rule glob patterns into matcher functions.
 * First-match-wins semantics (preserves insertion order).
 *
 * Patterns are translated by `globToRegExp` below, with no dependency: picomatch through 4.0.7
 * has an unpatched ReDoS (GHSA-fc5q-39xc-vjpf) on repeated extglobs, and no fixed release exists.
 */
export function compileRouteRules(rules: RouteRules): CompiledRouteRule[] {
  return Object.entries(rules).map(([pattern, rule]) => ({
    matcher: matcherFor(pattern),
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
