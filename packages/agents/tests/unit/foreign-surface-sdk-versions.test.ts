import type * as nodeModule from 'node:module'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { foreignSurfaceInventory } from '../../src/bridge/foreign-surfaces.js'

type Inventory = typeof foreignSurfaceInventory

/** Loads a fresh copy of the inventory whose SDK version probe answers `probe`. */
async function inventoryFor(probe: () => unknown): Promise<Inventory> {
  vi.resetModules()
  vi.doMock('node:module', async (original) => {
    const actual = await original<typeof nodeModule>()
    return Object.assign({}, actual, { createRequire: () => probe })
  })
  return (await import('../../src/bridge/foreign-surfaces.js')).foreignSurfaceInventory
}

function put(cwd: string, rel: string, text: string): void {
  const path = join(cwd, '.claude', rel)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

function count(inventory: Inventory, cwd: string, dir: string): number {
  return inventory({ cwd }).find((e) => e.dir === dir)?.count ?? -1
}

function fixture(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'foreign-sdk-'))
  // Closing fence ends the file: only the line-based splitter accepts it.
  put(cwd, 'skills/eof/SKILL.md', '---\ndescription: x\n---')
  put(cwd, 'skills/comment/SKILL.md', '---\n# note: hi\n\ndescription: x\n---\nbody')
  put(cwd, 'skills/nokey/SKILL.md', '---\n: orphan\ndescription: x\n---\nbody')
  put(cwd, 'skills/plainline/SKILL.md', '---\njust text\ndescription: x\n---\nbody')
  put(cwd, 'skills/open-only/SKILL.md', '---\ndescription: x\nbody')
  put(cwd, 'agents/ok.md', '---\nname: ok\n---\nbody')
  put(cwd, 'agents/nokey.md', '---\n: orphan\nname: a\n---\nbody')
  put(cwd, 'agents/eof.md', '---\nname: eof\n---')
  return cwd
}

describe('foreign surface inventory by SDK version', () => {
  afterEach(() => {
    vi.doUnmock('node:module')
    vi.resetModules()
  })

  it('SDK 10+ closes a fence at end of file, skips comments and refuses a keyless line', async () => {
    const inventory = await inventoryFor(() => ({ version: '11.2.0' }))
    const cwd = fixture()
    // eof and comment are valid; nokey (empty key) and plainline (no colon) are refused.
    expect(count(inventory, cwd, 'skills')).toBe(2)
    expect(count(inventory, cwd, 'agents')).toBe(2)
  })

  it('older SDKs keep the regex rules and skip a keyless line', async () => {
    const inventory = await inventoryFor(() => ({ version: '9.4.1' }))
    const cwd = fixture()
    // eof needs a newline after the closing fence; comment, nokey and plainline parse leniently
    // (agents: ok and nokey load, eof does not).
    expect(count(inventory, cwd, 'skills')).toBe(3)
    expect(count(inventory, cwd, 'agents')).toBe(2)
  })

  it.each([
    [
      'throws',
      () => {
        throw new Error('not installed')
      },
    ],
    ['has no version', () => ({})],
  ])('falls back to the older rules when the package version %s', async (_name, probe) => {
    const inventory = await inventoryFor(probe)
    expect(count(inventory, fixture(), 'skills')).toBe(3)
  })

  it('reads the version once', async () => {
    const probe = vi.fn(() => ({ version: '10.0.0' }))
    const inventory = await inventoryFor(probe)
    const cwd = fixture()
    count(inventory, cwd, 'skills')
    count(inventory, cwd, 'agents')
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
