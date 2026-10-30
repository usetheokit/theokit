import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { DEFAULT_LIVE_MODEL } from '../../scripts/live-model-preflight.mjs'

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
  needs?: string[]
  env?: Record<string, string>
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
    expect(RAW.match(/secrets\.OPENROUTER_API_KEY/g)).toHaveLength(4)
    const fromEnv = STEPS.filter((step) =>
      (step.env?.OPENROUTER_API_KEY ?? '').includes('secrets.OPENROUTER_API_KEY'),
    )
    expect(fromEnv).toHaveLength(4)
    for (const step of STEPS) expect(step.run ?? '').not.toContain('OPENROUTER_API_KEY')
  })

  it('leaves no git credential in the checkout', () => {
    const checkout = STEPS.find((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkout?.with?.['persist-credentials']).toBe(false)
  })

  it('runs the preflight before the build and the build before the suite', () => {
    const preflight = stepIndex('live-model-preflight.mjs')
    const build = stepIndex('live-model-build.mjs agents')
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

  // ADR-0021: a job that handles a credential pins every action by commit, never a moving tag
  // (loop-code-review #67).
  it('pins every action the key-bearing job uses to a 40-character commit', () => {
    const unpinned = STEPS.flatMap((s) => (s.uses === undefined ? [] : [s.uses])).filter(
      (uses) => !/@[0-9a-f]{40}$/.test(uses),
    )
    expect(unpinned).toEqual([])
    expect(RAW).not.toMatch(/ignore\[unpinned-uses\]/)
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
    expect(a2a).toBeGreaterThan(stepIndex('live-model-build.mjs agents'))
    const A2A_SUITE = STEPS[a2a] as Step
    expect(A2A_SUITE.env?.OPENROUTER_API_KEY).toContain('secrets.OPENROUTER_API_KEY')
    expect(A2A_SUITE.env?.THEOKIT_LIVE_REQUIRED).toBe('1')
    expect(A2A_SUITE.shell).toBe('bash')
    expect(A2A_SUITE.run?.trim()).toMatch(/2>&1 \| node scripts\/redact-key-shapes\.mjs$/)
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

  it('builds through the script in both live-model build steps, and no pnpm build line remains', () => {
    expect(STEPS.filter((step) => step.run?.includes('live-model-build.mjs'))).toHaveLength(2)
    expect(RAW).not.toMatch(/pnpm --filter .* build/)
  })

  it('points theoclaw test:live at its live tests, one file at a time', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../apps/theoclaw/package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['test:live']).toBe('vitest run tests/live --no-file-parallelism')
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

  // One job-level LIVE_MODEL feeds the preflight and both live steps, and its default is the
  // preflight's own DEFAULT_LIVE_MODEL, so the default is spelled once in the job and cannot drift
  // from the code (review F-arch-5, F-dom-1).
  it('feeds every step one model, defaulting to DEFAULT_LIVE_MODEL', () => {
    expect(JOB.env?.LIVE_MODEL).toBe(`\${{ vars.LIVE_MODEL || '${DEFAULT_LIVE_MODEL}' }}`)
    for (const step of STEPS) expect(step.env?.LIVE_MODEL).toBeUndefined()
    expect(RAW.split(DEFAULT_LIVE_MODEL)).toHaveLength(2)
  })
})

// B-659: the live-model build steps ran only after a merge to develop, so no pull request built
// what the live job builds. ci.yml's `live-model-build` job runs the same script on every pull
// request with no secret, and `ci-ok` waits on it.
const CI = parse(
  readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8'),
) as Workflow
const BUILD_JOB = CI.jobs['live-model-build']

describe('ci.yml live-model-build', () => {
  it('builds the live-model selectors on every pull request, with no secret and no live test', () => {
    expect(BUILD_JOB).toBeDefined()
    const node = JSON.stringify(BUILD_JOB)
    expect(node).not.toContain('secrets.')
    expect(node).not.toContain('test:live')
    expect(
      BUILD_JOB?.steps.some((step) => step.run?.trim() === 'node scripts/live-model-build.mjs'),
    ).toBe(true)
    expect(BUILD_JOB?.['timeout-minutes']).toBeLessThanOrEqual(10)
    const checkout = BUILD_JOB?.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkout?.with?.['persist-credentials']).toBe(false)
  })

  it('holds a merge through the CI aggregator', () => {
    expect(CI.jobs['ci-ok']?.needs).toContain('live-model-build')
  })
})

// B-659: the live-model build ran only after a merge to develop, so a selector that omitted
// TheoClaw (B-651, `theoclaw^...`) merged green. One script holds both selectors; these cases run
// it, so the TheoClaw selector is checked by what pnpm selects, not by how it is spelled.
const REPO_ROOT = resolve(__dirname, '../..')
const BUILD_SCRIPT = join(REPO_ROOT, 'scripts/live-model-build.mjs')
const SCRATCH_DIRS: string[] = []

function runBuildScript(
  args: string[],
  options: { script?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return spawnSync(process.execPath, [options.script ?? BUILD_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: options.env ?? process.env,
  })
}

/**
 * A copy of the script in an empty directory, so its repository root has no `apps/theoclaw/dist`,
 * and a fake `pnpm` first on PATH that logs its arguments and runs `onAgents` (a shell command) for the agents
 * selector, 0 otherwise.
 */
function scratchCopy(onAgents = 'exit 0') {
  const dir = mkdtempSync(join(tmpdir(), 'live-model-build-'))
  SCRATCH_DIRS.push(dir)
  mkdirSync(join(dir, 'scripts'))
  mkdirSync(join(dir, 'bin'))
  const script = join(dir, 'scripts', 'live-model-build.mjs')
  copyFileSync(BUILD_SCRIPT, script)
  const calls = join(dir, 'calls.log')
  const fakePnpm = join(dir, 'bin', 'pnpm')
  writeFileSync(
    fakePnpm,
    `#!/bin/sh\necho "$*" >> '${calls}'\ncase "$*" in *@theokit/agents...*) ${onAgents};; esac\nexit 0\n`,
  )
  chmodSync(fakePnpm, 0o755)
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH ?? ''}` }
  return { script, calls, env }
}

describe('scripts/live-model-build.mjs', () => {
  afterEach(() => {
    for (const dir of SCRATCH_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('the TheoClaw selector the build script uses selects the theoclaw project', () => {
    const printed = runBuildScript(['--print-selector', 'theoclaw'])
    expect(printed.status, printed.stderr).toBe(0)
    const selector = printed.stdout.trim()
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- toolchain binary, fixed argv
    const listed = spawnSync('pnpm', ['--filter', selector, 'ls', '--depth', '-1', '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, NO_UPDATE_NOTIFIER: '1', CI: '1' },
    })
    expect(listed.status, `pnpm ls for ${selector}: ${listed.stderr}`).toBe(0)
    const names = (JSON.parse(listed.stdout) as { name: string }[]).map((pkg) => pkg.name)
    expect(names, `the TheoClaw build selector ${selector}`).toContain('theoclaw')
  }, 30_000)

  it('the build script refuses an unknown target, naming it', () => {
    const result = runBuildScript(['nope'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('unknown argument nope')
  })

  it('the build script refuses --print-selector with no target', () => {
    const result = runBuildScript(['--print-selector'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('unknown argument --print-selector')
  })

  it('the build script refuses more than one target', () => {
    const result = runBuildScript(['agents', 'theoclaw'])
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('unknown argument theoclaw')
  })

  it('the build script fails naming the selector when its build tool is missing', () => {
    const result = runBuildScript(['agents'], { env: { ...process.env, PATH: '/nonexistent' } })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('@theokit/agents...')
  })

  it('the build script fails naming the entry when the TheoClaw build leaves no main.js', () => {
    const { script, calls, env } = scratchCopy()
    const result = runBuildScript(['theoclaw'], { script, env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('apps/theoclaw/dist/main.js is missing')
    expect(readFileSync(calls, 'utf8')).toContain('--filter theoclaw... build')
  })

  it('a failed agents build stops the script before the TheoClaw build', () => {
    const { script, calls, env } = scratchCopy('exit 3')
    const result = runBuildScript([], { script, env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('@theokit/agents...')
    expect(result.stderr).toContain('status 3')
    expect(existsSync(calls), 'the fake pnpm was called').toBe(true)
    expect(readFileSync(calls, 'utf8')).not.toContain('theoclaw...')
  })

  it('a build killed by a signal fails naming the selector and the signal', () => {
    const { script, env } = scratchCopy('kill -TERM $$')
    const result = runBuildScript(['agents'], { script, env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('building @theokit/agents... failed with signal SIGTERM')
  })
})
