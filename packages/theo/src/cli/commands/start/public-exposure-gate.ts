/**
 * Refuse to put unauthenticated write routes on a public network interface.
 *
 * `resolve-listen-host.ts` settled WHICH address gets bound and made the log say so. This settles
 * whether that address should be bound at all, given what is behind it. The two are deliberately
 * separate: one is about reachability, this one is about consequence.
 *
 * The gap it closes has a shape worth naming. ADR 0001 made every route declare who may call it and
 * stopped absence from meaning open — a real improvement, and an incomplete one, because `'public'`
 * is a declaration too. A route table where every entry says `policy('public')` passes the build
 * gate perfectly and is, in substance, a table nobody protected. Nothing downstream could tell the
 * two apart, since the policy value never left the module; `detectRoutePolicyKinds` is what made it
 * legible at scan time, and this is the first thing to act on it.
 *
 * ## What it refuses, and what it does not
 *
 * Refused: a non-loopback bind while at least one POST / PUT / PATCH / DELETE declares the literal
 * `'public'`. Those are the requests that spend money, mutate state, or send mail on the operator's
 * behalf, and an unauthenticated one reachable from a network is the shape of an open relay.
 *
 * NOT refused: public GET / HEAD / OPTIONS. Public read endpoints are ordinary — health checks,
 * catalogues, landing APIs — and a gate that fired on them would be switched off within a day. A
 * gate with a stated edge is worth more than a gate nobody runs. That means this does NOT protect
 * against a public GET that leaks data; that is authorization work the policy function must do, and
 * saying so here is cheaper than letting an operator infer a guarantee that was never offered.
 *
 * ## Why absence is not safety
 *
 * A manifest built before this existed carries no `publicMethods`, and reading that silence as
 * "nothing is public" would be the same defect the gate exists to prevent, one field over. The
 * verdict is `unverified`: the server still starts (an upgrade must not break a running deploy),
 * and the operator is told plainly that the check did not run and what to do about it.
 */
import type { ServerRouteNode } from '../../../server/scan/match.js'

import type { ListenTarget } from './resolve-listen-host.js'

/**
 * Methods that change something. The rest are readable requests, out of scope by the reasoning in
 * the module docblock.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Addresses that reach only this machine. */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/** One unauthenticated write, named so the operator can go and look at it. */
export interface Exposure {
  readonly routePath: string
  readonly method: string
}

export type ExposureVerdict =
  /** Bound to the loopback — nothing outside this machine can reach it, so there is nothing to judge. */
  | { readonly kind: 'not-exposed' }
  /** Public bind, and every mutating route is guarded. */
  | { readonly kind: 'allowed' }
  /** Public bind with unauthenticated writes, permitted by an explicit written decision. */
  | { readonly kind: 'allowed-by-override'; readonly exposures: readonly Exposure[] }
  /** Public bind with unauthenticated writes and no override. The server must not start. */
  | { readonly kind: 'refused'; readonly exposures: readonly Exposure[]; readonly message: string }
  /** Public bind, and the route table cannot answer the question. Starts, says so. */
  | { readonly kind: 'unverified'; readonly message: string }

export interface ExposureAssessment {
  readonly routes: readonly ServerRouteNode[]
  readonly target: ListenTarget
  /** `security.allowUnauthenticatedWrites` from theo.config.ts — an explicit, written decision. */
  readonly allowUnauthenticatedWrites: boolean
  /**
   * Whether this build emitted compiled controllers, which `routes` does not describe.
   *
   * The caller already knows: `start` resolves `dist/controllers.json` to decide whether to serve
   * them at all. Passing the fact in is what lets an empty `routes` mean two different things —
   * "this app serves nothing", which is safe to bind, and "this app serves through controllers the
   * manifest does not list", which is not judged here at all.
   *
   * `undefined` is read as unknown, not as false. Distinguishing them is the point of the field, and
   * a caller that has not been updated should not be answered with confidence it did not supply.
   */
  readonly hasControllers?: boolean
}

/** Does this address reach anything beyond this machine? */
function isPubliclyBound(host: string): boolean {
  return !LOOPBACK_HOSTS.has(host.toLowerCase())
}

function unauthenticatedWrites(routes: readonly ServerRouteNode[]): Exposure[] {
  const found: Exposure[] = []
  for (const route of routes) {
    for (const method of route.publicMethods ?? []) {
      if (MUTATING_METHODS.has(method)) found.push({ routePath: route.routePath, method })
    }
  }
  return found
}

/**
 * Why the gate cannot judge this route table, or `null` when it can.
 *
 * Two different absences reach here, and telling them apart matters because the operator's next
 * move differs. Returning a REASON rather than a boolean is what keeps the message honest: a
 * warning that prescribes `theo build` to someone whose build is fine teaches them to ignore it.
 *
 * - `stale-manifest` — routes exist and declare mutating methods, but none carries `publicMethods`.
 *   The signature of a manifest built before this check existed. Regenerating it answers the
 *   question.
 *
 * - `empty-table` — the manifest describes no routes at all. Regenerating it changes nothing: the
 *   scan behind that array reads `server/routes/`, and an app serving through controllers has none
 *   (usetheokit/theokit#543). Measured on a nine-controller app: sixteen routes served, `routes: []`
 *   written.
 *
 *   This one was silently `allowed` until 2026-08-28. `.some()` on an empty array is false for both
 *   questions above, so the gate concluded there was nothing to expose and bound a public interface
 *   without a word — while a controller declaring `@SetMetadata('theokit:public', true)` on a POST
 *   sat on it. Absence of a description is not absence of exposure, which is the sentence this whole
 *   file is written around.
 */
function whyCannotAnswer(
  routes: readonly ServerRouteNode[],
  hasControllers: boolean | undefined,
): 'stale-manifest' | 'empty-table' | null {
  if (routes.length === 0) {
    // An app that serves nothing is safe to bind anywhere, and warning about it is the kind of
    // noise that gets a gate switched off. Only an empty table that is NOT the whole story warrants
    // a word — controllers present, or a caller that did not say.
    return hasControllers === false ? null : 'empty-table'
  }
  if (routes.some((r) => r.publicMethods !== undefined)) return null
  return routes.some((r) => (r.methods ?? []).some((m) => MUTATING_METHODS.has(m)))
    ? 'stale-manifest'
    : null
}

function unverifiedMessage(reason: 'stale-manifest' | 'empty-table', host: string): string {
  const head = `Binding ${host} without checking whether its write routes are authenticated.`
  return reason === 'stale-manifest'
    ? [
        head,
        '  This manifest predates the check and records no policy kinds. Run `theo build` to',
        '  regenerate it; until then the server starts, and this warning is the whole of what',
        '  is known about the exposure.',
      ].join('\n')
    : [
        head,
        '  The manifest describes no routes, so there is nothing here to judge. If this app serves',
        '  through controllers, that is expected and rebuilding will not change it — the route scan',
        '  reads `server/routes/` only (usetheokit/theokit#543). Whatever your controllers mark',
        '  `theokit:public` on a POST/PUT/PATCH/DELETE is reachable from this address, and this',
        '  warning is the whole of what is known about it.',
      ].join('\n')
}

function refusalMessage(exposures: readonly Exposure[], host: string): string {
  const list = exposures.map((e) => `    ${e.method} ${e.routePath}`).join('\n')
  return [
    exposures.length === 1
      ? `Refusing to bind ${host}: 1 write route accepts unauthenticated requests.`
      : `Refusing to bind ${host}: ${String(exposures.length)} write routes accept unauthenticated requests.`,
    '',
    list,
    '',
    "  Each declares `policy('public')`, so anyone who can reach this address can call it.",
    '  On a loopback bind that is a demo; on this one it is an open endpoint.',
    '',
    '  Resolve it one of two ways:',
    '    • give each route a real policy — `policy(({ subject }) => subject !== null)`, or',
    '      `requireOwner(subject, record.ownerId)` from `theokit/server/define`. A plugin hook',
    '      establishes `ctx.subject`; the policy reads it.',
    '    • decide otherwise, in writing: `security: { allowUnauthenticatedWrites: true }` in',
    '      theo.config.ts. The routes stay open and the startup log keeps saying so.',
  ].join('\n')
}

/**
 * Judge a route table against the address about to be bound.
 *
 * Pure — it reads, it decides, it returns. The caller prints and exits, which keeps this testable
 * without a process and keeps the exit policy in one place.
 */
export function assessPublicExposure(input: ExposureAssessment): ExposureVerdict {
  if (!isPubliclyBound(input.target.host)) return { kind: 'not-exposed' }

  const blind = whyCannotAnswer(input.routes, input.hasControllers)
  if (blind !== null) {
    return { kind: 'unverified', message: unverifiedMessage(blind, input.target.host) }
  }

  const exposures = unauthenticatedWrites(input.routes)
  if (exposures.length === 0) return { kind: 'allowed' }
  if (input.allowUnauthenticatedWrites) return { kind: 'allowed-by-override', exposures }

  return { kind: 'refused', exposures, message: refusalMessage(exposures, input.target.host) }
}
