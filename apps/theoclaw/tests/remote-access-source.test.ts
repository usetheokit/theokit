import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The SSH local forward is safe exactly while no TheoClaw route trusts a loopback peer: through
 * `ssh -L`, every request arrives from 127.0.0.1, so the bearer token is the whole gate (B-512,
 * NFR-003). These guards run in CI, with no network, so a change that keys access on the peer
 * address, or brings in an SSH library, fails here and not only in the live test CI never runs.
 */
const APP_DIR = fileURLToPath(new URL('..', import.meta.url))
const SRC_DIR = join(APP_DIR, 'src')

/** The seven spellings NFR-003 names, matched case-insensitively. */
const PEER_ADDRESS_SPELLINGS = ['remoteAddress', 'x-forwarded-for', 'x-real-ip', "'forwarded'", '"forwarded"', 'resolveClientIp', '@Ip(']

function sourceFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .map((path) => join(SRC_DIR, path))
}

describe('remote access source guards', () => {
  it('no TheoClaw source reads a peer address', () => {
    const files = sourceFiles()
    expect(files.length, 'no source files found under src/').toBeGreaterThan(0)
    const hits = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8').toLowerCase()
      return PEER_ADDRESS_SPELLINGS.filter((spelling) => text.includes(spelling.toLowerCase())).map(
        (spelling) => `${file.slice(APP_DIR.length)}: ${spelling}`,
      )
    })
    expect(hits).toEqual([])
  })

  it('declares no SSH library among its dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const depNames = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]
    expect(depNames.length, 'the manifest declares no dependency at all').toBeGreaterThan(0)
    expect(depNames.filter((name) => name.toLowerCase().includes('ssh'))).toEqual([])
  })
})
