import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const srcDir = path.resolve(import.meta.dirname, '../../packages/theo/src')

/**
 * Count matching lines under `srcDir`.
 *
 * This used to shell out to `grep ... | wc -l`. The pipe forced a shell, the shell parsed an
 * absolute path built from wherever the repository sits, and dropping the shell only moved the
 * problem to `PATH` resolving the name `grep`. A walk needs neither, and an audit that reads the
 * tree in-process cannot be told a different story by the environment it runs in.
 */
function grepCount(pattern: string): number {
  const re = new RegExp(pattern)
  let count = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!full.endsWith('.ts')) continue
      for (const line of readFileSync(full, 'utf-8').split('\n')) {
        if (re.test(line)) count += 1
      }
    }
  }
  walk(srcDir)
  return count
}

describe('Any Audit — Zero any in production code', () => {
  it('should have zero ": any" type annotations', () => {
    const count = grepCount(': any[^a-zA-Z]')
    expect(count).toBe(0)
  })

  it('should have zero "as any" type assertions', () => {
    const count = grepCount('as any')
    expect(count).toBe(0)
  })

  it('should have zero @ts-ignore directives', () => {
    const count = grepCount('@ts-ignore')
    expect(count).toBe(0)
  })

  it('should have zero @ts-expect-error in production code', () => {
    const count = grepCount('@ts-expect-error')
    expect(count).toBe(0)
  })
})
