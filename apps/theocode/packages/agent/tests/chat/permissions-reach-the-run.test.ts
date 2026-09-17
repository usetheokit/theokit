import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { settingsReport } from '../../src/config/settings-load.js'
import { createPermissionsPlugin } from '@theokit/agents'

/**
 * #736 — the last joint: a `permissions` block on disk becomes a plugin the run enforces.
 *
 * Every piece existed and none of them touched. `translateSettings` rendered the block into
 * `PermissionRule[]`; `reportOne` discarded the result; `chat.ts` composed an agent with no policy.
 * `settings-json.ts` described the gap in its own words — closing it "needs a seam in
 * `@theokit/agents`" — and that seam is `createPermissionsPlugin`.
 *
 * Measured 2026-09-17 beside Claude Code on byte-identical configuration: it refused a
 * `Read(./off-limits.txt)` deny rule; this product answered with the file's contents.
 *
 * This asserts the CHAIN, not the engine: the engine is the SDK's and has its own tests. What was
 * missing was that nothing connected the file to it.
 */
const roots: string[] = []
afterEach(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots.length = 0
})

function workspace(settings: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'theocode-perm-'))
  roots.push(dir)
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings))
  return dir
}

describe('a permissions block reaches the run', () => {
  it('test_a_deny_rule_becomes_a_plugin', () => {
    const cwd = workspace({ permissions: { deny: ['Read(./off-limits.txt)'] } })

    const rules = settingsReport({ projectDir: cwd, userDir: cwd }).flatMap((r) => r.permissionRules)

    // The rule survives the report — this is the half that was being dropped.
    expect(rules.map((r) => r.tool), 'the deny rule did not survive the report').toContain('Read')
    // And becomes something the run can carry.
    expect(createPermissionsPlugin(rules, { onAsk: () => ({ behavior: 'allow' }) })).toBeDefined()
  })

  it('test_the_tool_name_is_the_one_this_product_registers', () => {
    // The rename is what makes the rule addressable at all: `translate` passes the tool name straight
    // through, so `Bash(...)` can only ever match a tool named `Bash`. Before 2026-09-17 this product
    // called it `run_shell`, and the rule addressed nothing.
    const cwd = workspace({ permissions: { deny: ['Bash(rm:*)'] } })

    const rules = settingsReport({ projectDir: cwd, userDir: cwd }).flatMap((r) => r.permissionRules)

    expect(rules.map((r) => r.tool)).toContain('Bash')
  })

  it('test_no_permissions_block_means_no_plugin', () => {
    // The control that keeps "no policy" distinguishable from "a policy that allows everything".
    const cwd = workspace({ model: 'openai/x' })

    const rules = settingsReport({ projectDir: cwd, userDir: cwd }).flatMap((r) => r.permissionRules)

    expect(rules).toEqual([])
    expect(createPermissionsPlugin(rules, { onAsk: () => ({ behavior: 'allow' }) })).toBeUndefined()
  })
})
