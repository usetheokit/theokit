/**
 * `doctor` names the foreign-root surfaces it loads, instead of being silent about them.
 *
 * MEASURED 2026-09-15 in this repository: `.claude/agents/` held 139 files, `.claude/commands/` 5,
 * `.claude/agent-memory/` 1 and `.claude/workflows/` 1, and a grep of the whole report for
 * `agent-memory`, `workflow`, `subagent` and `command` returned nothing. Fourteen checks ran and
 * none of them was about the 139 agent definitions this product loads.
 *
 * The positive control is what made that interpretable rather than a guess about intent:
 * `skills-on-disk` IS reported — "91 under .claude/skills/, loaded by the compatibility dialect
 * without a config line". The report can speak about a foreign-root surface and does, so these were
 * four missing checks and not a principle that diagnostics stay inside the native root.
 *
 * ## Why ONE row and not four
 *
 * The operator's question is one question — what under `.claude/` does this product act on — and
 * four rows answer it four times while making the reader assemble the total. The parsimony ladder
 * stops at the first rung that resolves the need, and one row does.
 *
 * ## What the row must NOT flatten
 *
 * `workflows` is REFUSED and the other three are READ. A row that printed four counts side by side
 * would report a refusal as though it were a capability, which is the accepted-and-ignored failure
 * the surfaces rule exists to prevent — arriving through the diagnostic instead of through the
 * loader. So the state travels with the count, per surface.
 */
import { describe, expect, it } from 'vitest'

import { collectChecks } from '../../src/doctor/doctor.js'

const base = {
  cwd: '/tmp/p',
  trustLevel: 'trusted',
  model: 'openai/gpt-5',
  effort: 'medium',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  credential: 'present' as const,
  wired: {
    mcp: { active: [], suppressedByTrust: false },
    skills: { active: [], suppressedByTrust: false },
    hooks: { active: [], suppressedByTrust: false },
  },
}

const row = (checks: readonly { name: string; detail?: string }[]): string | undefined =>
  checks.find((c) => c.name === 'foreign-surfaces')?.detail

describe('the foreign-root surfaces reach the report', () => {
  it('test_a_loaded_surface_is_named_with_its_count', () => {
    const detail = row(
      collectChecks({ ...base, foreignSurfaces: [{ dir: 'agents', files: 139, state: 'read' }] }),
    )
    expect(detail).toContain('agents')
    expect(detail).toContain('139')
  })

  it('test_a_refused_surface_is_not_reported_as_a_capability', () => {
    const detail = row(
      collectChecks({
        ...base,
        foreignSurfaces: [
          { dir: 'agents', files: 139, state: 'read' },
          { dir: 'workflows', files: 1, state: 'refused' },
        ],
      }),
    )
    // The distinction is the point: a reader must be able to tell the 139 that reach the model from
    // the 1 that never will, without opening a second document.
    expect(detail).toMatch(/workflows[^·]*refused|refused[^·]*workflows/)
  })

  it('test_a_caller_that_did_not_look_says_nothing', () => {
    // The convention every optional input in this module follows: absent means unmeasured, never
    // "measured and empty". Asserting a clean install from a caller that never looked is the
    // fabrication the whole report exists to avoid.
    expect(row(collectChecks(base))).toBeUndefined()
  })

  it('test_an_empty_surface_produces_no_row', () => {
    expect(row(collectChecks({ ...base, foreignSurfaces: [] }))).toBeUndefined()
  })

  it('test_the_row_warns_rather_than_fails', () => {
    // Nothing is broken by a surface being present: exiting non-zero here would report a working
    // install as broken, which is the reasoning `skills-on-disk` and `hooks-not-run` already follow.
    const checks = collectChecks({
      ...base,
      foreignSurfaces: [{ dir: 'agents', files: 139, state: 'read' }],
    })
    expect(checks.find((c) => c.name === 'foreign-surfaces')?.status).toBe('warn')
    expect(checks.filter((c) => c.status === 'fail')).toHaveLength(0)
  })
})
