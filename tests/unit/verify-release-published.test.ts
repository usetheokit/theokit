/**
 * The release guard actually fires (usetheokit/theokit#366).
 *
 * ## Why this test exists
 *
 * `scripts/verify-release-published.mjs` is the answer to a pipeline that ran green and published
 * nothing — twice, because "nothing to publish" and "published" produced the same visible result.
 *
 * It had no test. A guard that has never been observed failing is a guard that might not: the whole
 * defect it guards against was a step that reported success without doing anything, and a guard
 * with the same property would be that defect wearing a different name.
 *
 * ## How the registry is replaced
 *
 * The script is a program, not a module — it reads `packages/` from the cwd and shells out to `npm`.
 * So it is exercised AS a program: run in a fixture directory, with a fake `npm` first on `PATH`.
 * That is the real script, its real argument parsing and its real exit codes, with only the network
 * boundary replaced. Refactoring it to accept an injected fetcher would have changed production code
 * to suit a test, for a seam nothing else needs.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const SCRIPT = join(process.cwd(), 'scripts', 'verify-release-published.mjs')

interface Pkg {
  readonly dir: string
  readonly name: string
  readonly version: string
  readonly private?: boolean
}

/**
 * A fixture repository plus a fake `npm`.
 *
 * `published` lists the `name@version` the fake registry knows. Anything else answers the way npm
 * answers for an unknown version — exit 1 with `E404` on stderr — which is what the script reads.
 */
function fixture(packages: readonly Pkg[], published: readonly string[], unreachable = false) {
  const root = mkdtempSync(join(tmpdir(), 'theo-release-guard-'))
  for (const pkg of packages) {
    const dir = join(root, 'packages', pkg.dir)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: pkg.name, version: pkg.version, private: pkg.private ?? false }),
    )
  }

  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true })
  const npm = join(bin, 'npm')
  writeFileSync(
    npm,
    unreachable
      ? `#!/bin/sh\necho "npm ERR! network request to https://registry.npmjs.org failed" 1>&2\nexit 1\n`
      : `#!/bin/sh\n# argv: view <name>@<version> version\ncase " ${published.join(' ')} " in\n  *" $2 "*) echo "\${2##*@}" ;;\n  *) echo "npm ERR! code E404" 1>&2; exit 1 ;;\nesac\n`,
    { mode: 0o755 },
  )
  chmodSync(npm, 0o755)

  return { root, bin }
}

function runGuard(f: { root: string; bin: string }) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: f.root,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH ?? ''}` },
  })
}

describe('a release whose versions all reached the registry passes', () => {
  it('test_every_declared_version_present_exits_zero', () => {
    const f = fixture(
      [
        { dir: 'a', name: 'theokit', version: '0.49.0' },
        { dir: 'b', name: 'create-theokit', version: '1.23.9' },
      ],
      ['theokit@0.49.0', 'create-theokit@1.23.9'],
    )

    const run = runGuard(f)

    expect(run.status).toBe(0)
    expect(run.stdout).toContain('theokit@0.49.0 is on the registry')
  })

  it('test_a_private_package_is_not_expected_on_the_registry', () => {
    const f = fixture(
      [
        { dir: 'a', name: 'theokit', version: '0.49.0' },
        { dir: 'internal', name: '@theokit/internal', version: '1.0.0', private: true },
      ],
      ['theokit@0.49.0'],
    )

    expect(runGuard(f).status).toBe(0)
  })
})

describe('a release that published nothing FAILS — the whole point', () => {
  it('test_a_version_the_registry_does_not_have_exits_non_zero_and_names_it', () => {
    const f = fixture(
      [
        { dir: 'a', name: 'theokit', version: '0.49.0' },
        { dir: 'b', name: 'create-theokit', version: '1.23.9' },
      ],
      // Exactly the state of run 32370544611: the repo moved, the registry did not.
      [],
    )

    const run = runGuard(f)

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('theokit@0.49.0 was NOT published')
    expect(run.stderr).toContain('create-theokit@1.23.9 was NOT published')
  })

  it('test_one_missing_among_several_still_fails', () => {
    const f = fixture(
      [
        { dir: 'a', name: 'theokit', version: '0.49.0' },
        { dir: 'b', name: 'create-theokit', version: '1.23.9' },
      ],
      ['theokit@0.49.0'],
    )

    const run = runGuard(f)

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('create-theokit@1.23.9 was NOT published')
  })
})

describe('an answer the guard could not obtain is not an answer', () => {
  it('test_an_unreachable_registry_fails_rather_than_passing', () => {
    const f = fixture([{ dir: 'a', name: 'theokit', version: '0.49.0' }], [], true)

    const run = runGuard(f)

    // "I could not check" and "it published" are different facts, and only one is safe to report as
    // a release. A guard that passed here would restore the exact green this exists to remove.
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('could not be checked')
  })
})

describe('checking nothing is not passing', () => {
  it('test_no_publishable_package_fails_the_non_vacuity_floor', () => {
    const f = fixture(
      [{ dir: 'x', name: '@theokit/only-private', version: '1.0.0', private: true }],
      [],
    )

    const run = runGuard(f)

    expect(run.status).toBe(1)
    expect(run.stderr).toContain('nothing was checked')
  })
})
