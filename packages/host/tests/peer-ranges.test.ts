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

const sdkCeilingOf = (name: string) =>
  upper(read(require_.resolve(`${name}/package.json`)).peerDependencies?.['@theokit/sdk'] ?? '')

const hostPeers = Object.keys(host.peerDependencies ?? {}).filter(
  (name) => name.startsWith('@theokit/') && name !== '@theokit/sdk',
)

describe('the host peer ranges can resolve together under npm', () => {
  it.each(hostPeers)('%s declares an SDK ceiling that covers the host range', (name) => {
    expect(read(require_.resolve(`${name}/package.json`)).version).toBe(
      host.devDependencies?.[name],
    )
    expect(sdkCeilingOf(name)).toBeGreaterThanOrEqual(hostSdkCeiling)
  })
})
