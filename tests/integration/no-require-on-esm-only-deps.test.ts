/**
 * D13 gate (T1.2 do plano dogfood-fixes-and-coverage-expansion).
 *
 * Invariant: no code path in theokit/packages/theo/src may use
 * require() or require.resolve() on @theokit/ui, which is ESM-only by design.
 *
 * This test is the CANARY that prevents a regression of the EC-S5/EC-S4 root cause.
 * @theokit/ui declares `"type": "module"` + exports[.] with only the `import`
 * condition — require() returns ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * Mandatory substitutes for detection:
 *   - Filesystem walk via `existsSync(join(cwd, 'node_modules', '@theokit/ui', ...))`
 *   - `import.meta.resolve(...)` (Node 22+ stable)
 *   - Async `import('@theokit/ui')`
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect } from 'vitest'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const SRC = join(TEST_DIR, '..', '..', 'packages', 'theo', 'src')

function walkTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(p))
    } else if (
      entry.isFile() &&
      p.endsWith('.ts') &&
      !p.endsWith('.test.ts') &&
      !p.endsWith('.test-d.ts')
    ) {
      out.push(p)
    }
  }
  return out
}

const FORBIDDEN_DEPS = ['@theokit/ui']

/**
 * Files whose code paths TOUCH @theokit/ui (even through a parameterized name).
 * Here we apply the stricter check: no `createRequire(import.meta.url)` allowed —
 * because the localRequire helper would be used to resolve `@theokit/ui` (ESM-only).
 *
 * These files MUST use a filesystem walk OR import.meta.resolve OR an async import.
 */
const UI_TOUCHING_FILES = [
  'vite-plugin/theoui-detect.ts',
  'vite-plugin/auto-detect.ts',
  'vite-plugin/integrate-ui.ts',
  'vite-plugin/inject-stylesheets.ts',
]

describe('D13: zero require.resolve / require on ESM-only deps in production code', () => {
  const files = walkTsFiles(SRC)

  it.each(FORBIDDEN_DEPS)(
    'no production .ts file calls require.resolve("%s/...") or require("%s/...")',
    (dep) => {
      const violations: Array<{ file: string; line: number; text: string }> = []
      const escaped = dep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Patterns to detect:
      //   require('@theokit/ui...')         — direct CJS require
      //   require("@theokit/ui...")
      //   require.resolve('@theokit/ui...') — resolve via CJS module algorithm
      //   localRequire.resolve('@theokit/ui...') — named CJS require helper
      //   createRequire(...).resolve('@theokit/ui...') — inline pattern
      const patterns = [
        new RegExp(`\\brequire\\s*\\(\\s*['"\`]${escaped}`, 'g'),
        new RegExp(`\\brequire\\.resolve\\s*\\(\\s*['"\`]${escaped}`, 'g'),
        new RegExp(`\\.resolve\\s*\\(\\s*['"\`]${escaped}`, 'g'),
      ]

      for (const file of files) {
        const content = readFileSync(file, 'utf-8')
        const lines = content.split('\n')
        lines.forEach((line, idx) => {
          // Skip JSDoc comments + line comments referencing for documentation
          const trimmed = line.trim()
          if (trimmed.startsWith('*') || trimmed.startsWith('//')) return

          for (const pat of patterns) {
            pat.lastIndex = 0
            if (pat.test(line)) {
              violations.push({
                file: relative(join(SRC, '..', '..'), file),
                line: idx + 1,
                text: line.trim(),
              })
              break // 1 violation per line is enough
            }
          }
        })
      }

      // Given the D13 invariant (UI is ESM-only),
      // When we audit theokit src for require patterns,
      // Then ZERO production code paths should use require() or require.resolve() on UI.
      expect(
        violations,
        violations.length > 0
          ? `D13 violations found (${violations.length}):\n` +
              violations.map((v) => `  ${v.file}:${v.line}: ${v.text}`).join('\n') +
              `\n\nSubstitute by:\n` +
              `  - existsSync(join(cwd, 'node_modules', '@theokit/ui', ...))  // filesystem probe\n` +
              `  - await import('@theokit/ui')  // async ESM import\n` +
              `  - import.meta.resolve('@theokit/ui')  // Node 22+ ESM resolver\n` +
              `See ADR D13.`
          : undefined,
      ).toEqual([])
    },
  )

  it('UI-touching files should not use createRequire(import.meta.url) or localRequire.resolve()', () => {
    // Given files whose paths process @theokit/ui (parameterized or direct),
    // When we check for createRequire/localRequire patterns,
    // Then none of those files may use the require helper (all must use a filesystem walk).
    const violations: Array<{ file: string; line: number; text: string }> = []
    for (const relative of UI_TOUCHING_FILES) {
      const file = join(SRC, relative)
      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      lines.forEach((line, idx) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//')) return
        // Detect: createRequire(...) AND any .resolve( call (covers localRequire.resolve)
        if (/\bcreateRequire\s*\(/.test(line) || /\blocalRequire\.resolve\s*\(/.test(line)) {
          violations.push({ file: relative, line: idx + 1, text: trimmed })
        }
      })
    }
    expect(
      violations,
      violations.length > 0
        ? `D13 UI-touching files using require helper:\n` +
            violations.map((v) => `  ${v.file}:${v.line}: ${v.text}`).join('\n') +
            `\n\nUse filesystem walk (existsSync + node_modules path) instead.`
        : undefined,
    ).toEqual([])
  })
})
