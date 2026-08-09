/**
 * M79 T2.1 — the CLI is on the 4.x line of `@theokit/agents`, and the reason saying otherwise died.
 *
 * ## The premise this test buries
 *
 * agent-builder's dedup guard (`agents/lib/hooks/hooks-wiring.test.ts:123-124`) claimed the second
 * copy of `@theokit/agents` was *"unavoidable"* because this CLI was
 * *"still pinned to `@theokit/agents@0.44.x` — **it uses the `agent()` free function M57 removed**"*.
 *
 * That stopped being true at some point between M57 and today, and nobody noticed: the comment
 * stayed, and with it a whole architectural debt — two majors of the same package in one process,
 * plus an eight-entry allowlist to fence it in. The ROADMAP itself inherited the premise, writing
 * that "bumping the CLI is a major change with consumers outside this repository".
 *
 * `rules/adr-governance.md § 5` enumerates exactly this class as **not mechanized**: *"a comment
 * whose prose no longer describes the code"*. Here it did not merely describe itself wrongly — it
 * sustained the reason not to fix.
 *
 * This test is the oracle that was missing: if somebody reintroduces the free function, it fails, and
 * the claim becomes true again **with proof** rather than by inertia.
 */
import { readFileSync } from 'node:fs'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../../packages/theo', import.meta.url).pathname

function tsFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const filePath = join(dir, entry)
    if (statSync(filePath).isDirectory()) tsFiles(filePath, acc)
    else if (filePath.endsWith('.ts') && !filePath.endsWith('.test.ts')) acc.push(filePath)
  }
  return acc
}

describe('M79 T2.1 — the CLI on the 4.x line', () => {
  it('test_the_CLI_declares_agents_via_the_workspace_and_not_via_an_old_pin', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf-8')) as {
      dependencies: Record<string, string>
    }
    const decl = pkg.dependencies['@theokit/agents']

    // `workspace:^` resolves to the monorepo version (4.x). A literal `^0.44.x` pin would reintroduce
    // the four-major skew this milestone eliminated.
    expect(
      decl,
      '`@theokit/agents` must come from the workspace, not from an old published pin',
    ).toBe('workspace:^')
  })

  it('test_the_CLI_does_NOT_use_the_free_function_agent_removed_in_M57', () => {
    // The truthfulness gate. The claim "the CLI uses `agent()`" sustained the debt for several
    // milestones with nothing verifying it. Now it has an oracle.
    const useSites: string[] = []
    for (const file of tsFiles(join(packageRoot, 'src'))) {
      const source = readFileSync(file, 'utf-8')
      // A named import of the free function from the barrel — the shape the removed one had.
      if (/import\s*\{[^}]*\bagent\b[^}]*\}\s*from\s*['"]@theokit\/agents['"]/.test(source)) {
        useSites.push(file)
      }
    }

    expect(
      useSites,
      `Files importing the free function \`agent()\`: ${useSites.join(', ')}. ` +
        'It was removed in M57; using it would pin the CLI to the 0.44.x line and recreate the two copies.',
    ).toEqual([])
  })

  it('test_COUNTERPROOF_the_CLI_actually_IMPORTS_from_the_agents_barrel', () => {
    // Without this, deleting every use of `@theokit/agents` from the CLI would pass the test above —
    // and "it does not use the free function" would be true by vacuity, not by correctness.
    const importers = tsFiles(join(packageRoot, 'src')).filter((a) =>
      /from\s*['"]@theokit\/agents['"]/.test(readFileSync(a, 'utf-8')),
    )
    expect(importers.length, 'the CLI must keep consuming the barrel').toBeGreaterThan(0)
  })
})
