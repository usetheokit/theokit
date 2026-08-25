/**
 * A `routes/api/` directory doubles the prefix, silently, in TWO places.
 *
 * `fileToRoutePath` returns `/api/${rel}`, unconditionally. So a file the docs themselves showed
 * as `server/routes/api/auth/github/start.ts` resolves to `/api/api/auth/github/start` — a URL
 * nobody will request, and in particular not the redirect URI registered with the identity
 * provider, which is where this was found.
 *
 * The second place is worse because it survives a reader's attention. `.theokit/client.d.ts`
 * mirrors the file tree into the typed client's property chain, so the same file produces
 * `client.api.auth.github.start.get()` — with an `api` segment that reads as a typo and is not
 * one. The URL and the client are wrong together, from one cause.
 *
 * Refusing rather than collapsing is deliberate. Stripping a leading `api/` would replace one
 * silent behaviour with another, and would let `routes/api/foo.ts` and `routes/foo.ts` resolve to
 * the same URL — a collision the scanner would then need its own error for anyway.
 *
 * The `/api` prefix itself is load-bearing and is NOT what is wrong here: it is the boundary
 * between what the server answers and what the SPA answers, and three framework namespaces live
 * under it (`/api/__actions/`, `/api/agents/`, `/api/__theo_batch__`). Removing it would put user
 * routes in the same URL space as pages and strand those three.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { scanServerRoutes } from '../../packages/theo/src/server/scan/scan.js'
import { RedundantApiSegmentError } from '../../packages/theo/src/server/scan/errors.js'

let serverDir: string

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'theo-api-prefix-'))
  serverDir = join(base, 'server')
  mkdirSync(join(serverDir, 'routes'), { recursive: true })
})

function touch(
  relativePath: string,
  content = "export const GET = { policy: 'public', handler: () => ({}) }",
) {
  const full = join(serverDir, 'routes', relativePath)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('a routes/api/ directory is refused rather than doubled', () => {
  it('rejects routes/api/health.ts', () => {
    touch('api/health.ts')

    expect(() => scanServerRoutes(serverDir)).toThrow(RedundantApiSegmentError)
  })

  it('rejects it however deep the file sits', () => {
    touch('api/auth/github/start.ts')

    expect(() => scanServerRoutes(serverDir)).toThrow(RedundantApiSegmentError)
  })

  it('names the file and the path it would have produced', () => {
    touch('api/auth/github/start.ts')

    // An error that only says "no" costs a reader the same investigation this one came from.
    expect(() => scanServerRoutes(serverDir)).toThrow(/api\/api\/auth\/github\/start/)
    expect(() => scanServerRoutes(serverDir)).toThrow(/routes\/auth\/github\/start\.ts/)
  })

  it('leaves a route merely NAMED api alone — only the directory doubles', () => {
    // `routes/api.ts` resolves to `/api/api`, which is odd and is the author's to choose. What
    // this gate refuses is the directory, because that is what silently prefixes every file under
    // it and corrupts the client tree with it.
    touch('apiary.ts')
    touch('api-keys.ts')

    const routes = scanServerRoutes(serverDir)

    expect(routes.map((r) => r.routePath).sort((a, b) => a.localeCompare(b))).toEqual([
      '/api/api-keys',
      '/api/apiary',
    ])
  })

  it('accepts the correct layout, and it is what the client tree mirrors', () => {
    touch('auth/github/start.ts')
    touch('health.ts')

    const routes = scanServerRoutes(serverDir)

    expect(routes.map((r) => r.routePath).sort((a, b) => a.localeCompare(b))).toEqual([
      '/api/auth/github/start',
      '/api/health',
    ])
  })
})
