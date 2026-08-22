import { describe, it, expect } from 'vitest'
import { readFile, stat, writeFile, rm } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const REPO = resolve(__dirname, '../..')

describe('architecture-guards CI (T1.1)', () => {
  it('test_dependency_cruiser_config_present — .dependency-cruiser.cjs exists', async () => {
    const s = await stat(resolve(REPO, '.dependency-cruiser.cjs'))
    expect(s.isFile()).toBe(true)
  })

  it('test_ls_lint_config_present — .ls-lint.yml exists', async () => {
    const s = await stat(resolve(REPO, '.ls-lint.yml'))
    expect(s.isFile()).toBe(true)
  })

  it('test_ci_workflow_present — .github/workflows/architecture-guards.yml exists', async () => {
    const s = await stat(resolve(REPO, '.github/workflows/architecture-guards.yml'))
    expect(s.isFile()).toBe(true)
  })

  it('test_check_deps_script — package.json has scripts.check:deps', async () => {
    const pkg = JSON.parse(await readFile(resolve(REPO, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['check:deps']).toBeDefined()
    expect(pkg.scripts['check:deps']).toMatch(/dependency-cruiser/)
  })

  it('test_check_naming_script — package.json has scripts.check:naming', async () => {
    const pkg = JSON.parse(await readFile(resolve(REPO, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    expect(pkg.scripts['check:naming']).toBeDefined()
    expect(pkg.scripts['check:naming']).toMatch(/ls-lint/)
  })

  /**
   * EC-2 baseline: run dep-cruiser + ls-lint directly.
   *
   * The budget is 240 s and the work is seconds — measured 2026-08-22: `ls-lint` takes 2 s and
   * `dependency-cruiser` 1 s from a shell. Under a full run the same `ls-lint` call blew a 30 s
   * budget and reported 115 s, and the cause is not this file: with `--typecheck.enabled=false` the
   * whole file finishes in 5.87 s, and with typecheck on it passes 120 s. A concurrent `tsc` starves
   * these `execSync` children, and the per-test clock counts the starvation.
   *
   * Raising a timeout to quiet a red test is usually the wrong move, so the reason it is right here
   * is worth stating: the assertion is unaffected either way — the linters report violations or they
   * do not — and a 30 s budget was measuring the scheduler rather than the source. The same reading
   * that gave `BUILD_HOOK_TIMEOUT_MS` its 240 s.
   */
  const EXTERNAL_CLI_TIMEOUT_MS = 240_000
  // Binaries invoked via explicit relative path (node_modules/.bin), not PATH.
  it(
    'test_check_deps_passes_today — current source has 0 dep violations',
    () => {
      const stdout = execSync(
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        'node_modules/.bin/dependency-cruiser packages/theo/src --config .dependency-cruiser.cjs --no-progress',
        { cwd: REPO, encoding: 'utf8' },
      )
      expect(stdout).toMatch(/no dependency violations found/)
    },
    EXTERNAL_CLI_TIMEOUT_MS,
  )

  it(
    'test_check_naming_passes_today — current source has 0 naming violations',
    () => {
      expect(() => {
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- explicit relative path
        execSync('node_modules/.bin/ls-lint', { cwd: REPO, stdio: 'pipe' })
      }).not.toThrow()
    },
    EXTERNAL_CLI_TIMEOUT_MS,
  )

  it('test_dep_cruiser_config_has_no_circular_rule', async () => {
    const content = await readFile(resolve(REPO, '.dependency-cruiser.cjs'), 'utf8')
    expect(content).toMatch(/no-circular/)
    expect(content).toMatch(/severity:\s*['"]error['"]/)
  })

  it('test_dep_cruiser_config_has_core_invariant', async () => {
    const content = await readFile(resolve(REPO, '.dependency-cruiser.cjs'), 'utf8')
    expect(content).toMatch(/core-depends-on-nothing/)
  })

  // EC-2 — baseline must pass before strict CI is enabled (covered by
  // test_check_deps_passes_today above; kept as a tagged duplicate for the
  // EC traceability matrix).
  it(
    'test_dep_cruiser_baseline_passes (EC-2) — config matches reality',
    () => {
      const stdout = execSync(
        // eslint-disable-next-line sonarjs/no-os-command-from-path
        'node_modules/.bin/dependency-cruiser packages/theo/src --config .dependency-cruiser.cjs --no-progress',
        { cwd: REPO, encoding: 'utf8' },
      )
      expect(stdout).toMatch(/no dependency violations found/)
      // Same budget as its two siblings above, and missed when they were fixed: this
      // also shells out to dependency-cruiser and is starved by the concurrent tsc,
      // so 30 s was grading the scheduler here too.
    },
    EXTERNAL_CLI_TIMEOUT_MS,
  )

  // architecture-report cleanup Step 1 — `_internal/` privacy boundary is
  // enforced (architecture.md Invariant 3). Closes the gap where direction
  // rules allowed e.g. vite-plugin→server but did NOT forbid reaching into
  // server/_internal across the module boundary.
  it('test_dep_cruiser_config_has_cross_module_internal_rule', async () => {
    const content = await readFile(resolve(REPO, '.dependency-cruiser.cjs'), 'utf8')
    expect(content).toMatch(/no-cross-module-internal-import/)
  })

  it('test_dependency_cruiser_forbids_cross_module_internal_import — vite-plugin→server/_internal is caught', async () => {
    // Given: a file in a module (vite-plugin) that IS allowed to depend on
    // server (direction-wise), but reaches into server/_internal (private).
    const probe = resolve(REPO, 'packages/theo/src/vite-plugin/__internal_privacy_probe.ts')
    await writeFile(
      probe,
      "import { writeAtomic } from '../server/_internal/atomic-write.js'\nexport const _p = writeAtomic\n",
      'utf8',
    )
    try {
      // When: dependency-cruiser runs — Then: it MUST flag the privacy breach.
      let caught = false
      let output = ''
      try {
        output = execSync(
          // eslint-disable-next-line sonarjs/no-os-command-from-path
          'node_modules/.bin/dependency-cruiser packages/theo/src --config .dependency-cruiser.cjs --no-progress',
          { cwd: REPO, encoding: 'utf8' },
        )
      } catch (e) {
        caught = true
        output = (e as { stdout?: string }).stdout ?? ''
      }
      expect(caught).toBe(true)
      expect(output).toMatch(/no-cross-module-internal-import/)
    } finally {
      await rm(probe, { force: true })
    }
  }, 30_000)

  it('test_intra_module_internal_import_allowed — server→server/_internal passes', () => {
    // server/scan/scan.ts already imports ../_internal/scan-walker.js — the
    // clean tree must still pass (intra-module access is allowed).
    const stdout = execSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path
      'node_modules/.bin/dependency-cruiser packages/theo/src --config .dependency-cruiser.cjs --no-progress',
      { cwd: REPO, encoding: 'utf8' },
    )
    expect(stdout).toMatch(/no dependency violations found/)
  }, 30_000)

  // EC-8 — ls-lint regex syntax handles React hook pattern
  it('test_ls_lint_accepts_react_hook_naming (EC-8) — useFoo.ts is allowed', async () => {
    // The config under packages/theo/src already has hooks like
    // `client/use-agent-stream.ts` — kebab-case (allowed). Verify camelCase
    // hooks (`useDrag.ts` pattern) would also be allowed via the regex.
    const cfg = await readFile(resolve(REPO, '.ls-lint.yml'), 'utf8')
    expect(cfg).toMatch(/use\[A-Z\]\[A-Za-z0-9\]\*/)
  })
})
