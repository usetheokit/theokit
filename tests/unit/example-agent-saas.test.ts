/**
 * M4 (theokit-ai-first) — structural test for the `examples/agent-saas` harness vehicle (DoD-3).
 *
 * The example is a pattern reference (no build); its behavior is proven by the deterministic E2E in
 * packages/agents/tests/integration/hitl-harness.test.ts. This test asserts the example actually
 * WIRES the harness — a HITL-gated tool + @Checkpoint on the agent, and a page that consumes it and
 * POSTs approvals — so the example can never silently drift from the shipped surface.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const AGENT = 'examples/agent-saas/agents/ops.ts'
const PAGE = 'examples/agent-saas/app/page.tsx'

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('examples/agent-saas — harness wiring (M4 / DoD-3)', () => {
  it('test_example_files_exist', () => {
    expect(existsSync(join(ROOT, AGENT))).toBe(true)
    expect(existsSync(join(ROOT, PAGE))).toBe(true)
    expect(existsSync(join(ROOT, 'examples/agent-saas/README.md'))).toBe(true)
  })

  it('test_agent_declares_a_hitl_gated_tool_and_checkpoint', () => {
    const src = read(AGENT)
    expect(src).toContain('@HumanInTheLoop(')
    expect(src).toContain('@Checkpoint(')
    // The gated tool must be associated with the agent (@Mixin) or the endpoint never sees it.
    expect(src).toContain('@Mixin(')
    // Imports the real harness decorators from the package (not fabricated).
    expect(src).toContain("from '@theokit/agents'")
  })

  it('test_page_consumes_useAgent_and_posts_the_approval', () => {
    const src = read(PAGE)
    expect(src).toContain('useAgent(')
    // The approval round-trip targets the real approve route.
    expect(src).toContain('/api/agents/ops/approve/')
    expect(src).toContain('tool-approval-request')
  })
})
