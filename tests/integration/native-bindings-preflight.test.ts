import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  ensureNativeBindings,
  findRebuildCwd,
  _preflight,
} from '../../scripts/preflight-native-bindings.mjs'

/**
 * Integration coverage for the native-bindings preflight — exercises the REAL
 * boundary (actual better-sqlite3 dlopen + real fs sentinel), complementing the
 * unit suite which drives the `_preflight` DI seam with fakes. This is the
 * wiring-triad pillar (b) for `ensureNativeBindings`: the same call the vitest
 * globalSetup (tests/setup-native-bindings.ts) makes on every run.
 */
describe('native-bindings preflight (integration — real ABI boundary)', () => {
  it('ensureNativeBindings resolves on a healthy ABI without throwing (real better-sqlite3 dlopen)', async () => {
    // If this test runs at all, the globalSetup already proved the ABI is healthy;
    // calling again must be idempotent (sentinel fast-path) and must not throw.
    await expect(ensureNativeBindings()).resolves.toBeUndefined()
  })

  it('writes (or reuses) the abi+deps-hash sentinel under node_modules/.cache', async () => {
    await ensureNativeBindings()
    const cacheDir = join(process.cwd(), 'node_modules', '.cache')
    // The sentinel name is preflight-native-<abi>-<depshash>.ok; at least the dir must exist.
    expect(existsSync(cacheDir)).toBe(true)
  })

  it('findRebuildCwd returns the repo root for a local (non-symlinked) path', () => {
    // A path inside the repo's own node_modules resolves to the repo root (local case).
    const local = join(process.cwd(), 'node_modules')
    expect(findRebuildCwd(local, process.cwd())).toBe(process.cwd())
  })

  it('_preflight is the injectable seam ensureNativeBindings delegates to', () => {
    expect(typeof _preflight).toBe('function')
  })
})
