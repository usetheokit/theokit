import { describe, it, expect, vi } from 'vitest'
import type * as NodeFs from 'node:fs'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// The invariant under test is "scan output does not depend on the order the filesystem
// hands back directory entries". Creating the same tree twice in different orders does
// NOT exercise it: ext4 with dir_index returns entries in filename-hash order, which is
// identical for identical names regardless of creation order — such a test passes today
// and proves nothing. So the readdir order is controlled directly.
const state = vi.hoisted(() => ({ reverse: false }))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')
  return {
    ...actual,
    default: actual,
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) => {
      const entries = actual.readdirSync(...args)
      return state.reverse ? [...(entries as unknown[])].reverse() : entries
    },
  }
})

const { scanRoutes } = await import('../../packages/theo/src/router/scan.js')

function buildTree(): string {
  const appDir = join(mkdtempSync(join(tmpdir(), 'theo-scan-det-')), 'app')
  mkdirSync(appDir, { recursive: true })
  for (const rel of [
    'page.tsx',
    'about/page.tsx',
    'blog/page.tsx',
    'contact/page.tsx',
    'docs/page.tsx',
    'settings/page.tsx',
  ]) {
    const full = join(appDir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, 'export default {}')
  }
  return appDir
}

/** Route paths only — absolute temp paths differ per run and are not the subject. */
function shape(node: { path: string; children: { path: string }[] }): string[] {
  return [node.path, ...node.children.flatMap((c) => shape(c as never))]
}

describe('scanRoutes is deterministic (usetheokit/theokit#346)', () => {
  it('produces the same child order regardless of the order readdirSync returns entries', () => {
    const appDir = buildTree()

    state.reverse = false
    const forward = shape(scanRoutes(appDir) as never)

    state.reverse = true
    const reversed = shape(scanRoutes(appDir) as never)

    state.reverse = false

    // A build whose module graph order depends on filesystem iteration order cannot be
    // reproducible: two machines walking the same tree emit different bundles.
    expect(reversed).toEqual(forward)
  })
})
