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
 * ## How it was fixed (B-M67-21, 2026-08-13)
 *
 * The first attempt was the obvious one — `"@theokit/agents": "workspace:*"` in `packages/http`'s
 * devDependencies — and it **broke the build**: `packages/agents` already devDepends on
 * `@theokit/http`, so the link closed a TYPE cycle and tsup's dts pass died with `TS5055: Cannot
 * write file 'dist/app.d.ts' because it would overwrite input file`. Satisfying the peer was the
 * wrong move; the peer should never have existed.
 *
 * `system-design-guardrails.md` § G1 had said so all along — "`@theokit/http` does NOT import
 * `@theokit/agents` (agents depends on http, not the reverse)" — and nothing checked it. So the
 * direction was inverted instead: `TheoAppOptions.agentRuntime` declares the slice of the agent
 * layer that `TheoApp` needs, the caller supplies it (DIP, `architecture.md` § 2), the dynamic
 * `import()` is gone, and the peer is off the manifest. `packages/http/tests/unit/
 * dependency-direction.test.ts` now guards the half of G1 that had no oracle.
 *
 * ## Why this now demands zero
 *
 * It used to assert about CHANGE against a declared allowlist, because demanding zero would have
 * been red by default — and a gate nobody can satisfy is one nobody reads, the failure this
 * codebase spent a full cycle undoing. With the cause removed, zero is satisfiable, so zero is what
 * it says.
 *
 * The allowlist went with the condition it described. Both of its directions had already earned
 * their keep on the way out: the "has grown" direction caught `@theokit/presenter` appearing after
 * a reinstall — which is how the wrong attribution above was finally noticed — and the
 * "disappeared" direction fired the moment the fix landed, asking to be narrowed. Keeping the
 * mechanism empty afterwards would be machinery for a hypothetical exemption (YAGNI), and it made
 * three of five assertions vacuous. The next real exemption arrives with its own reason.
 */

const ROOT = resolve(__dirname, '../..')

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
  it('test_no_published_copy_of_a_package_we_build_is_in_the_production_tree', () => {
    // Zero, flatly. This assertion was impossible to satisfy until B-M67-21 removed the cause, so
    // it used to be phrased against a declared allowlist — the assertion was about CHANGE, because
    // demanding zero would have been red by default and a gate nobody can satisfy is one nobody
    // reads.
    //
    // The allowlist is gone with the condition it described. Keeping an empty exemption map would
    // be machinery for a hypothetical future exemption (YAGNI) — and, measured by the linter, it
    // made three of the five assertions here vacuous. The day a real exemption is needed, it
    // arrives with its own reason attached; that is a better trade than carrying the mechanism
    // empty and pretending it still guards something.
    const found = [...publishedCopiesOfOwnPackages().entries()].map(
      ([name, versions]) => `${name}@${versions.join(',')}`,
    )
    expect(
      found,
      'a published copy of a package this repo builds is in the production tree. Two versions of ' +
        'one contract in one tree is the defect ADR 0062 recorded for the SDK — the tests exercise ' +
        'one and the consumer may reach the other. Trace it with `pnpm why <name> --prod`: the last ' +
        'one arrived through an unsatisfied peerDependency that pnpm auto-installed from the ' +
        'registry (B-M67-21).',
    ).toEqual([])
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
