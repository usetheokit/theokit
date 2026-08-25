/**
 * End-to-end over the seam that matters: a real route file on disk, scanned by the real scanner,
 * judged by the real gate. The unit tests either side of this one both pass while the two halves
 * disagree about the field's name or its emptiness convention, which is the failure this covers.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'

import { assessPublicExposure } from '../../packages/theo/src/cli/commands/start/public-exposure-gate.js'
import {
  scanServerRoutes,
  _resetRouteScanCacheForTests,
} from '../../packages/theo/src/server/scan/scan.js'

function projectWith(files: Record<string, string>): string {
  const serverDir = join(mkdtempSync(join(tmpdir(), 'theokit-exposure-')), 'server')
  for (const [rel, source] of Object.entries(files)) {
    const abs = join(serverDir, 'routes', rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, source)
  }
  return serverDir
}

const everyInterface = { host: '0.0.0.0', source: 'config' } as const

beforeEach(() => {
  _resetRouteScanCacheForTests()
})

describe('the gate judges what the scanner actually found', () => {
  it('refuses a public bind for a real unauthenticated POST on disk', () => {
    const serverDir = projectWith({
      'email/send.ts': `
        import { route } from 'theokit/server/define'
        export const POST = route().policy('public').handler(() => ({ sent: true })).build()
      `,
    })

    const routes = scanServerRoutes(serverDir)
    expect(routes[0]?.publicMethods).toEqual(['POST'])

    const verdict = assessPublicExposure({
      routes,
      target: everyInterface,
      allowUnauthenticatedWrites: false,
    })
    expect(verdict.kind).toBe('refused')
    if (verdict.kind !== 'refused') throw new Error('unreachable')
    expect(verdict.exposures).toEqual([{ routePath: '/api/email/send', method: 'POST' }])
  })

  it('allows a public bind when the real POST carries a real guard', () => {
    const serverDir = projectWith({
      'email/send.ts': `
        import { route } from 'theokit/server/define'
        export const POST = route()
          .policy(({ subject }) => subject !== null)
          .handler(() => ({ sent: true }))
          .build()
      `,
      'health.ts': `
        import { route } from 'theokit/server/define'
        export const GET = route().policy('public').handler(() => ({ ok: true })).build()
      `,
    })

    const routes = scanServerRoutes(serverDir)
    const verdict = assessPublicExposure({
      routes,
      target: everyInterface,
      allowUnauthenticatedWrites: false,
    })
    // The public GET is deliberately not an exposure — see the gate's module docblock.
    expect(verdict.kind).toBe('allowed')
  })

  it('a scanned table is never reported UNVERIFIED, even when nothing is public', () => {
    // `publicMethods: []` and `publicMethods: undefined` must not collapse: the first is a
    // measurement, the second is its absence.
    const serverDir = projectWith({
      'notes.ts': `
        import { route } from 'theokit/server/define'
        export const POST = route().policy(guard).handler(() => ({})).build()
      `,
    })

    const routes = scanServerRoutes(serverDir)
    expect(routes[0]?.publicMethods).toEqual([])

    const verdict = assessPublicExposure({
      routes,
      target: everyInterface,
      allowUnauthenticatedWrites: false,
    })
    expect(verdict.kind).toBe('allowed')
  })
})
