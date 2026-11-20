/* eslint-disable sonarjs/no-os-command-from-path -- test fixture runs git and bash from PATH */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'

interface Step {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

const ci = parse(readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8')) as {
  jobs: Record<string, { steps: Step[] }>
}
const steps = ci.jobs['typecheck-build']!.steps
const buildIdx = steps.findIndex((s) => s.run === 'pnpm build:packages')
const gateIdx = steps.findIndex((s) => s.name?.startsWith('Public-surface gate'))
const typecheckIdx = steps.findIndex((s) => s.run === 'pnpm typecheck:only')
const gate = steps[gateIdx]!

describe('CI public-surface gate step: wiring', () => {
  it('runs after the build and before typecheck', () => {
    expect(buildIdx).toBeGreaterThan(-1)
    expect(gateIdx).toBe(buildIdx + 1)
    expect(typecheckIdx).toBeGreaterThan(gateIdx)
  })

  it('checks out full history so the merge commit has a merge base with the PR base', () => {
    expect(steps[0]!.uses).toContain('actions/checkout')
    expect(steps[0]!.with?.['fetch-depth']).toBe(0)
  })

  it('takes the base from the PR event and does not swallow failures', () => {
    expect(gate.env?.BASE_REF).toBe('${{ github.base_ref }}')
    expect(gate.run).toContain('set -euo pipefail')
    expect(gate.run).not.toMatch(/\|\|\s*(true|exit 0)/)
  })
})

describe('CI public-surface gate step: behaviour of the script', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  }
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, env, encoding: 'utf8' })

  /** An origin with `main` and a PR branch, cloned in full (what `fetch-depth: 0` yields). */
  function fixture(gateExit: number) {
    const root = mkdtempSync(join(tmpdir(), 'ci-gate-'))
    dirs.push(root)
    const origin = join(root, 'origin')
    mkdirSync(origin)
    git(origin, 'init', '-q', '-b', 'main')
    writeFileSync(join(origin, 'a'), '1')
    git(origin, 'add', '.')
    git(origin, 'commit', '-qm', 'base')
    git(origin, 'checkout', '-qb', 'pr')
    writeFileSync(join(origin, 'a'), '2')
    git(origin, 'commit', '-qam', 'change')
    git(origin, 'checkout', '-q', 'main')
    const work = join(root, 'work')
    git(root, 'clone', '-q', '--branch', 'pr', origin, work)
    mkdirSync(join(work, 'scripts'))
    // Stand-in for the gate: records its arguments, exits with the requested code.
    writeFileSync(
      join(work, 'scripts', 'check-public-surface.mjs'),
      `import { appendFileSync } from 'node:fs'
appendFileSync('calls.log', process.argv.slice(2).join(' ') + '\\n')
process.exit(${gateExit})
`,
    )
    return work
  }

  const run = (cwd: string, baseRef: string) =>
    spawnSync('bash', ['-c', gate.run!], {
      cwd,
      env: { ...env, BASE_REF: baseRef },
      encoding: 'utf8',
    })

  it('passes the PR base to the gate for both packages', () => {
    const work = fixture(0)
    const r = run(work, 'main')
    expect(r.status).toBe(0)
    expect(readFileSync(join(work, 'calls.log'), 'utf8').trim().split('\n')).toEqual([
      '@theokit/agents --base origin/main',
      'theokit --base origin/main',
    ])
  })

  it('fails the job when the gate reports a stable export break', () => {
    expect(run(fixture(1), 'main').status).not.toBe(0)
  })

  it('fails the job when the gate could not run (exit 2)', () => {
    expect(run(fixture(2), 'main').status).not.toBe(0)
  })

  it('fails when the PR base has no merge base with HEAD (shallow history)', () => {
    const work = fixture(0)
    git(work, 'checkout', '-q', '--orphan', 'island')
    git(work, 'commit', '-qm', 'unrelated', '--allow-empty')
    expect(run(work, 'main').status).not.toBe(0)
  })

  it('runs the gate without --base outside a pull request', () => {
    const work = fixture(0)
    expect(run(work, '').status).toBe(0)
    expect(readFileSync(join(work, 'calls.log'), 'utf8').trim().split('\n')).toEqual([
      '@theokit/agents',
      'theokit',
    ])
  })
})
