/**
 * M48 (ecosystem-integration-guarantee) T3.1 — the SDK-family version ranges are CLOSED and
 * aligned to the framework's v4 floor. Guards the drift discovered during discovery: the root
 * devDep pinned a stale `^3.5.0` (so root-level tests resolved 3.5.0, not the framework's 4.0.2)
 * and the `@theokit/sdk-tools` peer was left open (`>=0.11.0`). A closed range is the install-time
 * half of the seam guarantee (the boot check + contract test are the runtime half).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readPkg = (rel: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as Record<string, unknown>

describe('SDK-family peer/version ranges are closed + aligned (M48 T3.1)', () => {
  it('test_sdk_tools_peer_is_closed_caret', () => {
    const agents = readPkg('packages/agents/package.json')
    const peers = agents.peerDependencies as Record<string, string>
    expect(peers['@theokit/sdk-tools']).toBe('^0.11.0')
  })

  it('test_no_open_sdk_family_peer_remains', () => {
    for (const pkg of ['packages/theo/package.json', 'packages/agents/package.json']) {
      const peers = (readPkg(pkg).peerDependencies ?? {}) as Record<string, string>
      for (const [name, range] of Object.entries(peers)) {
        if (name.startsWith('@theokit/sdk')) {
          expect(range.startsWith('>='), `${pkg} declares an open ${name}=${range}`).toBe(false)
        }
      }
    }
  })

  it('test_root_devdep_sdk_aligned_to_v4_line', () => {
    // The root devDep must track the v4 line (not the stale `^3.5.0` hoist EC-C fixed). Assert the
    // v4 caret prefix, NOT an exact pin, so a within-v4 bump (4.0 → 4.1 → 4.2) stays green — only a
    // drop off v4 (or back to a 3.x hoist) fails here.
    const root = readPkg('package.json')
    const dev = root.devDependencies as Record<string, string>
    expect(dev['@theokit/sdk']).toMatch(/^\^4\./)
  })
})
