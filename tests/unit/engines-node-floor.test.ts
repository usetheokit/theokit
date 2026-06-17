import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * T1.3 — every workspace package.json must declare the documented Node floor.
 * CLAUDE.md "Native bindings discipline" claims engines.node ">=22.12.0" but no
 * manifest declared it; pnpm warns consumers on mismatch (Next.js pins the same way:
 * packages/next/package.json engines.node ">=20.9.0"). Aligns with .nvmrc (22).
 */
const ROOT = join(import.meta.dirname, '..', '..')
const MANIFESTS = [
  'package.json',
  'packages/theo/package.json',
  'packages/agents/package.json',
  'packages/http/package.json',
  'packages/create-theokit/package.json',
]
const EXPECTED = '>=22.12.0'

describe('engines.node floor (T1.3)', () => {
  for (const rel of MANIFESTS) {
    it(`test_engines_node_floor_declared_in_${rel.replace(/[/.]/g, '_')}`, () => {
      const pkg = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))
      expect(pkg.engines?.node).toBe(EXPECTED)
    })
  }
})
