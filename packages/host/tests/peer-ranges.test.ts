import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>
const host = read(new URL('../package.json', import.meta.url).pathname)
const require_ = createRequire(import.meta.url)
const upper = (range: string) => Number(/<\s*(\d+)/.exec(range)?.[1])

describe('the host peer ranges can resolve together', () => {
  it('the gateway development version satisfies the SDK ceiling the host declares', () => {
    const gateway = read(require_.resolve('@theokit/gateway/package.json'))
    expect(gateway.version).toBe(host.devDependencies['@theokit/gateway'])
    expect(upper(gateway.peerDependencies['@theokit/sdk'])).toBeGreaterThanOrEqual(
      upper(host.peerDependencies['@theokit/sdk']),
    )
  })

  it('the gateway peer floor is not below the development version that covers the SDK range', () => {
    expect(host.peerDependencies['@theokit/gateway']).toMatch(/^>=0\.33\.0 /)
  })
})
