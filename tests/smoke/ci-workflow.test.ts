import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

const rootDir = resolve(__dirname, '../..')

function loadWorkflow(name: string) {
  const path = resolve(rootDir, `.github/workflows/${name}`)
  const content = readFileSync(path, 'utf-8')
  return parse(content)
}

describe('CI Workflow', () => {
  const ciPath = resolve(rootDir, '.github/workflows/ci.yml')

  it('should exist', () => {
    expect(existsSync(ciPath)).toBe(true)
  })

  it('should be valid YAML', () => {
    const workflow = loadWorkflow('ci.yml')
    expect(workflow).toBeDefined()
    expect(workflow.name).toBe('CI')
  })

  it('should trigger on push and PR to main', () => {
    const workflow = loadWorkflow('ci.yml')
    expect(workflow.on.push.branches).toContain('main')
    expect(workflow.on.pull_request.branches).toContain('main')
  })

  it('tests only Node versions the product actually supports', () => {
    // This used to assert the literal `[20, 22]`. Node 20 was then removed (backlog B-M67-19),
    // because every manifest declares `engines.node: ">=22.12.0"` and the CLI does not merely warn —
    // it REFUSES: `[theokit preflight] theokit requires node >= 22.12.0`. The leg was exercising a
    // configuration the product does not support, so every test that shells out to the CLI failed
    // there by design.
    //
    // Freezing the literal is what made the guard outlive the decision. It now asserts the property:
    // no matrix entry may sit below the floor the package itself declares. Adding Node 24 needs no
    // edit here; lowering the floor legitimately would let an older version back in on its own.
    const workflow = loadWorkflow('ci.yml')
    // Entries may be numbers (`22`) or strings (`'22.12'`). They became strings when the matrix
    // started pinning a minor, and this guard read them as numbers, so `toBeGreaterThanOrEqual`
    // received a string and threw `TypeError` instead of grading anything — a guard that fails for
    // a reason unrelated to the property it protects, which is the same failure as freezing the
    // literal, one layer down.
    const matrix = workflow.jobs.test.strategy.matrix['node-version'] as (number | string)[]
    expect(matrix.length, 'the matrix must test at least one version').toBeGreaterThan(0)

    const engines = (
      JSON.parse(readFileSync(resolve(__dirname, '../../packages/theo/package.json'), 'utf-8')) as {
        engines: { node: string }
      }
    ).engines.node

    /** `'22.12'` → `[22, 12]`; `'22'` → `[22, undefined]` — an absent minor is absent, not zero. */
    const parts = (value: number | string): [number, number | undefined] => {
      const [major, minor] = String(value).split('.')
      return [Number(major), minor === undefined ? undefined : Number(minor)]
    }

    const [floorMajor, floorMinorRaw] = parts(/[\d.]+/.exec(engines)?.[0] ?? '')
    const floorMinor = floorMinorRaw ?? 0
    expect(floorMajor, `engines.node not recognised: ${engines}`).toBeGreaterThan(0)

    for (const version of matrix) {
      const [major, minor] = parts(version)
      const below = `the matrix tests Node ${String(version)}, below the floor \`${engines}\` that the CLI enforces at runtime — every test that invokes it fails there by design`

      // How an entry is graded depends on what it declares, because that is what setup-node
      // resolves it to. A bare major (`'22'`) means "the newest 22.x", so it clears a `>=22.12.0`
      // floor whenever its major does — reading it as `22.0` would fail a configuration that is
      // correct, and a guard that fails correct configuration gets weakened rather than heeded.
      // An entry that pins a minor (`'22.12'`) resolves to that line, so both parts are compared:
      // `'22.0'` sits below the floor and must be caught, which grading by major alone would miss.
      if (minor === undefined) {
        expect(major, below).toBeGreaterThanOrEqual(floorMajor)
      } else {
        expect(major * 1000 + minor, below).toBeGreaterThanOrEqual(floorMajor * 1000 + floorMinor)
      }
    }
  })

  /**
   * A step that installs the toolchain, in whichever form the workflow currently uses.
   *
   * Both shapes count, and the reason is that the assertions below survived a refactor that
   * replaced one with the other. `pnpm/action-setup` + an inline install were inlined in every job
   * until they were consolidated into a shared composite action; two guards written against the
   * inline mechanics went red on a change that broke nothing, because they described HOW the
   * toolchain arrives instead of THAT it does.
   */
  function isSetupStep(step: Record<string, string>): boolean {
    const uses = step.uses ?? ''
    return uses.includes('pnpm/action-setup') || uses.includes('shared-workflows/actions/setup')
  }

  it('every job that runs pnpm sets the toolchain up first', () => {
    const workflow = loadWorkflow('ci.yml')

    const missing = Object.entries(workflow.jobs as Record<string, { steps?: unknown[] }>)
      .filter(([, job]) => Array.isArray(job.steps))
      .filter(([, job]) =>
        (job.steps as Record<string, string>[]).some((s) => s.run?.includes('pnpm ')),
      )
      .filter(([, job]) => !(job.steps as Record<string, string>[]).some((s) => isSetupStep(s)))
      .map(([name]) => name)

    expect(missing, 'these jobs run pnpm with no step that installs it').toEqual([])
  })

  it('no CI install resolves outside the lockfile, except the scaffold ones that cannot', () => {
    // The property the old `--frozen-lockfile` assertion protected: a CI install must resolve what
    // the lockfile pins, or the run measures a dependency tree nobody committed. It was written
    // against the `test` job's inline install, which the shared setup action now performs — so it
    // is stated here over EVERY job instead, where no consolidation can hollow it out.
    //
    // The scaffold job is the deliberate exception and stays visible rather than filtered out
    // silently: it scaffolds `my-test` / `my-test-bot` as new workspace members, so the lockfile
    // legitimately changes and a frozen install cannot succeed.
    const workflow = loadWorkflow('ci.yml')
    const SCAFFOLD_JOBS = new Set(['scaffold-typecheck'])

    const unfrozen = Object.entries(workflow.jobs as Record<string, { steps?: unknown[] }>)
      .filter(([name]) => !SCAFFOLD_JOBS.has(name))
      .flatMap(([name, job]) =>
        (Array.isArray(job.steps) ? (job.steps as Record<string, string>[]) : [])
          .filter((s) => s.run?.includes('pnpm install'))
          .filter((s) => !s.run.includes('--frozen-lockfile'))
          .map((s) => `${name}: ${s.run}`),
      )

    expect(unfrozen, 'a CI install that ignores the lockfile measures an uncommitted tree').toEqual(
      [],
    )
  })

  it('should have a build step (filtered or unfiltered)', () => {
    // typecheck-build runs `pnpm --filter "./packages/*" build` to avoid
    // walking examples/* which need the theokit bin built first. Accept any
    // pnpm-driven build step — filtered or not.
    const workflow = loadWorkflow('ci.yml')
    const steps = workflow.jobs['typecheck-build'].steps
    const hasBuild = steps.some(
      (s: Record<string, string>) =>
        s.run?.includes('pnpm build') ||
        s.run?.includes('pnpm -r build') ||
        // The rule flags a nested quantifier inside the optional group, but there is no ambiguity:
        // `\s+` and `[^\s]+` are DISJOINT sets, and the group starts at the `--filter` literal. With
        // no overlap, there is no exponential backtracking. Measured rather than argued
        // (agent-builder#319): an adversarial input of 50,000 characters with no `build` at the end —
        // the worst case — resolves in **1 ms**; 50,000 pure spaces, in 0 ms.
        // eslint-disable-next-line security/detect-unsafe-regex -- see above
        /pnpm\s+(?:--filter\s+[^\s]+\s+)?build/.test(s.run ?? ''),
    )
    expect(hasBuild).toBe(true)
  })

  it('should have package-validation job with publint', () => {
    const workflow = loadWorkflow('ci.yml')
    const steps = workflow.jobs['package-validation'].steps
    const hasPublint = steps.some((s: Record<string, string>) => s.run?.includes('publint'))
    expect(hasPublint).toBe(true)
  })

  // `should have e2e job with playwright install` was REMOVED: the `e2e` job left `ci.yml` with
  // `fixtures/`, which was where its Playwright harness got the apps it booted. Asserting the job
  // is present would now pin a job that cannot exist.
  it('should NOT declare an e2e job while there is no browser harness', () => {
    const workflow = loadWorkflow('ci.yml')
    expect(workflow.jobs.e2e).toBeUndefined()
  })
})

describe('Release Workflow', () => {
  const releasePath = resolve(rootDir, '.github/workflows/release.yml')

  it('should exist', () => {
    expect(existsSync(releasePath)).toBe(true)
  })

  it('should be valid YAML', () => {
    const workflow = loadWorkflow('release.yml')
    expect(workflow).toBeDefined()
    expect(workflow.name).toBe('Release')
  })

  it('should use changesets/action@v1', () => {
    const workflow = loadWorkflow('release.yml')
    const steps = workflow.jobs.release.steps
    const hasChangesets = steps.some((s: Record<string, string>) =>
      s.uses?.includes('changesets/action'),
    )
    expect(hasChangesets).toBe(true)
  })

  it('should reference NPM_TOKEN', () => {
    const content = readFileSync(releasePath, 'utf-8')
    expect(content).toContain('NPM_TOKEN')
  })

  it('should run build before publish', () => {
    const workflow = loadWorkflow('release.yml')
    const steps = workflow.jobs.release.steps
    const buildIdx = steps.findIndex((s: Record<string, string>) => s.run?.includes('pnpm build'))
    const changesetsIdx = steps.findIndex((s: Record<string, string>) =>
      s.uses?.includes('changesets/action'),
    )
    expect(buildIdx).toBeLessThan(changesetsIdx)
  })
})
