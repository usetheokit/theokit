import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * B-429 — a test must not write probe files inside the source tree: a concurrent lint, build or
 * typecheck reads them. A probe path under `packages/` named like a probe is the shape both
 * offenders had; the fix is a temp directory.
 */
const TESTS_DIR = resolve(__dirname, '..')
const SELF = 'test-probes-outside-src-429.test.ts'
const PROBE_PATH = /['"`][^'"`\n]*packages\/[\w./-]*(?:probe|__\w+__)[\w./-]*['"`]/i

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : testFiles(full)
    return entry.name.endsWith('.test.ts') && entry.name !== SELF ? [full] : []
  })
}

function offenders(): string[] {
  return testFiles(TESTS_DIR)
    .filter((f) => PROBE_PATH.test(readFileSync(f, 'utf8')))
    .map((f) => relative(TESTS_DIR, f))
}

describe('B-429 — test probes stay outside the source tree', () => {
  it('test_no_unit_test_names_a_probe_path_under_packages', () => {
    expect(
      offenders(),
      'these tests build a probe path inside packages/; use os.tmpdir() instead',
    ).toEqual([])
  })

  it('test_the_detector_flags_the_original_offending_shape', () => {
    expect(
      PROBE_PATH.test("resolve(REPO, 'packages/theo/src/vite-plugin/__internal_privacy_probe.ts')"),
    ).toBe(true)
    expect(
      PROBE_PATH.test(
        "resolve(__dirname, '../../packages/theo/__controller_body_types_124_test__')",
      ),
    ).toBe(true)
    expect(PROBE_PATH.test("resolve(tmpdir(), 'probe.ts')")).toBe(false)
  })
})
