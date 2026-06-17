import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  findRebuildCwd,
  ensureNativeBindings,
  _preflight,
} from '../../scripts/preflight-native-bindings.mjs'

const ABI_ERROR = () =>
  new Error(
    'The module was compiled against a different Node.js version using NODE_MODULE_VERSION 127. This version requires NODE_MODULE_VERSION 137.',
  )

/** Minimal happy-path deps for the _preflight DI seam — overridden per test. */
function fakeDeps(over: Record<string, unknown> = {}) {
  const calls = {
    require: [] as string[],
    execFile: [] as Array<{ cmd: string; args: string[]; cwd?: string }>,
    written: [] as string[],
  }
  const deps = {
    abi: '137',
    sentinelDir: '/sandbox/.cache',
    repoRoot: '/sandbox',
    nativeDeps: ['better-sqlite3'],
    depsVersions: { 'better-sqlite3': '12.10.0' },
    requireDep: (n: string) => {
      calls.require.push(n)
    },
    exerciseDep: (_n: string) => {},
    resolveBinding: (_n: string) => '/sandbox',
    execFile: (cmd: string, args: string[], opts: { cwd?: string }) => {
      calls.execFile.push({ cmd, args, cwd: opts?.cwd })
    },
    existsSync: (_p: string) => false,
    mkdirSync: (_p: string, _o?: unknown) => {},
    writeFileSync: (p: string, _d: string) => {
      calls.written.push(p)
    },
    env: {} as Record<string, string | undefined>,
    ...over,
  }
  return { deps, calls }
}

/**
 * T1.2 TDD — theokit native bindings preflight unit tests.
 * Mirrors theokit-sdk/packages/sdk/tests/tools/preflight-native-bindings.test.ts.
 */

describe('findRebuildCwd (v1.1 EC-1 MUST FIX — workspace-link routing)', () => {
  let sandbox: string
  let realRepo: string
  let linkedRepo: string

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'preflight-cwd-theokit-'))
    realRepo = join(sandbox, 'sibling-sdk')
    mkdirSync(
      join(
        realRepo,
        'node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release',
      ),
      { recursive: true },
    )
    const binPath = join(
      realRepo,
      'node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    )
    writeFileSync(binPath, 'fake-bin')

    linkedRepo = join(sandbox, 'consumer-repo')
    mkdirSync(join(linkedRepo, 'node_modules/@theokit'), { recursive: true })
    symlinkSync(realRepo, join(linkedRepo, 'node_modules/@theokit/sdk'))
  })

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true })
  })

  it('resolves symlink to sibling repo (EC-1)', () => {
    // Given: a binding path under the symlinked @theokit/sdk in the consumer
    const failingBindingPath = join(
      linkedRepo,
      'node_modules/@theokit/sdk/node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    )

    // When
    const got = findRebuildCwd(failingBindingPath, linkedRepo)

    // Then: rebuild routes to the real sibling repo
    expect(got).toBe(realRepo)
  })

  it('returns default when binding is local (no regression for non-symlinked cases)', () => {
    const localBinDir = join(
      linkedRepo,
      'node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release',
    )
    mkdirSync(localBinDir, { recursive: true })
    const localBin = join(localBinDir, 'better_sqlite3.node')
    writeFileSync(localBin, 'fake')

    const got = findRebuildCwd(localBin, linkedRepo)
    expect(got).toBe(linkedRepo)
  })

  it('returns default when failingBindingPath is undefined (defensive)', () => {
    const got = findRebuildCwd(undefined, linkedRepo)
    expect(got).toBe(linkedRepo)
  })

  it('returns default when binding path does not exist (defensive)', () => {
    const bogus = join(sandbox, 'does-not-exist/foo.node')
    const got = findRebuildCwd(bogus, linkedRepo)
    expect(got).toBe(linkedRepo)
  })
})

describe('preflight-native-bindings module shape (theokit)', () => {
  it('exports findRebuildCwd + ensureNativeBindings', () => {
    expect(typeof findRebuildCwd).toBe('function')
    expect(typeof ensureNativeBindings).toBe('function')
  })

  it('ensureNativeBindings returns a Promise (async + sentinel fast-path)', async () => {
    const result = ensureNativeBindings()
    expect(result).toBeInstanceOf(Promise)
    await result
  })

  it('exports _preflight (DI seam for deterministic testing)', () => {
    expect(typeof _preflight).toBe('function')
  })
})

describe('findRebuildCwd nested node_modules (EC-14)', () => {
  let sandbox: string
  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'preflight-ec14-'))
  })
  afterEach(() => rmSync(sandbox, { recursive: true, force: true }))

  it('anchors on the FIRST /node_modules/.pnpm/ even with nested node_modules in the realpath', () => {
    // Given: a binding realpath with TWO /node_modules/ segments (pnpm store layout):
    //   <sibling>/node_modules/.pnpm/better-sqlite3@12/node_modules/better-sqlite3/build/Release/x.node
    const sibling = join(sandbox, 'sibling-sdk')
    const binDir = join(
      sibling,
      'node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release',
    )
    mkdirSync(binDir, { recursive: true })
    const bin = join(binDir, 'better_sqlite3.node')
    writeFileSync(bin, 'fake')

    // When: a consumer symlinks to the sibling and the failing path routes through it
    const consumer = join(sandbox, 'consumer')
    mkdirSync(join(consumer, 'node_modules/@theokit'), { recursive: true })
    symlinkSync(sibling, join(consumer, 'node_modules/@theokit/sdk'))
    const failing = join(
      consumer,
      'node_modules/@theokit/sdk/node_modules/.pnpm/better-sqlite3@12.10.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    )

    // Then: rebuild routes to the sibling repo root (NOT the inner nested node_modules dir)
    expect(findRebuildCwd(failing, consumer)).toBe(sibling)
  })
})

describe('_preflight — ensureNativeBindings DI seam', () => {
  it('healthy ABI: probes, writes sentinel, does not rebuild', async () => {
    const { deps, calls } = fakeDeps()
    await _preflight(deps)
    expect(calls.require).toEqual(['better-sqlite3'])
    expect(calls.execFile).toEqual([])
    expect(calls.written.length).toBe(1)
  })

  it('sentinel fast-path: existing sentinel short-circuits the probe', async () => {
    const { deps, calls } = fakeDeps({ existsSync: (_p: string) => true })
    await _preflight(deps)
    expect(calls.require).toEqual([])
    expect(calls.written).toEqual([])
  })

  it('EC-6: sentinel keyed on abi+deps-hash — a stale-key sentinel does not short-circuit a changed dep set', async () => {
    // Only an OLD-key sentinel exists on disk; the current deps produce a DIFFERENT key → must still probe.
    const seen: string[] = []
    const { deps, calls } = fakeDeps({
      existsSync: (p: string) => {
        seen.push(p)
        return p.includes('preflight-native-137-OLDHASH')
      },
    })
    await _preflight(deps)
    // The sentinel path it checks must include abi AND a deps hash (not bare abi).
    expect(seen.some((p) => /preflight-native-137-[0-9a-f]+\.ok$/.test(p))).toBe(true)
    expect(calls.require).toEqual(['better-sqlite3']) // not short-circuited by the stale-key file
  })

  it('EC-7: rebuild that does not fix the ABI throws an actionable error, with NO recursive rebuild', async () => {
    const { deps, calls } = fakeDeps({
      requireDep: (_n: string) => {
        throw ABI_ERROR()
      },
    })
    await expect(_preflight(deps)).rejects.toThrow(/rebuild|NODE_MODULE_VERSION|ABI/i)
    expect(calls.execFile.length).toBe(1) // exactly one rebuild attempt — no recursion (Q4)
  })

  it('EC-7 CI: CI=true fails closed WITHOUT auto-rebuild', async () => {
    const { deps, calls } = fakeDeps({
      env: { CI: 'true' },
      requireDep: (_n: string) => {
        throw ABI_ERROR()
      },
    })
    await expect(_preflight(deps)).rejects.toThrow(/rebuild/i)
    expect(calls.execFile).toEqual([]) // CI never auto-rebuilds
  })

  it('EC-8: missing pnpm (ENOENT) surfaces an actionable message, not a raw spawn crash', async () => {
    const enoent = Object.assign(new Error('spawn pnpm ENOENT'), { code: 'ENOENT' })
    const { deps } = fakeDeps({
      requireDep: (_n: string) => {
        throw ABI_ERROR()
      },
      execFile: () => {
        throw enoent
      },
    })
    await expect(_preflight(deps)).rejects.toThrow(/package manager|rebuild|pnpm not found/i)
  })
})
