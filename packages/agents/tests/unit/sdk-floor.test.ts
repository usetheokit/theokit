import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * M67 T1 — the `@theokit/sdk` floor is a contract, and the contract is the INSTALLED version.
 *
 * ## The defect this file closes
 *
 * `packages/agents/src/index.ts:53-58` declares the layered boundary: the consumer imports the SDK's
 * core primitives from `@theokit/agents`, never from `@theokit/sdk` directly. M63 called that
 * boundary closed. It was not — eight symbols of the config/trust/wiring family never crossed, and
 * the real consumer (TheoCode) broke its own rule six times in production to reach them.
 *
 * The cause was NOT a missing line in the barrel. Measured by downloading every published tarball and
 * grepping `dist/`: seven of the eight do not exist below 4.49.0.
 *
 *   4.40.0 → 0/7   4.45.0 → 1/7   4.46.0 → 3/7   4.47.0 → 4/7   4.48.0 → 6/7   4.49.0 → 7/7
 *
 * So the floor is not a preference. It is the lowest published version in which the milestone is
 * expressable at all. ADR 0060.
 *
 * ## Why THREE assertions and not one
 *
 * The obvious test reads the manifests and checks the declared range. That test is GREEN the moment
 * someone edits `package.json` — and stays green if `pnpm install` never runs, leaving `node_modules`
 * on 4.40.0 while every re-export compiles against a `.d.ts` that is not what the runtime loads.
 *
 * That failure mode is not hypothetical here: it is the SAME defect this milestone exists to close,
 * one level down. `@theokit/presenter` declared peer `^4.40.0` and dev `^3.8.0` — its green suite
 * proved the code worked against a major that could not contain what its peer promised (ADR 0062).
 * A gate that only reads the declaration would have called that healthy.
 *
 * Hence: the DECLARED floor, the RESOLVED version, and exactly ONE copy in the workspace.
 */

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..')

/** The floor every declaration must respect. Raising it is an ADR-level decision (ADR 0060). */
const SDK_FLOOR = { major: 4, minor: 49, patch: 0 } as const

const DEP_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies'] as const

/**
 * Every workspace member, discovered from `pnpm-workspace.yaml` plus the repo root.
 *
 * Hardcoding the list is what let the first version of this gate pass while missing two declarations:
 * the ROOT manifest (`devDependencies: ^4.40.0`) and a workspace member on `^2.30.0`. The
 * repo root kept a second live copy — `packages/*` resolved 4.51.1 while `.` resolved 4.40.0 — and a
 * gate scanning only `packages/*` reported that as healthy. Same shape as the defect this milestone
 * closes: an instrument narrower than the property it claims to verify.
 */
function workspaceManifests(): string[] {
  const yaml = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const globs = [...yaml.matchAll(/^\s*-\s*'([^']+)'/gm)].map((m) => m[1]!)
  const dirs = new Set<string>([''])
  for (const glob of globs) {
    if (!glob.endsWith('/*')) {
      dirs.add(glob)
      continue
    }
    const parent = glob.slice(0, -2)
    let entries: string[]
    try {
      entries = readdirSync(join(REPO_ROOT, parent), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => `${parent}/${e.name}`)
    } catch (cause) {
      // A member declared in `pnpm-workspace.yaml` but not checked out is legitimately absent, and
      // that is the ONLY case this swallow is for. Anything else — a permission error, a broken
      // symlink — would silently shrink the gate's scope, which is the exact failure mode this file
      // exists to prevent, so it is re-raised with the path named.
      if ((cause as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw new Error(`cannot read declared workspace member "${parent}"`, { cause })
      }
      continue
    }
    for (const entry of entries) dirs.add(entry)
  }
  return [...dirs]
    .map((dir) => (dir === '' ? 'package.json' : `${dir}/package.json`))
    .filter((manifest) => existsSync(join(REPO_ROOT, manifest)))
}

/** Workspace manifests that declare `@theokit/sdk` in any dependency section. */
function manifestsDeclaringSdk(): string[] {
  return workspaceManifests().filter((manifest) => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, manifest), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >
    return DEP_SECTIONS.some((section) => pkg[section]?.['@theokit/sdk'] !== undefined)
  })
}

interface DeclaredRange {
  readonly manifest: string
  readonly section: string
  readonly range: string
}

/**
 * Parse the LOWER BOUND of a npm range. Deliberately narrow: this repo only ever writes `^x.y.z`,
 * `~x.y.z`, `>=x.y.z` or a bare `x.y.z`, and a parser that silently accepts a shape it does not
 * understand would be worse than one that refuses. `semver` is not a dependency of this workspace and
 * adding one to read three strings would fail the parsimony ladder at rung 4.
 */
function lowerBoundOf(range: string): { major: number; minor: number; patch: number } {
  const match = /^(?:\^|~|>=)?(\d+)\.(\d+)\.(\d+)/.exec(range.trim())
  if (match === null) {
    throw new Error(`unsupported range shape "${range}"; expected ^x.y.z, ~x.y.z, >=x.y.z or x.y.z`)
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

function gte(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): boolean {
  if (a.major !== b.major) return a.major > b.major
  if (a.minor !== b.minor) return a.minor > b.minor
  return a.patch >= b.patch
}

/**
 * The version each workspace package actually LOADS, resolved from that package's own directory.
 *
 * This is the honest measure of "how many copies exist": pnpm's `.pnpm` directory holds one entry per
 * peer permutation and keeps orphans from earlier installs, so counting directories answers a
 * different question than the one that matters.
 */
function resolvedPerPackage(): { manifest: string; version: string }[] {
  return manifestsDeclaringSdk().map((manifest) => {
    const from = createRequire(join(REPO_ROOT, manifest))
    const pkg = from('@theokit/sdk/package.json') as { version: string }
    return { manifest, version: pkg.version }
  })
}

function declaredRanges(): DeclaredRange[] {
  const found: DeclaredRange[] = []
  for (const manifest of manifestsDeclaringSdk()) {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, manifest), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >
    for (const section of DEP_SECTIONS) {
      const range = pkg[section]?.['@theokit/sdk']
      if (range !== undefined) found.push({ manifest, section, range })
    }
  }
  return found
}

describe('M67 T1 — the range parser refuses what it does not understand', () => {
  // Negative lens. `lowerBoundOf` is deliberately narrow, and the
  // refusal is the whole point: a parser that silently accepted a shape it cannot read would return a
  // WRONG lower bound, and every assertion built on it would be green and meaningless. Without these
  // cases, deleting the `if (match === null)` branch breaks nothing in the suite.
  it.each([
    ['>>1.0.0', 'unknown operator'],
    ['', 'empty string'],
    ['1.2', 'missing patch'],
    ['   ', 'whitespace only'],
    ['latest', 'a dist-tag, not a range'],
    ['workspace:*', 'a workspace protocol range'],
  ])('test_lowerBoundOf_throws_on_%s', (range) => {
    expect(() => lowerBoundOf(range)).toThrow(/unsupported range shape/)
  })

  it('test_lowerBoundOf_accepts_every_shape_this_repo_actually_writes', () => {
    // The edge lens of the same boundary: the largest set of VALID inputs must still parse.
    expect(lowerBoundOf('^4.49.0')).toEqual({ major: 4, minor: 49, patch: 0 })
    expect(lowerBoundOf('~4.49.1')).toEqual({ major: 4, minor: 49, patch: 1 })
    expect(lowerBoundOf('>=4.49.0')).toEqual({ major: 4, minor: 49, patch: 0 })
    expect(lowerBoundOf('4.49.0')).toEqual({ major: 4, minor: 49, patch: 0 })
    expect(lowerBoundOf('  ^4.49.0  ')).toEqual({ major: 4, minor: 49, patch: 0 })
  })
})

describe('M67 T1 — the @theokit/sdk floor', () => {
  it('test_the_gate_discovers_every_workspace_member_not_a_hardcoded_list', () => {
    // The scope of this gate must be the WORKSPACE, not a list someone remembered to update.
    // The anchor left is the one that matters and that the first version missed: the ROOT manifest,
    // which resolved 4.40.0 while `packages/*` resolved 4.51.1. The second anchor was
    //, which left the workspace along with `fixtures/`.
    const discovered = workspaceManifests()
    expect(discovered).toContain('package.json')
    expect(discovered).toContain('packages/agents/package.json')
    expect(manifestsDeclaringSdk().length).toBeGreaterThanOrEqual(3)
  })

  it('test_every_package_declaring_the_sdk_pins_at_least_4_49', () => {
    const violations = declaredRanges().filter(
      (declared) => !gte(lowerBoundOf(declared.range), SDK_FLOOR),
    )
    expect(
      violations.map((v) => `${v.manifest} ${v.section}=${v.range}`),
      'every declared range must have a lower bound >= 4.49.0 (ADR 0060)',
    ).toEqual([])
  })

  it('test_the_RESOLVED_sdk_satisfies_the_declared_floor', () => {
    // EC-1 — the assertion above proves the DECLARATION. This one proves the INSTALLATION.
    // Without it, a bumped range plus a forgotten `pnpm install` is indistinguishable from success.
    const offenders = resolvedPerPackage().filter(
      (entry) => !gte(lowerBoundOf(entry.version), SDK_FLOOR),
    )
    expect(
      offenders.map((o) => `${o.manifest} resolves ${o.version}`),
      'every workspace package must RESOLVE an sdk >= 4.49.0 — run `pnpm install`',
    ).toEqual([])
  })

  it('test_every_workspace_package_resolves_the_same_sdk_copy', () => {
    // EC-7 — ADR 0060 rejects a partial bump because two copies break `instanceof` across the error
    // hierarchy that M80 will harden. Without this test that rejection is an argument, not a check.
    //
    // Measured on what is RESOLVED per package, not on `node_modules/.pnpm` listings: the store keeps
    // one directory per peer permutation AND retains orphaned entries from previous installs. On this
    // repo that listing showed 16 directories across 10 versions (2.30.0 … 4.40.0) while `pnpm why -r`
    // reported a uniform 4.40.0 — i.e. the listing answers "what was ever installed", and the question
    // here is "what does our code load".
    const versions = new Set(resolvedPerPackage().map((entry) => entry.version))
    expect(
      [...versions],
      'the three packages must load ONE sdk; two copies make `instanceof` silently false across them',
    ).toHaveLength(1)
  })
})
