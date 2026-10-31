import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * The TheoClaw steps of `live-model.yml` (moved out of `the-live-model-workflow-runs-on-develop.test.ts`
 * by B-374 to keep both files under the size budget): the live tests run with the flag, the model and
 * the key, and the container checks are reached only through a container dispatch.
 */
interface Step {
  name?: string
  uses?: string
  run?: string
  shell?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

interface Job {
  'timeout-minutes'?: number
  needs?: string[]
  env?: Record<string, string>
  if?: string
  uses?: string
  secrets?: unknown
  steps: Step[]
}

interface Workflow {
  on: Record<string, unknown>
  permissions: unknown
  jobs: Record<string, Job>
}

const RAW = readFileSync(resolve(__dirname, '../../.github/workflows/live-model.yml'), 'utf8')
const WORKFLOW = parse(RAW) as Workflow
const JOB = WORKFLOW.jobs['live-model'] as Job
const STEPS = JOB.steps

function stepIndex(fragment: string): number {
  const index = STEPS.findIndex((step) => step.run?.includes(fragment) ?? false)
  expect(index, `a step whose run contains ${fragment}`).toBeGreaterThanOrEqual(0)
  return index
}

describe('live-model.yml for TheoClaw', () => {
  // B-374 (T5.2): GitHub dispatches only a workflow on the default branch, so the container checks
  // are reached through this file's dispatch, with a suite input that push leaves empty.
  it('the live-model workflow calls the container workflow only on a container dispatch', () => {
    const container = WORKFLOW.jobs['theoclaw-container'] as Job
    expect(container.uses).toBe('./.github/workflows/theoclaw-container.yml')
    expect(container.secrets).toBe('inherit')
    expect(container.if).toBe(
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'theoclaw-container'",
    )
    expect(JOB.if).toBe("inputs.suite != 'theoclaw-container'")
    const dispatch = WORKFLOW.on.workflow_dispatch as {
      inputs: { suite: { type: string; default: string; options: string[] } }
    }
    expect(dispatch.inputs.suite.type).toBe('choice')
    expect(dispatch.inputs.suite.default).toBe('live-model')
    expect(dispatch.inputs.suite.options).toEqual(['live-model', 'theoclaw-container'])
  })

  // S-004 loop-test-audit (TP-D2-skipped): apps/theoclaw/tests/live/*.live.test.ts skip unless
  // THEOCLAW_LIVE=1, and no job set it, so they skipped green on every push. This step sets it,
  // with the model and the key, so a missing one fails by name instead of skipping.
  // F-dom-1 / F-wire-4 (B-651): `theoclaw^...` selects only TheoClaw's dependencies, so
  // apps/theoclaw/dist/main.js, which control-plane and instance-profiles spawn, was never built.
  // `theoclaw...` selects TheoClaw and its dependencies; the build script's case below checks that
  // by what pnpm selects (B-659).
  it('runs the TheoClaw live tests with THEOCLAW_LIVE=1, after TheoClaw itself is built', () => {
    const theoclaw = stepIndex('--filter theoclaw test:live')
    const build = stepIndex('live-model-build.mjs theoclaw')
    expect(theoclaw).toBeGreaterThan(build)
    expect(STEPS[build]?.run?.trim()).toBe('node scripts/live-model-build.mjs theoclaw')
    const LIVE_STEP = STEPS[theoclaw] as Step
    expect(LIVE_STEP.env?.THEOCLAW_LIVE).toBe('1')
    expect(LIVE_STEP.env?.THEOCLAW_HOST_TOOLS).toBe('on')
    expect(LIVE_STEP.env?.THEOCLAW_MODEL).toBe('${{ env.LIVE_MODEL }}')
    expect(LIVE_STEP.env?.OPENROUTER_API_KEY).toContain('secrets.OPENROUTER_API_KEY')
    expect(LIVE_STEP.shell).toBe('bash')
    expect(LIVE_STEP.run?.trim()).toMatch(/2>&1 \| node scripts\/redact-key-shapes\.mjs$/)
  })

  it('points theoclaw test:live at its live tests, one file at a time', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../apps/theoclaw/package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['test:live']).toBe('vitest run tests/live --no-file-parallelism')
  })
})
