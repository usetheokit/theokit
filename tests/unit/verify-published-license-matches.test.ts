/**
 * The published-licence report actually fires (usetheokit/theokit#422).
 *
 * ## Why this test exists
 *
 * `verify-published-license-matches.mjs` is the answer to `@theokit/http@1.1.0` and
 * `@theokit/presenter@0.7.0` being `MIT` on npm while this repository licenses them `Apache-2.0` —
 * the same version numbers carrying two different licences depending on where the code came from.
 *
 * It had no test, and it is the kind that cannot be proven by running it: against the real registry
 * it reports today's state, which is a fact about npm rather than about the script. So the registry
 * is replaced at the process boundary and the script is exercised AS a program — real argument
 * parsing, real exit codes, only the network faked.
 *
 * A licence report nobody has watched fail is a licence report that might not.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts', 'verify-published-license-matches.mjs')

interface Pkg {
  readonly dir: string
  readonly name: string
  readonly license?: string
  readonly version?: string
  readonly private?: boolean
}

/**
 * A fixture repository plus a fake `npm view <name> license version --json`.
 *
 * `registry` maps a package name to what the registry serves. A name that is absent answers the way
 * npm answers for an unknown package — exit 1 with `E404`.
 */
function fixture(
  packages: readonly Pkg[],
  registry: Readonly<Record<string, { license: string; version: string }>>,
  unreachable = false,
) {
  const root = mkdtempSync(join(tmpdir(), 'theo-licence-report-'))
  for (const pkg of packages) {
    const dir = join(root, 'packages', pkg.dir)
    mkdirSync(dir, { recursive: true })
    const manifest: Record<string, unknown> = { name: pkg.name, version: pkg.version ?? '1.0.0' }
    if (pkg.license !== undefined) manifest.license = pkg.license
    if (pkg.private === true) manifest.private = true
    writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest))
  }

  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  const cases = Object.entries(registry)
    .map(
      ([name, served]) =>
        `  "${name}") echo '{"license":"${served.license}","version":"${served.version}"}' ;;`,
    )
    .join('\n')
  const npm = join(bin, 'npm')
  writeFileSync(
    npm,
    unreachable
      ? `#!/bin/sh\necho "npm ERR! network request failed" 1>&2\nexit 1\n`
      : `#!/bin/sh\n# argv: view <name> license version --json\ncase "$2" in\n${cases}\n  *) echo "npm ERR! code E404" 1>&2; exit 1 ;;\nesac\n`,
    { mode: 0o755 },
  )
  chmodSync(npm, 0o755)

  return { root, bin }
}

function runReport(f: { root: string; bin: string }) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: f.root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH ?? ''}` },
  })
}

describe('a registry serving what the repository declares passes', () => {
  it('test_matching_licences_exit_zero', () => {
    const f = fixture([{ dir: 'a', name: 'theokit', license: 'Apache-2.0', version: '0.49.0' }], {
      theokit: { license: 'Apache-2.0', version: '0.49.0' },
    })

    const run = runReport(f)

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('serves the licence this repository declares')
  })

  it('test_a_package_the_registry_never_saw_is_skipped', () => {
    // There is no published licence to disagree with. Failing here would make every new package a
    // compliance problem on the day it is created.
    const f = fixture([{ dir: 'a', name: '@theokit/brand-new', license: 'Apache-2.0' }], {})

    expect(runReport(f).status).toBe(0)
  })

  it('test_a_private_package_is_not_audited', () => {
    const f = fixture([{ dir: 'x', name: '@theokit/internal', license: 'MIT', private: true }], {})

    expect(runReport(f).status).toBe(0)
  })
})

describe('the mismatch this exists for is reported', () => {
  it('test_the_exact_state_of_issue_422_fails_and_names_both_licences', () => {
    // Literally the reported state: repo says Apache-2.0, npm serves MIT, same version.
    const f = fixture(
      [
        { dir: 'http', name: '@theokit/http', license: 'Apache-2.0', version: '1.1.0' },
        { dir: 'presenter', name: '@theokit/presenter', license: 'Apache-2.0', version: '0.7.0' },
      ],
      {
        '@theokit/http': { license: 'MIT', version: '1.1.0' },
        '@theokit/presenter': { license: 'MIT', version: '0.7.0' },
      },
    )

    const run = runReport(f)

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('@theokit/http')
    expect(run.stderr).toContain('Apache-2.0')
    expect(run.stderr).toContain('MIT')
    // The remedy has to travel with the finding: a published version cannot be edited.
    expect(run.stderr).toContain('republish')
  })

  it('test_a_package_declaring_no_licence_is_a_problem_of_its_own', () => {
    // A tarball with no licence is "all rights reserved" to whoever installs it — the opposite of
    // shipping an open framework.
    const f = fixture([{ dir: 'a', name: 'theokit', version: '0.49.0' }], {
      theokit: { license: 'Apache-2.0', version: '0.49.0' },
    })

    const run = runReport(f)

    expect(run.status).toBe(1)
    expect(run.stderr).toMatch(/declares no .?license/i)
  })
})

describe('an answer the report could not obtain is not an answer', () => {
  it('test_an_unreachable_registry_fails_rather_than_reporting_compliance', () => {
    const f = fixture([{ dir: 'a', name: 'theokit', license: 'Apache-2.0' }], {}, true)

    const run = runReport(f)

    // "I could not check" and "there is no mismatch" are different facts, and only one of them is
    // safe to report as compliance.
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('could not read the registry')
  })
})
