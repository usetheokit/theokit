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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

/**
 * The retry budget is collapsed to near-zero for the suite. The delays exist for a registry that
 * is eventually consistent; a test's fake registry is not, so sleeping through them would buy
 * nothing but 30 seconds. The DEFAULT budget is asserted separately below, because a seam that
 * makes a gate fast is also a seam that can quietly switch it off.
 */
function runGuard(f: { root: string; bin: string }, delaysMs = '1,1,1,1') {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: f.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${f.bin}:${process.env.PATH ?? ''}`,
      THEO_RELEASE_VERIFY_DELAYS_MS: delaysMs,
    },
  })
}

describe('the retry budget is real when nobody overrides it', () => {
  it('test_the_default_budget_waits_seconds_not_milliseconds', () => {
    const source = readFileSync(SCRIPT, 'utf8')
    const declared = /THEO_RELEASE_VERIFY_DELAYS_MS \?\? '([0-9, ]+)'/.exec(source)

    expect(declared, 'the script must declare a default retry budget').not.toBeNull()

    const total = (declared?.[1] ?? '')
      .split(',')
      .map((n) => Number(n.trim()))
      .reduce((a, b) => a + b, 0)

    // npm propagation is seconds. A budget under 10s would reproduce run 32771822392; an unbounded
    // one would hang a release on a genuine failure.
    expect(total).toBeGreaterThanOrEqual(10_000)
    expect(total).toBeLessThanOrEqual(120_000)
  })
})

/**
 * A fake registry that answers E404 the first `n` times it is asked about a spec, then answers
 * normally. This is what npmjs actually does to a reader three seconds after a publish: the write
 * succeeded, the read path has not caught up, and `npm view` reports E404 — indistinguishable, to
 * this script, from a version that was never published.
 *
 * The counter lives on disk because each `npm view` is a separate process.
 */
function fixtureWithLag(packages: readonly Pkg[], published: readonly string[], lag: number) {
  const f = fixture(packages, published)
  const npm = join(f.bin, 'npm')
  writeFileSync(
    npm,
    `#!/bin/sh
spec="$2"
counter="${f.root}/lag.$(echo "$spec" | tr -c 'a-zA-Z0-9' '_')"
n=$(cat "$counter" 2>/dev/null || echo 0)
echo $((n + 1)) > "$counter"
case " ${published.join(' ')} " in
  *" $spec "*)
    if [ "$n" -lt ${String(lag)} ]; then
      echo "npm ERR! code E404" 1>&2; exit 1
    fi
    echo "\${spec##*@}"
    ;;
  *) echo "npm ERR! code E404" 1>&2; exit 1 ;;
esac
`,
    { mode: 0o755 },
  )
  chmodSync(npm, 0o755)
  return f
}

describe('a version that IS published but has not propagated yet is not "NOT published"', () => {
  /**
   * The run of 2026-08-24 (32771822392) failed reporting five packages as unpublished. All five
   * were on the registry — `changeset publish` wrote them at 20:06:49 and this guard read at
   * 20:06:52. The one package it passed, `@theokit/tauri@0.1.2`, was the only one NOT published in
   * that run, so it had already propagated.
   *
   * A guard that fails a successful release is the mirror of the one that passes a failed release,
   * and it costs more than noise: it points the reader at #366 and #413 — a missing credential —
   * for a release that published fine, and it trains them to disbelieve the next real failure.
   */
  it('test_a_version_that_appears_after_a_retry_passes', () => {
    const f = fixtureWithLag(
      [{ dir: 'a', name: 'pkg-a', version: '1.0.0' }],
      ['pkg-a@1.0.0'],
      2, // absent on the first two reads, present on the third
    )

    const r = runGuard(f)

    expect(r.stderr + r.stdout).toContain('pkg-a@1.0.0')
    expect(r.status).toBe(0)
  })

  it('test_a_version_that_never_appears_still_fails', () => {
    const f = fixtureWithLag([{ dir: 'a', name: 'pkg-a', version: '1.0.0' }], [], 0)

    const r = runGuard(f)

    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('was NOT published')
  })
})

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
