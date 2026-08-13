import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * No published copy of a package we build should sit in our own production tree.
 *
 * ## The condition this measures
 *
 * The production tree carries published copies of packages this repository builds. That is the same
 * defect ADR 0062 recorded for the SDK ("the workspace in fact loaded two copies, 4.40.0 and
 * 3.8.0"), generalised: two versions of one contract in one tree, where the tests exercise one and
 * the consumer may reach the other.
 *
 * ## The cause — corrected 2026-08-13, because the first attribution was wrong
 *
 * This docblock used to blame `@theokit/studio@0.1.0` for dragging in `@theokit/agents@1.0.0`. It
 * does not, and never did: the published studio declares `@theokit/agents` only as a **peer**, and
 * that peer resolves to the workspace 7.6.0. The attribution was inferred from co-occurrence and
 * never traced, which is how a plausible cause survives in a file everyone trusts.
 *
 * Traced through `pnpm-lock.yaml`, the real chain is a single edge inside this repository:
 *
 *   `packages/http` declares `@theokit/agents: ">=0.47.0"` as a peerDependency, and nothing in the
 *   workspace satisfies it — so pnpm auto-installs it FROM THE REGISTRY, next to the sibling of the
 *   same name sitting one directory away. That published copy then brings its own published
 *   `@theokit/http` and `@theokit/presenter` with it.
 *
 * So all three entries below descend from one unsatisfied peer, not from a sibling repository.
 *
 * ## Why the obvious fix is not applied here
 *
 * The canonical repair is `"@theokit/agents": "workspace:*"` in `packages/http`'s devDependencies.
 * Measured: it works — the lockfile links `../agents` and every duplicate leaves the tree — and it
 * **breaks the build**, because `packages/agents` already devDepends on `@theokit/http`, so the link
 * closes a type cycle and tsup's dts pass fails with `TS5055: Cannot write file 'dist/app.d.ts'
 * because it would overwrite input file`.
 *
 * Breaking that cycle is an architectural change to two packages, not a manifest edit, so it is
 * recorded as its own item rather than smuggled in under a duplicate guard.
 *
 * ## Why this reports a KNOWN set instead of demanding zero
 *
 * Demanding zero would be red by default until that cycle is broken. A gate nobody can satisfy is
 * one nobody reads — the failure this codebase spent a full cycle undoing.
 *
 * So the known duplicates are declared, with their cause, and the assertion is about **change**: a
 * new one fails, and one that disappears fails too, asking to be narrowed. Both directions are
 * information — and both fired during the 2026-08-13 measurement, which is how the wrong
 * attribution above was finally caught.
 */

const ROOT = resolve(__dirname, '../..')

/**
 * Duplicates that exist today, each with the reason it is tolerated.
 *
 * Keyed by package name; the value is the published version found in the tree.
 */
const KNOWN_DUPLICATES: ReadonlyMap<string, { version: string; because: string }> = new Map([
  [
    '@theokit/agents',
    {
      version: '7.6.0',
      because:
        'auto-installed from the registry to satisfy the unsatisfied peerDependency ' +
        '`@theokit/agents: ">=0.47.0"` in `packages/http`. The workspace sibling one directory away ' +
        'would satisfy it, but wiring that link closes a type cycle with `packages/agents` and ' +
        'breaks the dts build (TS5055) — see the docblock.',
    },
  ],
  [
    '@theokit/http',
    {
      version: '1.0.0',
      because: 'brought along by the published `@theokit/agents` above, as its own peer.',
    },
  ],
  [
    '@theokit/presenter',
    {
      version: '0.7.0',
      because:
        'same chain — a peer of the published `@theokit/agents@7.6.0`. It surfaced on 2026-08-13 ' +
        'when a reinstall re-resolved that open range from a stale 1.0.0 pin to 7.6.0, and this ' +
        'guard caught it in the "has grown" direction.',
    },
  ],
])

/** The package names this repository builds. */
function workspacePackageNames(): Set<string> {
  const names = new Set<string>()
  const members = JSON.parse(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the repo's own pnpm
    execFileSync('pnpm', ['-r', 'list', '--depth', '-1', '--json'], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    }),
  ) as { path?: string }[]
  for (const member of members) {
    if (member.path === undefined) continue
    try {
      const pkg = JSON.parse(readFileSync(join(member.path, 'package.json'), 'utf8')) as {
        name?: string
      }
      if (pkg.name !== undefined) names.add(pkg.name)
    } catch {
      continue
    }
  }
  return names
}

/** Published copies of our own packages present in the production tree. */
function publishedCopiesOfOwnPackages(): Map<string, string[]> {
  const own = workspacePackageNames()
  const byLicense = JSON.parse(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- the repo's own pnpm
    execFileSync('pnpm', ['licenses', 'list', '--prod', '--json'], {
      encoding: 'utf8',
      maxBuffer: 1 << 26,
    }),
  ) as Record<string, { name: string; versions?: string[] }[]>

  const found = new Map<string, string[]>()
  for (const packages of Object.values(byLicense)) {
    for (const pkg of packages) {
      if (!own.has(pkg.name)) continue
      const versions = pkg.versions ?? []
      if (versions.length > 0) found.set(pkg.name, versions)
    }
  }
  return found
}

describe('own packages are not installed alongside themselves', () => {
  it('test_the_set_of_duplicated_own_packages_has_not_grown', () => {
    // The assertion is about CHANGE. A new entry means some dependency started dragging another
    // published copy of a package we build — the condition nobody would otherwise notice, because
    // nothing today reports it.
    const found = publishedCopiesOfOwnPackages()
    const unexpected = [...found.keys()].filter((name) => !KNOWN_DUPLICATES.has(name))
    expect(
      unexpected,
      'a published copy of a package this repo builds appeared in the production tree. Two versions ' +
        'of one contract in one tree is the defect ADR 0062 recorded for the SDK — the tests exercise ' +
        'one and the consumer may reach the other.',
    ).toEqual([])
  })

  it('test_a_known_duplicate_that_disappears_asks_to_be_removed_from_the_list', () => {
    // The other direction. When the studio migrates, this fails and forces the list to shrink —
    // otherwise the exemption outlives the reason for it, which is how allowlists rot.
    const found = publishedCopiesOfOwnPackages()
    const goneButStillDeclared = [...KNOWN_DUPLICATES.keys()].filter((name) => !found.has(name))
    expect(
      goneButStillDeclared,
      'these are no longer in the tree — delete them from KNOWN_DUPLICATES so the list keeps ' +
        'meaning what it says.',
    ).toEqual([])
  })

  it('test_every_known_duplicate_records_why_it_is_tolerated', () => {
    // An exemption without a reason is an assertion, and the next reader cannot tell a decision from
    // an oversight.
    for (const [name, entry] of KNOWN_DUPLICATES) {
      expect(entry.because.length, `${name} must record why`).toBeGreaterThan(30)
      expect(entry.version, `${name} must pin the version observed`).toMatch(/^\d+\.\d+\.\d+$/)
    }
  })

  it('test_the_workspace_names_were_actually_discovered', () => {
    // Anti-vacuity floor: if `pnpm -r list` returned nothing, every check above would pass by
    // finding no own packages at all — green for the emptiest possible reason.
    const own = workspacePackageNames()
    expect(own.size).toBeGreaterThan(3)
    expect(own.has('theokit')).toBe(true)
    expect(own.has('@theokit/agents')).toBe(true)
  })

  it('test_ROOT_resolves_to_this_repository', () => {
    expect(ROOT.endsWith('theokit')).toBe(true)
  })
})
