import { describe, it, expect } from 'vitest'
import { statSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Bundle size regression', () => {
  const distDir = resolve(__dirname, '../../dist')

  /**
   * ## Raised from 35_000 to 36_500 in M80 — measured, not convenient
   *
   * Reparenting eleven error classes onto `TheokitAgentError` cost **751 bytes**, measured by
   * building the barrel with and without the change (34 732 → 35 483). Those bytes are the
   * `code` and `isRetryable` literals: they ARE the milestone, and removing them would undo the
   * fix — the classes go back to being invisible to `isTransientError`, and the consumer goes back
   * to a regex over an eight-level `cause` chain.
   *
   * The alternative considered and rejected: move `capability/` out of the main barrel to make room.
   * It sits there by a decision recorded in M56, and shuffling an unrelated module to fit a ceiling
   * would be paying for this change with someone else's design.
   *
   * The new ceiling is 36 500 — the measured 35 483 plus about a kilobyte of headroom, stated so the
   * next milestone that adds barrel surface still meets a guard rather than a formality.
   */
  it('agents main bundle under 36.5KB', () => {
    const path = resolve(distDir, 'index.js')
    if (!existsSync(path)) {
      console.log('  SKIP: dist/index.js not found (run pnpm build first)')
      return
    }
    const size = statSync(path).size
    expect(size).toBeLessThan(36_500)
    console.log(`  agents/dist/index.js: ${(size / 1024).toFixed(1)} KB`)
  })

  it('agents decorators sub-path under 15KB', () => {
    const path = resolve(distDir, 'decorators.js')
    if (!existsSync(path)) {
      console.log('  SKIP: dist/decorators.js not found')
      return
    }
    const size = statSync(path).size
    expect(size).toBeLessThan(15_000)
    console.log(`  agents/dist/decorators.js: ${(size / 1024).toFixed(1)} KB`)
  })

  it('agents bridge sub-path under 20KB', () => {
    const path = resolve(distDir, 'bridge.js')
    if (!existsSync(path)) {
      console.log('  SKIP: dist/bridge.js not found')
      return
    }
    const size = statSync(path).size
    expect(size).toBeLessThan(20_000)
    console.log(`  agents/dist/bridge.js: ${(size / 1024).toFixed(1)} KB`)
  })
})
