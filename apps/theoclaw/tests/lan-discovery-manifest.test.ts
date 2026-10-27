import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as Manifest

/** NFR-004 (B-513): one mDNS library, pinned exactly, since the adapter reaches a private member of it. */
describe('the LAN discovery dependency', () => {
  it('declares bonjour-service and no other mDNS library', () => {
    const dependencies = manifest.dependencies ?? {}
    expect(dependencies['bonjour-service']).toBe('1.4.4')
    for (const other of ['multicast-dns', '@homebridge/ciao', 'mdns']) {
      expect(dependencies).not.toHaveProperty(other)
    }
  })
})
