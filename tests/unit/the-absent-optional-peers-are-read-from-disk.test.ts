/**
 * The disk half of the Cloudflare alias table.
 *
 * `absentOptionalPeers` is pure and covered next door; this is the reader that decides what it
 * is given, and it was reachable only through a build that runs Vite — so the derivation was
 * proven on fabricated input and never on a project.
 *
 * What it must get right is narrow and was measured on a real scaffold: the table is DERIVED
 * from every direct dependency's `peerDependenciesMeta.<name>.optional`, an installed peer is
 * left alone, and a dependency whose own manifest cannot be resolved contributes nothing
 * rather than failing the build.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { absentOptionalPeersOnDisk } from '../../packages/theo/src/adapters/cloudflare.js'

/** A project whose node_modules is fabricated, because what is read is manifests. */
function projectWith(
  dependencies: Record<string, string>,
  installed: Record<string, Record<string, unknown>>,
): string {
  const root = mkdtempSync(resolve(tmpdir(), 'theokit-cf-'))
  writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: 'p', dependencies }))
  for (const [name, manifest] of Object.entries(installed)) {
    const dir = resolve(root, 'node_modules', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ name, ...manifest }))
  }
  return root
}

const OPTIONAL = { peerDependenciesMeta: { 'better-sqlite3': { optional: true } } }

describe('absentOptionalPeersOnDisk', () => {
  it('names an optional peer a dependency declares and nothing installed', () => {
    const root = projectWith({ sdk: '^1' }, { sdk: OPTIONAL })
    expect(absentOptionalPeersOnDisk(root)).toEqual(['better-sqlite3'])
  })

  it('leaves an installed optional peer alone, so the table shrinks by itself', () => {
    const root = projectWith(
      { sdk: '^1' },
      { sdk: OPTIONAL, 'better-sqlite3': { version: '11.0.0' } },
    )
    expect(absentOptionalPeersOnDisk(root)).toEqual([])
  })

  it('ignores a peer that is not optional, which the project is expected to install', () => {
    const root = projectWith(
      { sdk: '^1' },
      { sdk: { peerDependenciesMeta: { react: { optional: false } } } },
    )
    expect(absentOptionalPeersOnDisk(root)).toEqual([])
  })

  it('contributes nothing for a dependency whose manifest cannot be resolved', () => {
    const root = projectWith({ 'never-installed': '^1' }, {})
    expect(absentOptionalPeersOnDisk(root)).toEqual([])
  })

  it('returns nothing when the project has no manifest at all, rather than failing a build', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'theokit-cf-bare-'))
    expect(absentOptionalPeersOnDisk(root)).toEqual([])
  })

  it('reports each name once when two dependencies declare the same optional peer', () => {
    const root = projectWith({ a: '^1', b: '^1' }, { a: OPTIONAL, b: OPTIONAL })
    expect(absentOptionalPeersOnDisk(root)).toEqual(['better-sqlite3'])
  })
})
