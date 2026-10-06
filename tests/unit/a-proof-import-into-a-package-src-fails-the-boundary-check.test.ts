/**
 * A proof that imports a theokit package's `src/` fails its app's boundary check (B-416, REQ-15).
 *
 * TheoClaw and TheoCode prove the framework through its public API, so an import that resolves into
 * `packages/<name>/src/` proves nothing about what a consumer can reach. Each app's own
 * dependency-cruiser config carries `proof-imports-only-published-entry-points`, and this file is
 * that rule's arming proof: deliberate probes that violate it, and a control that does not.
 *
 * Probes are written to an OS temp directory, never under `apps/` (NFR-005), with a `node_modules`
 * link to TheoCode's so a control importing `@theokit/agents` resolves at all; without the link it
 * is unresolved and passes vacuously. Each probe is cruised twice: the JSON run says which rule
 * fired and that the probe was cruised, the `err` run gives the exit code CI sees (the JSON
 * reporter exits 0 even with a violation).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO = resolve(import.meta.dirname, '../..')
const RULE = 'proof-imports-only-published-entry-points'
const SRC_IMPORT = `import * as src from '${join(REPO, 'packages/agents/src/index.ts')}'\nexport const touched = src\n`
const CONTROL_IMPORT =
  "import { tokenBudgetCompactionStrategy } from '@theokit/agents'\nexport const touched = tokenBudgetCompactionStrategy\n"
const TIMEOUT_MS = 60_000

type App = 'theocode' | 'theoclaw'

interface Dependency {
  resolved: string
  couldNotResolve: boolean
}
interface CruisedModule {
  source: string
  dependencies: Dependency[]
}
interface Cruise {
  errExit: number | null
  errors: number
  violations: string[]
  modules: CruisedModule[]
}

/**
 * Runs `body` with a fresh probe directory under the OS temp directory, linked to TheoCode's
 * `node_modules`, and removes the directory afterwards whatever happens (D7).
 */
function withProbeDir<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'proof-import-'))
  try {
    symlinkSync(join(REPO, 'apps/theocode/node_modules'), join(dir, 'node_modules'), 'dir')
    return body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function bin(app: App): string {
  return app === 'theocode'
    ? join(REPO, 'apps/theocode/node_modules/.bin/depcruise')
    : join(REPO, 'node_modules/.bin/depcruise')
}

/** Cruises one probe with the app's own config, from the app's directory. */
function cruise(app: App, probe: string): Cruise {
  const options = { cwd: join(REPO, 'apps', app), encoding: 'utf8' as const }
  const base = [probe, '--config', '.dependency-cruiser.cjs', '--output-type']
  const json = spawnSync(bin(app), [...base, 'json'], options)
  const err = spawnSync(bin(app), [...base, 'err'], options)
  expect(json.status, `depcruise did not run for ${app}: ${json.stderr}`).toBe(0)
  const report = JSON.parse(json.stdout) as {
    summary: { error: number; violations: { rule: { name: string } }[] }
    modules: CruisedModule[]
  }
  const name = probe.split('/').at(-1) ?? probe
  expect(
    report.modules.some((m) => m.source.endsWith(name)),
    `${name} was not cruised, so nothing about it was checked`,
  ).toBe(true)
  return {
    errExit: err.status,
    errors: report.summary.error,
    violations: report.summary.violations.map((v) => v.rule.name),
    modules: report.modules,
  }
}

function writeProbe(dir: string, name: string, content: string): string {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

/** Cruises one probe file, written with `content` into a fresh probe directory. */
function cruiseProbe(app: App, name: string, content: string): Cruise {
  return withProbeDir((dir) => cruise(app, writeProbe(dir, name, content)))
}

function expectRefused(result: Cruise): void {
  expect(result.errors).toBe(1)
  expect(result.violations).toEqual([RULE])
  expect(result.errExit).not.toBe(0)
}

describe('theoclaw refuses a proof import into a package src', () => {
  it(
    'theoclaw: a source file importing packages/agents/src fails boundaries',
    () => {
      expectRefused(cruiseProbe('theoclaw', 'probe.ts', SRC_IMPORT))
    },
    TIMEOUT_MS,
  )

  it(
    'theoclaw: a test file importing packages/agents/src fails boundaries',
    () => {
      expectRefused(cruiseProbe('theoclaw', 'probe.test.ts', SRC_IMPORT))
    },
    TIMEOUT_MS,
  )

  it(
    'theoclaw: files named distribution.ts and distribution.test.ts are cruised and refused',
    () => {
      // cruise() fails the test when the probe is absent from the cruised modules, so a file
      // excluded because its name contains "dist" cannot pass here.
      expectRefused(cruiseProbe('theoclaw', 'distribution.ts', SRC_IMPORT))
      expectRefused(cruiseProbe('theoclaw', 'distribution.test.ts', SRC_IMPORT))
    },
    TIMEOUT_MS,
  )

  it(
    'theoclaw: a test file importing @theokit/agents passes boundaries',
    () => {
      // TheoClaw's exclusion drops every edge into a dist/ directory, so this control can show
      // only that the probe was cruised and nothing fired, not where the import resolved.
      const result = cruiseProbe('theoclaw', 'control.test.ts', CONTROL_IMPORT)

      expect(result.errExit).toBe(0)
      expect(result.errors).toBe(0)
    },
    TIMEOUT_MS,
  )
})

describe('the probes never touch the repository', () => {
  it('probes live outside apps/ and are gone after the run', () => {
    // The link is what lets a control resolve @theokit/agents at all; without it the import is
    // unresolved and the control passes having checked nothing.
    const seen = withProbeDir((dir) => {
      expect(existsSync(join(dir, 'node_modules/@theokit/agents/package.json'))).toBe(true)
      return dir
    })

    expect(seen.startsWith(join(REPO, 'apps'))).toBe(false)
    expect(seen).not.toMatch(/(^|\/)(node_modules|dist)\//)
    expect(existsSync(seen)).toBe(false)
  })
})
