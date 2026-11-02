/**
 * The dependency gate's floor legs run on pull requests into `develop`, not only into `main`.
 *
 * `dep-check.yml` turned `run-floor-check` on only for `github.base_ref == 'main'`, so on every
 * `workspace -> develop` pull request the "suite at the bottom of every declared range" and "floors
 * the shared pin cannot reach" legs were SKIPPED (PR #978). A floor violation then merged into
 * `develop` and surfaced only on the release pull request: `@theokit/agents` imported `ToolContext`,
 * which `@theokit/sdk` exports only from 5.8.0, under a declared `^5.3.0` (caught on PR #976).
 *
 * The strand list (`run-impact-check`) and the tarball install stay on the release pull request,
 * where they can still change a publish decision.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

interface Workflow {
  jobs: Record<string, { with?: Record<string, string> }>
}

const WORKFLOW = parse(
  readFileSync(resolve(__dirname, '../../.github/workflows/dep-check.yml'), 'utf8'),
) as Workflow
const INPUTS = WORKFLOW.jobs['dep-check']?.with ?? {}

/**
 * Evaluate one of the workflow's `${{ ... }}` inputs for a given base branch, with `inputs.full`
 * false. Only the operators these inputs use (`==`, `||`, string literals) are understood; anything
 * else fails the test rather than being guessed at.
 */
function enabledFor(input: string, baseRef: string): boolean {
  const raw = INPUTS[input]
  if (raw === undefined) throw new Error(`dep-check.yml passes no ${input}`)
  const expr = raw.replace(/^\$\{\{\s*|\s*\}\}$/g, '')
  return expr.split('||').some((term) => {
    const t = term.trim()
    if (t === 'inputs.full == true') return false
    const m = /^github\.base_ref == '([^']*)'$/.exec(t)
    if (m === null) throw new Error(`unrecognised term in ${input}: ${t}`)
    return m[1] === baseRef
  })
}

describe('dep-check.yml floor legs', () => {
  it('test_the_floor_suite_runs_on_a_pull_request_into_develop', () => {
    expect(enabledFor('run-floor-check', 'develop')).toBe(true)
  })

  it('test_the_floor_suite_still_runs_on_a_pull_request_into_main', () => {
    expect(enabledFor('run-floor-check', 'main')).toBe(true)
  })

  it('test_a_push_runs_only_the_offline_check', () => {
    for (const input of ['run-floor-check', 'run-install-check', 'run-impact-check']) {
      expect(enabledFor(input, '')).toBe(false)
    }
  })

  it('test_the_strand_list_stays_on_the_release_pull_request', () => {
    expect(enabledFor('run-impact-check', 'develop')).toBe(false)
    expect(enabledFor('run-impact-check', 'main')).toBe(true)
  })
})
