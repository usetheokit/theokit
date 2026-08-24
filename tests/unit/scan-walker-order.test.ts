import { describe, it, expect } from 'vitest'
import type { Dirent } from 'node:fs'

import { walkSourceFiles } from '../../packages/theo/src/server/_internal/scan-walker.js'

/**
 * B-004 / #346 — the walker six scanners share emitted files in whatever order
 * `readdirSync` returned them.
 *
 * `router/scan.ts` was fixed to sort and this walker was not, so routes,
 * actions, websockets, cron, agents and jobs all inherited the filesystem's
 * order. Only one of the six re-orders afterwards (`server/scan/scan.ts` sorts
 * by route specificity), leaving five to emit a different manifest per machine —
 * and where that order is an execution order, it decides what runs first.
 *
 * The directory reader is injected rather than real, and that is the point. A
 * name-based test against a real directory passed BEFORE the sort existed on the
 * machine this was written on: ext4 with `dir_index` happened to return those
 * four names already ordered. A test that agrees with the code because both
 * observed the same accidental order is `B-022` — it cannot disagree, so it
 * cannot protect anything. Handing the walker a hostile order is what makes the
 * assertion mean something on every machine.
 */

function dirent(name: string, kind: 'file' | 'dir'): Dirent {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
  } as unknown as Dirent
}

/** A reader that hands back each directory's entries in the worst order for us. */
function reversedReader(tree: Record<string, Dirent[]>): (dir: string) => Dirent[] {
  return (dir: string) => [...(tree[dir] ?? [])].reverse()
}

function walk(tree: Record<string, Dirent[]>): string[] {
  const seen: string[] = []
  walkSourceFiles('/root', { extensions: new Set(['.ts']), readDir: reversedReader(tree) }, (p) =>
    seen.push(p),
  )
  return seen
}

describe('walkSourceFiles imposes its own order (B-004)', () => {
  it('test_files_are_emitted_in_code_unit_order_whatever_the_reader_returns', () => {
    const names = walk({
      '/root': [
        dirent('Mango.ts', 'file'),
        dirent('alpha.ts', 'file'),
        dirent('beta.ts', 'file'),
        dirent('zebra.ts', 'file'),
      ],
    })

    // Code unit, not locale: uppercase before lowercase. `localeCompare` would
    // order these differently under a different LANG, which is the divergence
    // that made the build unreproducible.
    expect(names).toEqual(['/root/Mango.ts', '/root/alpha.ts', '/root/beta.ts', '/root/zebra.ts'])
  })

  it('test_directories_are_descended_in_code_unit_order', () => {
    const names = walk({
      '/root': [dirent('alpha', 'dir'), dirent('mike', 'dir'), dirent('zulu', 'dir')],
      '/root/alpha': [dirent('index.ts', 'file')],
      '/root/mike': [dirent('index.ts', 'file')],
      '/root/zulu': [dirent('index.ts', 'file')],
    })

    expect(names).toEqual(['/root/alpha/index.ts', '/root/mike/index.ts', '/root/zulu/index.ts'])
  })

  it('test_a_file_sorts_against_a_directory_by_the_same_rule', () => {
    // A level mixing both is where an order that sorts only files, or only
    // directories, stops being total — the interleaving would be decided by the
    // reader again.
    const names = walk({
      '/root': [dirent('a', 'dir'), dirent('b.ts', 'file')],
      '/root/a': [dirent('inner.ts', 'file')],
    })

    expect(names).toEqual(['/root/a/inner.ts', '/root/b.ts'])
  })

  it('test_skipped_prefixes_are_still_skipped_after_ordering', () => {
    // Sorting must not resurrect a directory the caller excluded.
    const names = walk({
      '/root': [dirent('_private', 'dir'), dirent('public.ts', 'file')],
      '/root/_private': [dirent('secret.ts', 'file')],
    })

    expect(names).toEqual(['/root/public.ts'])
  })
})
