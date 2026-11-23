import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The gateway options TheoClaw's own authorization, session-key and channel-loop code will drop for. */
describe('the pinned @theokit/gateway', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>
  }
  const pinned = manifest.dependencies['@theokit/gateway'] ?? ''

  it('is pinned exactly at 0.30.0 or newer', () => {
    const [major, minor] = pinned.split('.').map(Number)
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/)
    expect(major === 0 ? (minor ?? 0) >= 30 : (major ?? 0) > 0).toBe(true)
  })

  it('ships the access-policy messages, scoped keys and reconnect options', () => {
    const dts = readFileSync(
      join(__dirname, '..', 'node_modules', '@theokit', 'gateway', 'dist', 'index.d.ts'),
      'utf8',
    )
    for (const name of ['pairingOff', 'failedSave', 'invalidCode', 'retryFalse']) {
      expect(dts).toContain(name)
    }
  })
})
