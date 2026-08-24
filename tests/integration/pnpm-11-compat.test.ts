import { describe, it, expect } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir as osTmpdir } from 'node:os'

import { unpublishedPins } from '../../scripts/unpublished-pins.js'

/**
 * theokit-evolution-ci-and-dx Phase 1C — pnpm 11+ compat gate.
 *
 * Validates that scaffolded templates install + boot dev under pnpm 11
 * WITHOUT `ERR_PNPM_IGNORED_BUILDS` blocking. The `pnpm.onlyBuiltDependencies`
 * hint in each template's `package.json.tmpl` must remain present.
 *
 * Bug discovered 2026-05-28 during dogfood: pnpm 11 default approve-builds
 * gate blocks esbuild postinstall, which trips on `runDepsStatusCheck` when
 * `pnpm dev` runs. Templates ship the hint; this test enforces it doesn't
 * regress + verifies the dev binary boots cleanly.
 *
 * v1.1 EC-5 MUST FIX: corepack `COREPACK_DEFAULT_PM` env-scoped per call,
 * NO `prepare --activate` global → preserves inter-test isolation.
 * v1.1 EC-7 SHOULD TEST: pre-flight port collision check actionable.
 */

const TEMPLATES = ['default'] as const

// Scaffold via the LOCAL create-theokit build — the test's contract is that
// "each template's package.json.tmpl ships the pnpm.onlyBuiltDependencies hint"
// (see docstring). The published `@latest` lags the source, so testing it can
// never enforce the CURRENT template; the local CLI is what we control + ship.
const LOCAL_CLI = join(import.meta.dirname, '../../packages/create-theokit/dist/cli.js')

/**
 * The scaffolded app pins the WORKSPACE versions of `theokit` / `@theokit/agents`, written by
 * `pnpm sync:templates` at `changeset version` time — before `changeset publish` runs. Between those
 * two steps every fresh scaffold is uninstallable, and this test is red for a reason that has nothing
 * to do with pnpm 11 or the `onlyBuiltDependencies` hint it exists to guard.
 *
 * That window is real and the red is honest, so the test does not skip it. It just says so, instead
 * of leaving the reader with `expected false to be true`. Backlog B-M67-08.
 */
/**
 * The first-party pins the registry does not have, or an empty list.
 *
 * The decision lives in `scripts/unpublished-pins.ts` so it can be tested without a network; this
 * reads the manifest and probes npm for it.
 */
function unpublishedPinsOf(appDir: string): string[] {
  let deps: Record<string, string> | undefined
  try {
    deps = (
      JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>
      }
    ).dependencies
  } catch {
    return []
  }
  return unpublishedPins(deps, (spec) => {
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- integration test probes the registry
      execFileSync('npm', ['view', spec, 'version'], { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  })
}

function hasCorepack(): boolean {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- integration test probes runner PATH for corepack; sandbox-safe
    execFileSync('corepack', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// v1.1 EC-5 — env-scoped pnpm 11 (no global activate)
const PNPM_ENV = {
  ...process.env,
  COREPACK_DEFAULT_PM: 'pnpm@11.1.0',
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), 1000)
      try {
        const res = await fetch(`http://localhost:${port}/`, { signal: ctrl.signal })
        clearTimeout(tid)
        if (res.ok || res.status === 404 || res.status === 304) return true
      } catch {
        clearTimeout(tid)
      }
    } catch {
      // outer try guards fetch-not-available (older runtimes); best-effort retry
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

async function isPortBusy(port: number): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), 500)
    await fetch(`http://localhost:${port}/`, { signal: ctrl.signal })
    clearTimeout(tid)
    return true
  } catch {
    return false
  }
}

// dogfood-regressions-fix-plan v1.1 — honest skipIf for infra deps.
// This integration test requires (a) corepack present, (b) ports 5000-5004
// all free, (c) network reachable for `npx create-theokit@latest`. When any
// requirement is missing, the suite skips with a clear stderr message instead
// of pretending to run + failing on port/network errors. Pattern matches
// `tests/integration/ollama-end-to-end.test.ts` (D182).
async function probeAllPortsFree(): Promise<boolean> {
  for (let i = 0; i < TEMPLATES.length; i++) {
    if (await isPortBusy(5000 + i)) return false
  }
  return true
}

/**
 * Does the pnpm 11 this test exists to exercise actually RUN on the Node it is running on? (#418)
 *
 * Measured, not compared against a hardcoded version. pnpm **11** requires Node >= 22.13, and this
 * repository declares `engines.node: ">=22.12.0"`. On the floor the product supports, pnpm 11 exits
 * before installing anything, and this test reported
 * `pnpm install did not produce node_modules/theokit` — a message about theokit, for a limit that
 * has nothing to do with theokit. (The repository's own pinned pnpm 10.34 runs fine at 22.12;
 * measured. It is pnpm 11, which this test opts into deliberately, that does not.)
 *
 * The probe runs OUTSIDE the repository on purpose: in the repo root corepack honours the local
 * `packageManager` field and would answer for pnpm 10, which is not the version under test.
 *
 * A version comparison would need updating every time pnpm moves its own floor, and would be wrong
 * in the window before anyone noticed. Asking pnpm is the answer that cannot go stale.
 */
function probePnpm11RunsHere(): string | undefined {
  const probeDir = mkdtempSync(join(osTmpdir(), 'theokit-pnpm11-probe-'))
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- same probe as `hasCorepack` above: an integration test asking the runner's own corepack whether it can run pnpm 11 here
    execFileSync('corepack', ['pnpm', '--version'], {
      stdio: 'pipe',
      env: PNPM_ENV,
      cwd: probeDir,
      timeout: 60_000,
    })
    return undefined
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? ''
    const refusal = /requires at least Node\.js[^\n]*/.exec(stderr)?.[0]
    return refusal ?? 'corepack could not run pnpm 11'
  } finally {
    rmSync(probeDir, { recursive: true, force: true })
  }
}

async function probeNpxReachable(): Promise<boolean> {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- integration test probes runner PATH for npx
    execFileSync('npx', ['--version'], { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

const hasCorepackBin = hasCorepack()
const pnpmRefusal = hasCorepackBin ? probePnpm11RunsHere() : undefined
const portsFree = hasCorepackBin && (await probeAllPortsFree())
const npxAvailable = hasCorepackBin && (await probeNpxReachable())
const infraReady = hasCorepackBin && pnpmRefusal === undefined && portsFree && npxAvailable

if (!infraReady) {
  const reasons: string[] = []
  if (!hasCorepackBin) reasons.push('corepack not in PATH')
  if (pnpmRefusal !== undefined) reasons.push(`pnpm 11 will not run here — ${pnpmRefusal}`)
  if (!portsFree) reasons.push('ports 5000-5004 not all free')
  if (!npxAvailable) reasons.push('npx not reachable')
  process.stderr.write(
    `[pnpm-11-compat] Skipping — infra requirements not met: ${reasons.join(', ')}. ` +
      'This integration test needs corepack + free ports 5000-5004 + npx network access.\n',
  )
}

describe.skipIf(!infraReady)('pnpm 11 compat — scaffold + install + dev boot', () => {
  for (let i = 0; i < TEMPLATES.length; i++) {
    const tpl = TEMPLATES[i]!
    const port = 5000 + i // 5000-5004

    it(`template ${tpl} installs + boots dev via pnpm 11 without ERR_PNPM_IGNORED_BUILDS`, async (ctx) => {
      // v1.1 EC-7 pre-flight: port collision check actionable
      if (await isPortBusy(port)) {
        throw new Error(`Port ${port} busy. Free it: lsof -ti :${port} | xargs kill -9`)
      }

      const sandbox = mkdtempSync(join(osTmpdir(), `pnpm11-${tpl}-`))
      const appDir = join(sandbox, `my-${tpl}`)
      let devPid: number | undefined

      try {
        // Step 1: scaffold via the LOCAL create-theokit build. `--yes` runs it
        // non-interactively (otherwise the CLI blocks on the "use recommended
        // defaults?" prompt — stdin is piped, so it reads EOF and exits WITHOUT
        // scaffolding).
        execFileSync(
          // eslint-disable-next-line sonarjs/no-os-command-from-path -- integration test runs the local scaffolder via the node on PATH
          'node',
          [LOCAL_CLI, `my-${tpl}`, `--template=${tpl}`, '--skip-install', '--yes'],
          { cwd: sandbox, stdio: 'pipe', env: PNPM_ENV, timeout: 120_000 },
        )
        expect(existsSync(appDir)).toBe(true)

        // Step 2: the build approvals ship where pnpm READS them. This asserted
        // `pkg.pnpm.onlyBuiltDependencies` until #397, and pnpm 10+ announces in the
        // first line of every run that it no longer reads that field — so the
        // assertion was passing on a hint the tool ignored.
        const workspaceYaml = readFileSync(join(appDir, 'pnpm-workspace.yaml'), 'utf-8')
        expect(workspaceYaml).toMatch(/^\s*esbuild:\s*true\s*$/mu)

        // The release window is not this test's subject. Between `changeset version` and
        // `changeset publish` the template pins a version the registry does not have, so the
        // install cannot succeed for a reason that has nothing to do with pnpm 11's build
        // approvals. Failing here deadlocked the release (#438): this is a REQUIRED check on
        // `main`, and its own message asked for the publish that the failing check prevents.
        const pending = unpublishedPinsOf(appDir)
        if (pending.length > 0) {
          ctx.skip(
            `template pins ${pending.join(', ')}, which the registry does not have yet — the ` +
              `window between \`changeset version\` and \`changeset publish\`, not a pnpm-11 defect`,
          )
        }

        // Step 3: install via pnpm 11 (env-scoped). pnpm 11 exits non-zero on
        // ERR_PNPM_IGNORED_BUILDS even when install completed. Check by file
        // presence, not exit code.
        let installStderr = ''
        try {
          // eslint-disable-next-line sonarjs/no-os-command-from-path -- integration test invokes pnpm via PATH
          execFileSync('pnpm', ['install', '--prefer-offline'], {
            cwd: appDir,
            stdio: 'pipe',
            env: PNPM_ENV,
            timeout: 120_000,
          })
        } catch (cause) {
          // A non-zero exit is EXPECTED here: pnpm 11 exits non-zero on ERR_PNPM_IGNORED_BUILDS even
          // when the install completed, and distinguishing that from a real failure is what the file
          // check below is for. What is NOT acceptable is discarding the output: the previous version
          // swallowed it, so a genuinely broken install surfaced as a bare `expected false to be
          // true` with nothing pointing at the cause.
          installStderr = String((cause as { stderr?: Buffer }).stderr ?? cause)
        }
        expect(
          existsSync(join(appDir, 'node_modules/theokit')),
          `pnpm install did not produce node_modules/theokit.\npnpm stderr:\n${installStderr.slice(-2000)}`,
        ).toBe(true)

        // The title's promise, asserted. Until #397 this test tolerated
        // ERR_PNPM_IGNORED_BUILDS — the comment above says a non-zero exit is
        // "EXPECTED" — while its name said "without". It was accommodating the
        // defect #397 reports rather than catching it, which is why a green suite
        // coexisted with a scaffolder that failed on its first command.
        expect(
          installStderr,
          `pnpm refused to run a build script. The approvals ship in pnpm-workspace.yaml; if pnpm ` +
            `stopped reading them there, that is the finding.\npnpm stderr:\n${installStderr.slice(-2000)}`,
        ).not.toContain('ERR_PNPM_IGNORED_BUILDS')

        // Step 4: boot dev via theokit binary direct (bypass pnpm wrapper's
        // deps-status-check that re-trips ERR_PNPM_IGNORED_BUILDS)
        const theokitBin = join(appDir, 'node_modules/.bin/theokit')
        expect(existsSync(theokitBin)).toBe(true)

        const dev = spawn(theokitBin, ['dev', `--port=${port}`], {
          cwd: appDir,
          stdio: 'pipe',
          detached: true,
          env: { ...PNPM_ENV, NODE_ENV: 'development' },
        })
        devPid = dev.pid
        dev.stderr?.on('data', () => {}) // drain to avoid backpressure
        dev.stdout?.on('data', () => {})

        const ready = await waitForPort(port, 60_000)
        expect(ready, `dev server failed to boot on port ${port} within 60s`).toBe(true)
      } finally {
        if (devPid !== undefined) {
          try {
            process.kill(-devPid, 'SIGKILL')
          } catch {
            try {
              process.kill(devPid, 'SIGKILL')
            } catch {
              // process already exited; nothing to clean
            }
          }
        }
        rmSync(sandbox, { recursive: true, force: true })
      }
    }, 180_000)
  }
})
