/**
 * #91 — a truncated rules block says so where somebody can act on it.
 *
 * The defect: a project whose rules exceed the ceiling runs on a fraction of them, and the only
 * notice is a `stderr` line. Under the TUI, stderr is a log nobody has open — the identical failure
 * `chat.ts` documents for MCP warnings one surface over, where `/mcp` cheerfully listed the servers
 * that DID load while the ignored one was invisible.
 *
 * Measured on this repository at v0.7.0: 248,669 chars of rules against a 64,000 ceiling — 74%
 * dropped, silently, in the product's own checkout.
 *
 * `count` already meant "blocks that CONTRIBUTED", so the loader always knew. What it did not do
 * was report the OTHER half — how much was read — and a contributing count with nothing to compare
 * it against cannot distinguish a complete load from a quarter of one.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadRules } from '../../src/context/rules.js'
import { tempRoot } from '../helpers/temp-root.js'

const project = (blocks: readonly string[]): string => {
  const cwd = tempRoot('rules-trunc-')
  const dir = join(cwd, '.theokit', 'rules')
  mkdirSync(dir, { recursive: true })
  blocks.forEach((body, i) => writeFileSync(join(dir, `r${String(i).padStart(3, '0')}.md`), body))
  return cwd
}

const silent = (): void => {}

describe('#91 — the loader reports what it dropped', () => {
  it('test_a_small_project_reports_everything_it_read', () => {
    // Positive control. Without it, a `read === count` assertion below could be satisfied by a
    // loader that reads nothing at all and reports 0 === 0.
    const loaded = loadRules(project(['# one\n\nalpha\n', '# two\n\nbeta\n']), silent)
    expect(loaded.read).toBe(2)
    expect(loaded.count).toBe(2)
    expect(loaded.truncated).toBe(false)
  })

  it('test_a_project_over_the_ceiling_reports_both_halves', () => {
    // The defect, stated as numbers a surface can print. `count` alone was already available and
    // was not enough: 12 means nothing without the 47 it is out of.
    const big = Array.from({ length: 40 }, (_, i) => `# r${i}\n\n${'x'.repeat(4000)}\n`)
    const loaded = loadRules(project(big), silent)

    expect(loaded.truncated, 'a 160KB rules directory fitted under a 64KB ceiling').toBe(true)
    expect(loaded.read).toBe(40)
    expect(loaded.count).toBeLessThan(loaded.read)
    expect(loaded.chars).toBeGreaterThan(loaded.text.length)
  })

  it('test_the_reported_length_is_the_one_before_the_slice', () => {
    // `chars` must be what WOULD have been in the prompt, not what is. Reporting the kept length
    // would make the row self-congratulatory: "64,000 chars" with nothing saying 184,669 were cut.
    const big = Array.from({ length: 40 }, (_, i) => `# r${i}\n\n${'x'.repeat(4000)}\n`)
    const loaded = loadRules(project(big), silent)

    expect(loaded.chars).toBeGreaterThan(150_000)
    expect(loaded.text.length).toBeLessThanOrEqual(64_000)
  })

  it('test_a_project_with_no_rules_is_not_reported_as_truncated', () => {
    // Anti-vacuity in the other direction: `truncated` hard-coded to `true` would satisfy the arms
    // above, and an empty project is where that shows.
    const loaded = loadRules(project([]), silent)
    expect(loaded.truncated).toBe(false)
    expect(loaded.read).toBe(0)
    expect(loaded.chars).toBe(0)
  })
})
