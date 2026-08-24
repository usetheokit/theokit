/**
 * The CSRF configuration a deployed entry carries, baked at build time.
 *
 * ## The defect this closes
 *
 * The six Web-standards adapter entries built `executeRoute`'s context from an eight-field
 * literal, and neither `csrfMode` nor `disallowed` was among the eight (usetheokit/theokit#410).
 * `executeRoute` defaults an absent mode to `'strict'`, so an app declaring
 * `security: { csrf: 'off' }` — or `'warn'` — got `'strict'` on every deploy target: a `POST` that
 * works under `theokit dev` and `theokit start` answers `403 CSRF_INVALID` on Vercel, naming a
 * mechanism the operator had switched off. The config still validated and the build still
 * succeeded; the behaviour simply changed.
 *
 * The deployed function has no `theo.config.ts` to read, which is why the value is carried as a
 * literal — the same shape `security.headers` already uses (`renderSecurityHeadersConfigLiteral`).
 *
 * ## Why this is not `JSON.stringify`
 *
 * `disallowed.routes` accepts RegExp entries (`config/schemas/security.ts`), and `JSON.stringify`
 * renders a RegExp as `{}`. That is not a formatting problem: `matchDisallowed` checks
 * `p instanceof RegExp`, so a `{}` matches nothing while reading, in the emitted file, as a rule
 * that is present and configured. Reaching for JSON here would reproduce this issue's own defect —
 * configuration that survives validation and quietly stops applying — one layer further down.
 */
import type { TheoConfig } from '../config/schema.js'

type SecurityConfig = NonNullable<TheoConfig['security']>

/**
 * The two slices of `security` that reach `executeRoute`'s context.
 *
 * Narrow rather than the whole block, matching how `securityHeaders` is already passed: each
 * renderer receives what it uses and nothing else, so a headers change cannot reach the CSRF
 * literal and vice versa.
 */
export interface DeployedCsrfOptions {
  csrf?: SecurityConfig['csrf']
  disallowed?: SecurityConfig['disallowed']
}

/**
 * Source text for one route pattern.
 *
 * A RegExp is emitted as a regex literal so it arrives as a RegExp; a string goes through
 * `JSON.stringify`, which is the correct escaper for a JS string literal (quotes, backslashes,
 * control characters, line separators).
 */
function renderRoutePattern(pattern: string | RegExp): string {
  return pattern instanceof RegExp ? String(pattern) : JSON.stringify(pattern)
}

/**
 * Source text for the CSRF slice of `executeRoute`'s context.
 *
 * Absent values are OMITTED rather than defaulted. `executeRoute` already defaults an absent
 * `csrfMode` to `'strict'`, and writing `'strict'` here would put that default in a second place
 * where the two can disagree — which is the class of drift the whole issue is about.
 *
 * @param security - the declared csrf slices, or `undefined` when the app declared no security block
 */
export function renderDeployedCsrfLiteral(security: DeployedCsrfOptions | undefined): string {
  if (security === undefined) return '{}'

  const parts: string[] = []
  if (security.csrf !== undefined) parts.push(`csrfMode: ${JSON.stringify(security.csrf)}`)

  const { disallowed } = security
  if (disallowed !== undefined) {
    const routes = disallowed.routes.map(renderRoutePattern).join(', ')
    parts.push(
      `disallowed: { routes: [${routes}], behavior: ${JSON.stringify(disallowed.behavior)} }`,
    )
  }

  // `{}` and not `{ }` when nothing was declared: the emitted file is read by people, and the
  // two-space version reads as though something was meant to be there.
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`
}

/**
 * The lines that declare `CSRF_CONFIG` in a generated entry.
 *
 * One function rather than the same six lines pasted into each of the six adapters: that
 * duplication is how the eight-field context literal came to be wrong in six places at once, and
 * repeating the fix in the same shape would leave the next field with the same six places to be
 * forgotten in. It also keeps the two largest emitters under the `max-lines-per-function` ceiling,
 * which `vercel.ts` already extracts fragments to respect.
 *
 * @param opts - the declared csrf slices, passed straight through from the adapter's build options
 * @param home - what the target has instead of a config file, for the comment's second sentence
 */
export function deployedCsrfFragment(
  opts: DeployedCsrfOptions,
  home = 'a deployed function',
): string[] {
  return [
    `// #410 — the CSRF mode and per-route escalation the app declared. Carried as a`,
    `// literal for the same reason as the headers above: ${home} has no theo.config.ts`,
    `// to read. Absent keys stay absent so executeRoute's own default ('strict') applies,`,
    `// rather than this file becoming a second place it can drift.`,
    `const CSRF_CONFIG = ${renderDeployedCsrfLiteral(opts)}`,
  ]
}
