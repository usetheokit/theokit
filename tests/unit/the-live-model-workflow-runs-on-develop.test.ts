import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * No CI job reached a model: 0 of 12 workflows triggered on push to `develop`, and the live suite
 * skipped green with no key (B-415, OBJ-9). `live-model.yml` is that job. Each case below pins
 * one property whose regression would bring back a silent pass, a dropped push or a leaked key.
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
  steps: Step[]
}

interface Workflow {
  on: Record<string, unknown>
  permissions: unknown
  jobs: Record<string, Job>
}

const PATH = resolve(__dirname, '../../.github/workflows/live-model.yml')
const RAW = readFileSync(PATH, 'utf8')
const WORKFLOW = parse(RAW) as Workflow
const JOBS = Object.values(WORKFLOW.jobs)
const JOB = JOBS[0] as Job
const STEPS = JOB.steps

function stepIndex(fragment: string): number {
  const index = STEPS.findIndex((step) => step.run?.includes(fragment) ?? false)
  expect(index, `a step whose run contains ${fragment}`).toBeGreaterThanOrEqual(0)
  return index
}

const PREFLIGHT = STEPS[stepIndex('live-model-preflight.mjs')] as Step
const SUITE = STEPS[stepIndex('@theokit/agents test:live')] as Step

const THEOCODE = resolve(__dirname, '../../apps/theocode')
const A2A_LIVE_TEST = 'packages/agent/tests/live/an-a2a-call-reaches-a-real-model.test.ts'

describe('live-model.yml', () => {
  it('runs on push to develop and on dispatch, and on no other trigger', () => {
    expect(Object.keys(WORKFLOW.on).sort((a, b) => a.localeCompare(b))).toEqual([
      'push',
      'workflow_dispatch',
    ])
    expect((WORKFLOW.on.push as { branches: string[] }).branches).toEqual(['develop'])
  })

  it('grants only contents read', () => {
    expect(WORKFLOW.permissions).toEqual({ contents: 'read' })
  })

  it('stops the job after 10 minutes', () => {
    expect(JOBS).toHaveLength(1)
    expect(JOB['timeout-minutes']).toBe(10)
  })

  it('hands the key only through step env and never names it in a run line', () => {
    expect(RAW.match(/secrets\.OPENROUTER_API_KEY/g)).toHaveLength(3)
    const fromEnv = STEPS.filter((step) =>
      (step.env?.OPENROUTER_API_KEY ?? '').includes('secrets.OPENROUTER_API_KEY'),
    )
    expect(fromEnv).toHaveLength(3)
    for (const step of STEPS) expect(step.run ?? '').not.toContain('OPENROUTER_API_KEY')
  })

  it('leaves no git credential in the checkout', () => {
    const checkout = STEPS.find((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkout?.with?.['persist-credentials']).toBe(false)
  })

  it('runs the preflight before the build and the build before the suite', () => {
    const preflight = stepIndex('live-model-preflight.mjs')
    const build = stepIndex('pnpm --filter "@theokit/agents..." build')
    const suite = stepIndex('test:live')
    expect(preflight).toBeLessThan(build)
    expect(build).toBeLessThan(suite)
  })

  it('requires the key in the suite step', () => {
    expect(SUITE.env?.THEOKIT_LIVE_REQUIRED).toBe('1')
  })

  it('swallows no test failure', () => {
    for (const step of STEPS) expect(step.run ?? '').not.toMatch(/\|\|\s*(true|exit\s+0)\b/)
  })

  it('gives every push its own run, so no pending push is cancelled', () => {
    expect('concurrency' in WORKFLOW).toBe(false)
    expect('concurrency' in JOB).toBe(false)
  })

  it('pipes the suite output through the key-shape redactor under pipefail', () => {
    expect(SUITE.shell).toBe('bash')
    expect(SUITE.run?.trim()).toMatch(/2>&1 \| node scripts\/redact-key-shapes\.mjs$/)
  })

  // F-2f1674cd (B-407): the A2A real-model test ran only under `pnpm --filter theocode test` in
  // ci.yml, which holds no provider key, so it skipped green on every push.
  it('runs the A2A real-model test after the build, with the key required and redacted', () => {
    const a2a = stepIndex('--filter theocode test:live')
    expect(a2a).toBeGreaterThan(stepIndex('pnpm --filter "@theokit/agents..." build'))
    const A2A_SUITE = STEPS[a2a] as Step
    expect(A2A_SUITE.env?.OPENROUTER_API_KEY).toContain('secrets.OPENROUTER_API_KEY')
    expect(A2A_SUITE.env?.THEOKIT_LIVE_REQUIRED).toBe('1')
    expect(A2A_SUITE.env?.LIVE_MODEL).toBe(SUITE.env?.LIVE_MODEL)
    expect(A2A_SUITE.shell).toBe('bash')
    expect(A2A_SUITE.run?.trim()).toMatch(/2>&1 \| node scripts\/redact-key-shapes\.mjs$/)
  })

  it('points theocode test:live at the A2A live test behind the provider-key guard', async () => {
    const pkg = JSON.parse(readFileSync(resolve(THEOCODE, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['test:live']).toBe('vitest run --config vitest.live.config.ts')
    const configPath = resolve(THEOCODE, 'vitest.live.config.ts')
    expect(existsSync(configPath), configPath).toBe(true)
    const { default: LIVE_A2A_CONFIG } = (await import(configPath)) as {
      default: { test?: { include?: string[]; globalSetup?: string[] } }
    }
    expect(LIVE_A2A_CONFIG.test?.include).toEqual([A2A_LIVE_TEST])
    expect(existsSync(resolve(THEOCODE, A2A_LIVE_TEST))).toBe(true)
    expect(LIVE_A2A_CONFIG.test?.globalSetup).toEqual(['tools/require-provider-key.mjs'])
  })

  it('feeds the same model to the preflight and the suite', () => {
    expect(PREFLIGHT.env?.LIVE_MODEL).toBe(SUITE.env?.LIVE_MODEL)
    expect(SUITE.env?.LIVE_MODEL).toContain('vars.LIVE_MODEL')
    expect(SUITE.env?.LIVE_MODEL).toContain('google/gemini-2.5-flash-lite')
  })
})
