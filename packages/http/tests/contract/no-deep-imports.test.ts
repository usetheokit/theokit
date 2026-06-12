import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC_DIR = join(import.meta.dirname, '../../src')

const FORBIDDEN_PATTERNS = [
  /from\s+['"]theokit\/server\/define\/[^'"]+['"]/,
  /from\s+['"]theokit\/server\/http\/[^'"]+['"]/,
  /from\s+['"]theokit\/server\/scan\/[^'"]+['"]/,
  /from\s+['"]theokit\/core\/[^'"]+['"]/,
  /from\s+['"]theokit\/vite-plugin\/[^'"]+['"]/,
  /from\s+['"]theokit\/router\/[^'"]+['"]/,
  /from\s+['"]theokit\/config\/[^'"]+['"]/,
]

function walk(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

describe('T1.3 — Pattern D6: barrel imports only', () => {
  it('should not deep-import from theokit/server/* or theokit/core/*', () => {
    const files = walk(SRC_DIR)
    const violations: { file: string; line: number; match: string }[] = []
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const pat of FORBIDDEN_PATTERNS) {
          if (pat.test(line)) {
            violations.push({ file, line: i + 1, match: line.trim() })
          }
        }
      })
    }
    expect(violations).toEqual([])
  })

  it('should allow barrel import from theokit/server (positive control)', () => {
    // This pattern MUST NOT trigger a violation
    const allowed = `import { defineRoute } from 'theokit/server'`
    const matches = FORBIDDEN_PATTERNS.some((p) => p.test(allowed))
    expect(matches).toBe(false)
  })
})
