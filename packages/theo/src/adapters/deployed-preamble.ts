import type { SecurityHeadersConfig } from '../core/contracts/security-headers.js'

import type { DeployedAgentsFragment } from './deployed-agents.js'
import { deployedCorsFragment, type DeployedCorsOptions } from './deployed-cors.js'
import { deployedCsrfFragment, type DeployedCsrfOptions } from './deployed-csrf.js'
import { securityHeadersDeclarations } from './security-headers.js'

/**
 * The module-level preamble five deploy entries emit, in the order they emit it.
 *
 * `bun`, `deno-deploy`, `vercel`, `netlify` and `aws-lambda` wrote these nine lines identically —
 * blank lines included — with one string different between them: the host name the CORS fragment
 * is told. Verified by matching the exact text, not by reading: the template below was searched
 * for in all six adapters and found in five.
 *
 * ## Why this was extracted, and what the alternative was
 *
 * SonarCloud's duplication gate is a REQUIRED check on `develop`, and it failed a promotion PR at
 * 4.2% on new code against a 3% ceiling. Three smaller extractions — the scan source, the security
 * declarations, the entry-options type — took it to 3.9% and stopped helping, because each one
 * ADDS an identical call site and an identical import to every caller. Measured on that PR: of 226
 * added lines under `src/`, 26 repeated, and every one of them was an import or a call.
 *
 * That is the metric describing the shape of extraction rather than a defect, and it is why the
 * answer had to be one bigger seam rather than a fourth small one. This collapses nine repeated
 * lines into one call in five files.
 *
 * Raising the threshold was never on the list: `rules/autonomy-envelope.md` floor 3 forbids moving
 * a bound to pass it, and a duplication gate whose ceiling rises stops reporting duplication.
 *
 * ## Why `cloudflare` is not a caller
 *
 * Its order is genuinely different — security declarations, then CSRF, then the runtime and agents
 * declarations, then CORS — and its CSRF fragment takes a second argument (`'a Worker'`) that no
 * other host passes. Forcing it through here would need a flag per difference, which turns this
 * function into a switch over its callers: the shape that drifts, and the one
 * `serveThroughPluginLifecycle` was extracted to undo after five copies had (#405).
 *
 * A Worker being the odd one is not an accident. It has no filesystem, so it bakes what the others
 * scan, and that changes what has to be declared before what.
 */
export function deployedEntryPreamble(
  runtimeConfig: { imports: string[]; declarations: string[] },
  agentsFragment: DeployedAgentsFragment,
  opts: { securityHeaders?: SecurityHeadersConfig } & DeployedCsrfOptions & DeployedCorsOptions,
  host: string,
): string[] {
  return [
    ...securityHeadersDeclarations(opts.securityHeaders),
    ``,
    ...runtimeConfig.imports,
    ...agentsFragment.imports,
    ...runtimeConfig.declarations,
    ...agentsFragment.declarations,
    ...deployedCsrfFragment(opts),
    ``,
    ...deployedCorsFragment(opts.cors, host),
  ]
}
