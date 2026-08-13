import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * No published copy of a package we build should sit in our own production tree.
 *
 * ## The condition this measures
 *
 * `@theokit/studio@0.1.0` is an optional peer of `theokit`, and it depends on the **published**
 * `@theokit/agents@1.0.0` and `@theokit/http@1.0.0`. So the production tree carries ancient copies of
 * packages this repository builds — `@theokit/agents` is at 7.6.0 here, seven majors ahead of the one
 * being installed alongside it.
 *
 * That is the same defect ADR 0062 recorded for the SDK ("the workspace in fact loaded two copies,
 * 4.40.0 and 3.8.0"), generalised: two versions of one contract in one tree, where the tests exercise
 * one and the consumer may reach the other.
 *
 * It is also the origin of one of the three licence violations in #213 — and the only one that
 * **cannot be fixed by republishing**, because npm tarballs are immutable. `@theokit/agents@1.0.0`
 * leaves this tree when the studio stops pulling it, not before.
 *
 * ## Why this reports a KNOWN set instead of demanding zero
 *
 * Demanding zero would be red by default: the fix is the studio migration (backlog B-M67-03), seven
 * majors of work in a different repository. A gate nobody can satisfy is one nobody reads — the
 * failure this codebase spent a full cycle undoing.
 *
 * So the known duplicates are declared, with their cause, and the assertion is about **change**: a
 * new one fails, and the day the studio migrates, this test fails too and asks to be narrowed. Both
 * directions are information.
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
      version: '1.0.0',
      because:
        'dragged in by `@theokit/studio@0.1.0`, which is seven majors behind (backlog B-M67-03). ' +
        'Also the origin of the one licence violation in #213 that cannot be republished away.',
    },
  ],
  [
    '@theokit/http',
    {
      version: '1.0.0',
      because: 'same chain — a dependency of the published `@theokit/agents@1.0.0` above.',
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
