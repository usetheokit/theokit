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

// Moved unchanged out of `the-live-model-workflow-runs-on-develop.test.ts` by B-374 (size budget).
interface CiJob {
  'timeout-minutes'?: number
  needs?: string[]
  steps: { uses?: string; run?: string; with?: Record<string, unknown> }[]
}

// B-659: the live-model build steps ran only after a merge to develop, so no pull request built
// what the live job builds. ci.yml's `live-model-build` job runs the same script on every pull
// request with no secret, and `ci-ok` waits on it.
const CI = parse(readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')) as {
  jobs: Record<string, CiJob>
}
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
 * selector, `onTheoclaw` for the TheoClaw selector and `onWeb` for TheoClaw's build:web, 0 otherwise.
 */
function scratchCopy(onAgents = 'exit 0', onTheoclaw = 'true', onWeb = 'true') {
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
    `#!/bin/sh\necho "$*" >> '${calls}'\ncase "$*" in *@theokit/agents...*) ${onAgents};; *theoclaw...*) ${onTheoclaw};; *build:web*) ${onWeb};; esac\nexit 0\n`,
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

  it('with no target the build script builds agents, TheoClaw, then the WebChat page, and exits 0 when both outputs exist', () => {
    const { script, calls, env } = scratchCopy(
      'exit 0',
      'mkdir -p apps/theoclaw/dist && touch apps/theoclaw/dist/main.js',
      'mkdir -p apps/theoclaw/dist/web/assets && touch apps/theoclaw/dist/web/assets/app.js',
    )
    const result = runBuildScript([], { script, env })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual([
      '--filter @theokit/agents... build',
      '--filter theoclaw... build',
      '--filter theoclaw run build:web',
    ])
  })

  // gateway-webchat review F-tests-1 / F-wire-1: tests/live/webchat.live.test.ts asserts GET /webchat
  // is 200, which needs the page bundle; without build:web the live job answered 503 on every run.
  it('the build script fails naming the WebChat bundle when build:web leaves no app.js', () => {
    const { script, calls, env } = scratchCopy(
      'exit 0',
      'mkdir -p apps/theoclaw/dist && touch apps/theoclaw/dist/main.js',
    )
    const result = runBuildScript(['theoclaw'], { script, env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('apps/theoclaw/dist/web/assets/app.js is missing')
    expect(readFileSync(calls, 'utf8')).toContain('--filter theoclaw run build:web')
  })

  it('a failed build:web fails naming the WebChat build', () => {
    const { script, env } = scratchCopy(
      'exit 0',
      'mkdir -p apps/theoclaw/dist && touch apps/theoclaw/dist/main.js',
      'exit 4',
    )
    const result = runBuildScript(['theoclaw'], { script, env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('building the WebChat page (build:web) failed with status 4')
  })

  it('a build killed by a signal fails naming the selector and the signal', () => {
    const { script, env } = scratchCopy('kill -TERM $$')
    const result = runBuildScript(['agents'], { script, env })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('building @theokit/agents... failed with signal SIGTERM')
  })
})
