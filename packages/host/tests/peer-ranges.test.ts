import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

interface Manifest {
  version: string
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Manifest
const host = read(new URL('../package.json', import.meta.url).pathname)
const require_ = createRequire(import.meta.url)
const upper = (range: string) => Number(/<\s*(\d+)/.exec(range)?.[1])
const hostSdkCeiling = upper(host.peerDependencies?.['@theokit/sdk'] ?? '')

// Peers whose latest published release still caps the SDK below the host's range.
// Waiting on an upstream @theokit/gateway-agent release; the second test fails when
// it lands, so this entry gets removed instead of rotting.
const KNOWN_UPSTREAM_GAP = ['@theokit/gateway-agent']

const sdkCeilingOf = (name: string) =>
  upper(read(require_.resolve(`${name}/package.json`)).peerDependencies?.['@theokit/sdk'] ?? '')

const hostPeers = Object.keys(host.peerDependencies ?? {}).filter(
  (name) => name.startsWith('@theokit/') && name !== '@theokit/sdk',
)

describe('the host peer ranges can resolve together under npm', () => {
  it.each(hostPeers.filter((n) => !KNOWN_UPSTREAM_GAP.includes(n)))(
    '%s declares an SDK ceiling that covers the host range',
    (name) => {
      expect(read(require_.resolve(`${name}/package.json`)).version).toBe(
        host.devDependencies?.[name],
      )
      expect(sdkCeilingOf(name)).toBeGreaterThanOrEqual(hostSdkCeiling)
    },
  )

  it.each(KNOWN_UPSTREAM_GAP)('%s still caps the SDK below the host range (known gap)', (name) => {
    expect(sdkCeilingOf(name)).toBeLessThan(hostSdkCeiling)
  })
})
