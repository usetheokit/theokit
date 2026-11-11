import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createDevicePairing } from '../src/control-plane/device-pairing.js'
import { loadCityLookup } from '../src/control-plane/geo-city.js'
import { serveHandler } from '../src/control-plane/http-dispatch.js'
import { PEER_ADDRESS_HEADER } from '../src/control-plane/trusted-proxy.js'

const dirs: string[] = []
const dir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'theoclaw-geo-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function database(): string {
  const path = join(dir(), 'geo.json')
  writeFileSync(
    path,
    JSON.stringify([
      { cidr: '203.0.113.0/24', city: 'Paris' },
      { cidr: '2001:db8::/32', city: 'Lisbon' },
    ]),
  )
  return path
}

describe('city lookup', () => {
  it('finds a city by range and nothing for other addresses', () => {
    const lookup = loadCityLookup(database())
    expect(lookup('203.0.113.9')).toBe('Paris')
    expect(lookup('::ffff:203.0.113.9')).toBe('Paris')
    expect(lookup('2001:db8:1::5')).toBe('Lisbon')
    expect(lookup('192.168.2.111')).toBeUndefined()
    expect(lookup(undefined)).toBeUndefined()
  })

  it('refuses a malformed database', () => {
    const path = join(dir(), 'bad.json')
    writeFileSync(path, '[{"cidr":"nope","city":"X"}]')
    expect(() => loadCityLookup(path)).toThrow(/THEOCLAW_GEOIP_DB|bad\.json/)
  })
})

describe('pending_devices city', () => {
  it('shows the city of a device that paired from another network', async () => {
    const devices = createDevicePairing({ dir: dir() })
    const handler = serveHandler(
      () => Promise.resolve(new Response(null, { status: 404 })),
      undefined,
      devices,
      undefined,
      undefined,
      undefined,
      loadCityLookup(database()),
    )
    const post = (peer: string, name: string, token: string) =>
      handler(
        new Request('http://x/control/pair', {
          method: 'POST',
          headers: { [PEER_ADDRESS_HEADER]: peer },
          body: JSON.stringify({ code: devices.issueSetupCode(), name, token }),
        }),
      )
    expect((await post('203.0.113.9', 'phone', 'abcdefghij-token-0123456789-aaaa')).status).toBe(
      202,
    )
    expect((await post('192.168.2.5', 'desk', 'klmnopqrst-token-9876543210-bbbb')).status).toBe(202)
    const pending = devices.pending()
    expect(pending.find((d) => d.name === 'phone')?.city).toBe('Paris')
    expect(pending.find((d) => d.name === 'desk')).not.toHaveProperty('city')
  })
})
