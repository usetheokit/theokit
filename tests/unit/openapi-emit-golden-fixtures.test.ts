/**
 * T3.1 — Golden-fixture parse-then-compare tests.
 *
 * Per G2 plan v1.1 T3.1 + blueprint R4 + ADR D4. Mirrors encore's
 * testdata pattern: 1 comprehensive + 2 single-feature fixtures, each
 * with a checked-in `expected_*.json` golden file.
 *
 * Regenerate the goldens with `pnpm openapi:regen-fixtures` — NEVER
 * `vitest --update`. Goldens are read-only inputs to the test.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { emitOpenApi } from '../../packages/theo/src/vite-plugin/openapi-emit/emit.js'
import { DISCRIMINATED_UNION_MANIFEST } from '../fixtures/openapi-emit/source/discriminated-union-app.js'
import { FULL_APP_MANIFEST } from '../fixtures/openapi-emit/source/full-app.js'
import { buildRecursiveFixture } from '../fixtures/openapi-emit/source/recursive-type-app.js'

const FIXTURES_DIR = resolve(__dirname, '../fixtures/openapi-emit')

const BASE_CONFIG = {
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  specVersion: '3.1.0' as const,
  title: 'TheoKit Golden Fixture',
  version: '0.0.0',
}

function loadGolden(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8')) as unknown
}

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'theokit-g2-golden-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('T3.1 — golden fixtures', () => {
  it('full-app emits matches expected_full_openapi.json', () => {
    const { document } = emitOpenApi({
      manifest: FULL_APP_MANIFEST,
      config: { ...BASE_CONFIG, outDir: tmpDir },
    })
    const golden = loadGolden('expected_full_openapi.json')
    expect(document).toEqual(golden)
  })

  it('discriminated-union emits matches expected_discriminated_union_openapi.json', () => {
    const { document } = emitOpenApi({
      manifest: DISCRIMINATED_UNION_MANIFEST,
      config: { ...BASE_CONFIG, outDir: tmpDir },
    })
    const golden = loadGolden('expected_discriminated_union_openapi.json')
    expect(document).toEqual(golden)
  })

  it('recursive type emits components map matches expected_recursive_type_components.json', () => {
    const { ref, components } = buildRecursiveFixture()
    const golden = loadGolden('expected_recursive_type_components.json') as {
      ref: unknown
      components: unknown
    }
    expect(ref).toEqual(golden.ref)
    expect(components).toEqual(golden.components)
  })
})
