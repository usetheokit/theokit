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
  let depth = 0
  const out = pattern.replace(/\*\*\/|\*\*|\*|\?|[{},]|[.+^$()|[\]\\/]/g, (tok) => {
    if (tok.startsWith('*')) {
      if (tok === '*') return '[^/]*'
      return tok.endsWith('/') ? '(?:[^/]+/)*' : '.*'
    }
    if (tok === '?') return '[^/]'
    if (tok === '{') {
      depth++
      return '(?:'
    }
    if (depth > 0 && tok === '}') {
      depth--
      return ')'
    }
    if (depth > 0 && tok === ',') return '|'
    return `\\${tok}`
  })
  // eslint-disable-next-line security/detect-non-literal-regexp -- route pattern from the app's own config, never HTTP input; every quantifier is over one character class
  return new RegExp(`^${out}${')'.repeat(depth)}$`)
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
