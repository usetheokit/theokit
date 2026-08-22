import { describe, it, expect } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir as osTmpdir } from 'node:os'

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
function unpublishedPinNote(appDir: string): string {
  let deps: Record<string, string>
  try {
    deps = (
      JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>
      }
    ).dependencies!
  } catch {
    return ''
  }
  const missing: string[] = []
  for (const [name, range] of Object.entries(deps ?? {})) {
    if (!name.startsWith('theokit') && !name.startsWith('@theokit/')) continue
    const version = /^\^?(\d+\.\d+\.\d+)$/.exec(range)?.[1]
    if (version === undefined) continue
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- integration test probes the registry
      execFileSync('npm', ['view', `${name}@${version}`, 'version'], { stdio: 'pipe' })
    } catch {
      missing.push(`${name}@${version}`)
    }
  }
  if (missing.length === 0) return ''
  return (
    `The template pins ${missing.join(', ')}, which the registry does not have yet — this is the ` +
    `window between \`changeset version\` and \`changeset publish\`, not a pnpm-11 defect. ` +
    `Publish the pending release and re-run.\n`
  )
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
const portsFree = hasCorepackBin && (await probeAllPortsFree())
const npxAvailable = hasCorepackBin && (await probeNpxReachable())
const infraReady = hasCorepackBin && portsFree && npxAvailable

if (!infraReady) {
  const reasons: string[] = []
  if (!hasCorepackBin) reasons.push('corepack not in PATH')
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

    it(`template ${tpl} installs + boots dev via pnpm 11 without ERR_PNPM_IGNORED_BUILDS`, async () => {
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
          `pnpm install did not produce node_modules/theokit.\n` +
            `${unpublishedPinNote(appDir)}pnpm stderr:\n${installStderr.slice(-2000)}`,
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
