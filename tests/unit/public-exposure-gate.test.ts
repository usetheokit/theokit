/**
 * The gate that decides whether this route table may be bound to a public interface.
 *
 * `resolve-listen-host.ts` made the bind address a decision someone writes down, and stopped the
 * log from lying about which one it was. It never asked the next question: whether the routes about
 * to be exposed are safe to expose. An app whose every write route is `policy('public')` bound
 * `0.0.0.0` exactly as readily as one that authenticates — the framework had no opinion, because
 * nothing knew what the policies said (see `detectRoutePolicyKinds`).
 *
 * Scope, stated rather than implied: this refuses UNAUTHENTICATED WRITES. A public GET is not
 * blocked — public read endpoints are ordinary and legitimate, and a gate that fired on them would
 * be turned off within a day, which is worse than a gate with a stated edge.
 */
import { describe, it, expect } from 'vitest'

import { assessPublicExposure } from '../../packages/theo/src/cli/commands/start/public-exposure-gate.js'
import type { ServerRouteNode } from '../../packages/theo/src/server/scan/match.js'

function node(routePath: string, publicMethods?: string[], methods?: string[]): ServerRouteNode {
  return {
    filePath: `/app/server/routes${routePath}.ts`,
    routePath: `/api${routePath}`,
    paramNames: [],
    pattern: /^x$/,
    ...(methods !== undefined ? { methods } : {}),
    ...(publicMethods !== undefined ? { publicMethods } : {}),
  }
}

const loopback = { host: 'localhost', source: 'default' } as const
const everyInterface = { host: '0.0.0.0', source: 'config' } as const

describe('assessPublicExposure', () => {
  it('says nothing about a loopback bind, however open the routes are', () => {
    const verdict = assessPublicExposure({
      routes: [node('/email/send', ['POST'], ['POST'])],
      target: loopback,
      allowUnauthenticatedWrites: false,
    })
    expect(verdict.kind).toBe('not-exposed')
  })

  it('refuses a public bind when an unauthenticated write route exists, and names it', () => {
    const verdict = assessPublicExposure({
      routes: [
        node('/health', ['GET'], ['GET']),
        node('/email/send', ['POST'], ['POST']),
        node('/artifacts', ['POST'], ['GET', 'POST']),
      ],
      target: everyInterface,
      allowUnauthenticatedWrites: false,
    })
    expect(verdict.kind).toBe('refused')
    if (verdict.kind !== 'refused') throw new Error('unreachable')
    expect(verdict.exposures).toEqual([
      { routePath: '/api/email/send', method: 'POST' },
      { routePath: '/api/artifacts', method: 'POST' },
    ])
    // The message has to be actionable at 3am, not merely correct — and grammatical, since the
    // first version read "1 write route accept" for the singular case the binary hits most.
    expect(verdict.message).toContain('2 write routes accept unauthenticated requests')
    expect(verdict.message).toContain('/api/email/send')
    expect(verdict.message).toContain('allowUnauthenticatedWrites')
  })

  it('allows a public bind when every write route is guarded', () => {
    const verdict = assessPublicExposure({
      routes: [node('/health', ['GET'], ['GET']), node('/email/send', [], ['POST'])],
      target: everyInterface,
      allowUnauthenticatedWrites: false,
    })
    expect(verdict.kind).toBe('allowed')
  })

  it('honours an explicit written override, and still says what it let through', () => {
    const verdict = assessPublicExposure({
      routes: [node('/email/send', ['POST'], ['POST'])],
      target: everyInterface,
      allowUnauthenticatedWrites: true,
    })
    expect(verdict.kind).toBe('allowed-by-override')
    if (verdict.kind !== 'allowed-by-override') throw new Error('unreachable')
    expect(verdict.exposures).toHaveLength(1)
  })

  it('reports UNVERIFIED — never "allowed" — for a manifest that predates the check', () => {
    // `publicMethods: undefined` means "not detected", exactly as `methods: undefined` already does.
    // Reading absence as safety is the failure this whole gate exists to prevent, one field over.
    const verdict = assessPublicExposure({
      routes: [node('/email/send', undefined, ['POST'])],
      target: everyInterface,
      allowUnauthenticatedWrites: false,
    })
    expect(verdict.kind).toBe('unverified')
    if (verdict.kind !== 'unverified') throw new Error('unreachable')
    expect(verdict.message).toContain('theo build')
  })

  /**
   * An app that serves entirely through controllers writes `routes: []` into its manifest — the
   * scan behind that array reads `server/routes/`, and a controller-only app has none. Measured on
   * `appplugins`: nine controllers, sixteen served routes, `"routes": 0` in the manifest
   * (usetheokit/theokit#543).
   *
   * `cannotAnswer` was written for a DIFFERENT absence — a manifest built before `publicMethods`
   * existed — and it detects that one by asking whether any route declares a mutating method. On an
   * empty table `.some()` is false for both questions, so the gate concludes there is nothing to
   * expose and binds a public interface in silence. A controller declaring
   * `@SetMetadata('theokit:public', true)` on a POST is then reachable from the network by exactly
   * the path this gate exists to refuse.
   *
   * The honest answer to an empty route table is not "nothing is exposed". It is "this does not
   * describe what the app serves" — which is what `unverified` already means.
   */
  it('reports UNVERIFIED for an empty route table — silence is not the same as nothing', () => {
    const verdict = assessPublicExposure({
      routes: [],
      target: everyInterface,
      allowUnauthenticatedWrites: false,
      hasControllers: true,
    })
    expect(verdict.kind).toBe('unverified')
    if (verdict.kind !== 'unverified') throw new Error('unreachable')
    // The message must fit THIS cause. Telling someone whose build is fine to run `theo build`
    // teaches them the warning is noise, and the next real one gets the same treatment.
    expect(verdict.message).not.toContain('theo build')
    expect(verdict.message).toContain('controllers')
  })

  it('says nothing about an app that genuinely serves nothing', () => {
    // The counterpart, and it is what keeps the warning above meaningful. An app with no routes and
    // no controllers is safe to bind anywhere; warning about it is the kind of noise that gets a
    // gate switched off, and then the real warning goes with it.
    const verdict = assessPublicExposure({
      routes: [],
      target: everyInterface,
      allowUnauthenticatedWrites: false,
      hasControllers: false,
    })
    expect(verdict.kind).toBe('allowed')
  })

  it('treats an unstated hasControllers as unknown, not as false', () => {
    // A caller that has not been updated gets the cautious answer. "Absence is not safety" is this
    // file's own rule, and it applies to the field that reports the absence too.
    const verdict = assessPublicExposure({
      routes: [],
      target: everyInterface,
      allowUnauthenticatedWrites: false,
    })
    expect(verdict.kind).toBe('unverified')
  })

  it('still allows a public bind when the table is empty AND the override is written down', () => {
    // The escape hatch has to keep working, or the gate becomes something people delete.
    const verdict = assessPublicExposure({
      routes: [],
      target: everyInterface,
      allowUnauthenticatedWrites: true,
    })
    expect(verdict.kind).not.toBe('refused')
  })

  it('treats `::` as public, the same as 0.0.0.0', () => {
    const verdict = assessPublicExposure({
      routes: [node('/email/send', ['POST'], ['POST'])],
      target: { host: '::', source: 'env' },
      allowUnauthenticatedWrites: false,
    })
    expect(verdict.kind).toBe('refused')
  })

  it('treats a LAN address as public — the risk is the interface, not the wildcard', () => {
    const verdict = assessPublicExposure({
      routes: [node('/email/send', ['POST'], ['POST'])],
      target: { host: '192.168.1.40', source: 'config' },
      allowUnauthenticatedWrites: false,
    })
    expect(verdict.kind).toBe('refused')
  })

  it('leaves 127.0.0.1 and ::1 alone', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      const verdict = assessPublicExposure({
        routes: [node('/email/send', ['POST'], ['POST'])],
        target: { host, source: 'config' },
        allowUnauthenticatedWrites: false,
      })
      expect(verdict.kind, host).toBe('not-exposed')
    }
  })
})
