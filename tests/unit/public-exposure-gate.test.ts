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
    // The message has to be actionable at 3am, not merely correct.
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
