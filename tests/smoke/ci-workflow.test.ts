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
    const matrix = workflow.jobs.test.strategy.matrix['node-version'] as number[]
    expect(matrix.length, 'the matrix must test at least one version').toBeGreaterThan(0)

    const engines = (
      JSON.parse(readFileSync(resolve(__dirname, '../../packages/theo/package.json'), 'utf-8')) as {
        engines: { node: string }
      }
    ).engines.node
    const floorMajor = Number(/(\d+)/.exec(engines)?.[1])
    expect(floorMajor, `engines.node not recognised: ${engines}`).toBeGreaterThan(0)

    for (const version of matrix) {
      expect(
        version,
        `the matrix tests Node ${version}, below the floor \`${engines}\` that the CLI enforces at ` +
          `runtime — every test that invokes it fails there by design`,
      ).toBeGreaterThanOrEqual(floorMajor)
    }
  })

  it('should use pnpm/action-setup', () => {
    const workflow = loadWorkflow('ci.yml')
    const steps = workflow.jobs['lint-and-format'].steps
    const hasPnpmSetup = steps.some((s: Record<string, string>) =>
      s.uses?.includes('pnpm/action-setup'),
    )
    expect(hasPnpmSetup).toBe(true)
  })

  it('should use --frozen-lockfile for the main pnpm install', () => {
    // The `test` job has TWO `pnpm install` steps: one for the sibling
    // theokit-sdk clone (uses --no-frozen-lockfile because lockfile may be
    // out of sync with the SDK's own dev cadence) and the canonical theokit
    // install (uses --frozen-lockfile). We assert the canonical one exists,
    // not the first match — workflow ordering is irrelevant to the contract.
    const workflow = loadWorkflow('ci.yml')
    const steps = workflow.jobs.test.steps
    const hasFrozenInstall = steps.some((s: Record<string, string>) =>
      s.run?.includes('pnpm install --frozen-lockfile'),
    )
    expect(hasFrozenInstall).toBe(true)
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
