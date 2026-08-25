/**
 * usetheokit/theokit#470 — the key the generator emits must reach the URL the route is served at.
 *
 * Both halves were tested, and neither test could see the defect. `generate-client-dts.test.ts`
 * asserted that `user-profiles` becomes `userProfiles` in the emitted type. `app-client-proxy.test.ts`
 * declared a fixture interface with a `userProfiles` key and asserted the proxy builds a URL from
 * the keys it is given. Both passed. Together they described a client that types
 * `client.agentsConfig.get()`, requests `/api/agentsConfig`, and gets a 404 — because the route is
 * served at `/api/agents-config`.
 *
 * So this file tests the joint: it takes the key out of the GENERATED type and drives the REAL
 * proxy with it, then asserts the URL matches the route path the manifest declared. Nothing else
 * in the suite crosses that boundary.
 */
import { describe, expect, it, vi } from 'vitest'

import { createAppClient } from '../../packages/theo/src/client/app-client.js'
import { generateClientDts } from '../../packages/theo/src/vite-plugin/app-typed-client.js'
import type { TheoManifest } from '../../packages/theo/src/server/scan/manifest.js'

/** The segment keys the generated type exposes at the top level of `AppClient`, in order. */
function topLevelKeysOf(dts: string): string[] {
  const body = dts.slice(dts.indexOf('export interface AppClient'))
  // Keys are emitted at a fixed indent under the interface: `    name: {` or `    'na-me': {`.
  return [...body.matchAll(/^ {4}('[^']+'|[A-Za-z_$][\w$]*): \{/gm)].map((m) =>
    m[1].startsWith("'") ? m[1].slice(1, -1) : m[1],
  )
}

function mkManifest(routePath: string, filePath: string): TheoManifest {
  return {
    version: 1,
    generatedAt: '2026-06-01T00:00:00.000Z',
    routes: [{ filePath, routePath, paramNames: [], methods: ['GET'] }],
    actions: [],
    websockets: [],
  }
}

/** Drive the real proxy with a key and report the URL it asked for. */
async function urlFor(key: string): Promise<string> {
  let requested = ''
  const fetchImpl = vi.fn(async (url: string) => {
    requested = url
    return {} as unknown
  }) as unknown as Parameters<typeof createAppClient>[1]

  const client = createAppClient({ baseUrl: '/api' }, fetchImpl) as unknown as Record<
    string,
    { get: () => Promise<unknown> }
  >
  await client[key].get()
  return requested
}

describe('the generated client reaches the route it was generated from', () => {
  it.each([
    ['/api/health', 'routes/health.ts'],
    ['/api/agents-config', 'routes/agents-config.ts'],
    ['/api/user-profiles', 'routes/user-profiles.ts'],
    ['/api/not-found', 'routes/not-found.ts'],
  ])('%s', async (routePath, filePath) => {
    const dts = generateClientDts({
      manifest: mkManifest(routePath, filePath),
      dtsOutPath: '/proj/.theokit/client.d.ts',
      serverDir: '/proj/server',
    })

    const keys = topLevelKeysOf(dts)
    expect(keys).toHaveLength(1)

    // The whole point: the key the TYPE offers, handed to the RUNTIME, must produce the route path.
    await expect(urlFor(keys[0])).resolves.toBe(routePath)
  })
})
