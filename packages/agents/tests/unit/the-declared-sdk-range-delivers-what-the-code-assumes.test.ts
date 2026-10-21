import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The declared range promised a floor that delivered none of the parity it advertises.
 *
 * `packages/agents` declared `"@theokit/sdk": "^4.52.1 || ^5.0.0"`. Measured 2026-09-12 by
 * unpacking the published tarballs, against a control of `AgentOptions` (83-86 files in every one):
 *
 * | surface                 | 4.52.1 | 5.0.0 | 5.3.0 | 5.4.0 |
 * |-------------------------|--------|-------|-------|-------|
 * | `CompatSurface`         | 0      | 10    | 10    | 10    |
 * | `.claude/rules/*` spec  | 0      | 4     | 4     | 4     |
 * | `settings.local.json`   | 0      | 4     | 4     | 4     |
 * | `CLAUDE_PROJECT_DIR`    | 0      | 14    | 14    | 14    |
 *
 * So the boundary is the 4→5 major exactly, and the lower half of the declared range delivered ZERO
 * parity. Not one missing surface: every surface at once, invisibly, because the package resolves,
 * compiles and runs. This repository's own lockfile resolved 4.52.1, so its 1887 green tests were
 * green against an SDK where `compatSources` does not exist as an option.
 *
 * ## Why the range was narrowed rather than guarded with a fourth runtime check
 *
 * Three version guards already exist — `HOOK_GATE_SINCE`, `COMPAT_IMPORT_SINCE`, and the
 * `compatSources` warning — and each one is on a path where this layer PASSES AN OPTION to the SDK.
 * The three surfaces above are not like that: nothing is passed, the SDK simply reads a file or does
 * not, so there is no call site to guard. A fourth check could not have been written.
 *
 * The reason the floor stayed low is recorded in `sdk-adapter-create-options.ts` and has expired:
 * *"Until this package's floor can name a stable 5.x"*. `@theokit/sdk@5.5.0` is published and is
 * `latest`; stable 5.x has existed since 5.3.0.
 *
 * ## The invariant this file pins
 *
 * **Every version inside the declared range either works, or fails with a typed error naming what it
 * needs. None fails in silence.** That is the whole distinction between the two kinds of gap:
 *
 * - below 5.0.0 the surfaces are simply absent and nothing says so → closed by the RANGE
 * - between 5.0.0 and 5.4.0 `local.hooks` and the narrowed `import` are absent → guarded by
 *   `HookGateUnsupportedError` and `CompatImportUnsupportedError`, which name the version
 * - below 5.11.0 the SDK sends no cache directive for an Anthropic-family model, so every turn pays
 *   full price for the system prompt, and nothing says so → closed by the RANGE, which is why the
 *   floor is now the caching release (B-412). The two guards above are unreachable from inside
 *   that range unless an override pins the SDK lower; their removal is B-488.
 *
 * A test that only asserted the string would pass on a range someone widened back by hand with a
 * different spelling, so the floor is PARSED and compared numerically.
 */
/** The repo root, reached out of `packages/agents/tests/unit`. */
const ROOT = join(__dirname, '..', '..', '..', '..')

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const

/**
 * Every workspace member directory, expanded from the globs `pnpm-workspace.yaml` declares.
 *
 * The scan used to read `packages/*` alone, so the two `apps/theocode` manifests pinning 5.9.2 sat
 * outside it while the root override moved the tree to 5.11.0, and theocode's own pin guard failed
 * in CI with this file green (B-412 review round 2, LCR0202 and LCR0602). Reading the globs makes
 * the scan cover what pnpm installs, including a member added later.
 *
 * Only the two glob shapes pnpm-workspace.yaml uses are expanded: a literal path and a `*` segment.
 * Any other pattern throws, so a new shape cannot be skipped in silence.
 */
function workspaceMembers(): string[] {
  const yaml = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8')
  const globs: string[] = []
  let inPackages = false
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) inPackages = line.startsWith('packages:')
    const entry = inPackages ? /^\s+-\s+'?([^'\s#]+)'?/.exec(line) : null
    if (entry?.[1] !== undefined) globs.push(entry[1])
  }
  return globs.flatMap((glob) => expandGlob(glob.split('/')))
}

/** Expand one workspace glob, segment by segment, against the directories on disk. */
function expandGlob(segments: string[], base = ''): string[] {
  const [head, ...rest] = segments
  if (head === undefined) return [base]
  if (/[?[\]{}!]|\*\*/.test(head) || (head.includes('*') && head !== '*')) {
    throw new Error(`pnpm-workspace.yaml glob segment "${head}" is not a literal or a bare *`)
  }
  const names = head === '*' ? subdirectories(join(ROOT, base)) : [head]
  return names
    .filter((name) => existsSync(join(ROOT, base, name)))
    .flatMap((name) => expandGlob(rest, base === '' ? name : join(base, name)))
}

/** The directory names directly under `dir`, or none when `dir` does not exist. */
function subdirectories(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
}

/**
 * EVERY declaration of `@theokit/sdk` anywhere in the workspace, enumerated from disk.
 *
 * Enumerated rather than listed, and that is this file's own scar. The first version took a
 * hardcoded pair — `packages/agents` dependencies, `packages/theo` peerDependencies — narrowed
 * exactly those two, and passed. The installed copy did not move: the root `package.json` and two
 * `devDependencies` still admitted 4.x, and a devDependency is what a workspace actually installs.
 * So `sdk-floor.test.ts` reported two live copies, `['4.52.1', '5.5.0']`, while this file reported
 * agreement.
 *
 * A test that checks the places its author remembered measures the author's memory. The defect this
 * whole item is about is a declared range disagreeing with the installed reality, and a hardcoded
 * list reproduces it one layer up.
 */
function everySdkDeclaration(): Array<{ pkg: string; field: string; range: string }> {
  const manifests = ['package.json', ...workspaceMembers().map((d) => join(d, 'package.json'))]
  const out: Array<{ pkg: string; field: string; range: string }> = []
  for (const rel of manifests) {
    const path = join(ROOT, rel)
    if (!existsSync(path)) continue
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >
    for (const field of DEPENDENCY_FIELDS) {
      const range = json[field]?.['@theokit/sdk']
      if (range !== undefined) out.push({ pkg: rel, field, range })
    }
  }
  return out
}

function declaredSdkRange(pkg: string, field: string): string {
  const found = everySdkDeclaration().find(
    (d) => d.pkg === `${pkg}/package.json` && d.field === field,
  )
  // A narrowing `tsc` understands, rather than `as` or `!`. Both of those tell the compiler to stop
  // asking while leaving the runtime unprotected; a throw is the same line count and is true.
  if (found === undefined) throw new Error(`${pkg} declares no @theokit/sdk under ${field}`)
  return found.range
}

/** Every `major.minor` this range admits as its lowest point, per disjunct. */
function floorsOf(range: string): Array<{ major: number; minor: number }> {
  return range.split('||').map((part) => {
    const m = /(\d+)\.(\d+)\.(\d+)/.exec(part.trim())
    expect(m, `cannot parse a floor out of "${part.trim()}"`).not.toBeNull()
    return { major: Number(m?.[1]), minor: Number(m?.[2]) }
  })
}

/** The major below which every `.claude` parity surface is absent from the SDK. Measured, not assumed. */
const PARITY_SINCE_MAJOR = 5

/**
 * The lowest minor PROVEN to carry the persistence surface this package re-exports.
 *
 * The floor was `^5.0.0` for one commit, on the strength of the four parity surfaces being present
 * at 5.0.0 — which they are. That check was necessary and not sufficient: the barrel is generated
 * from the RESOLVED copy, so it also ships whatever that copy exports, and six of those names do not
 * exist at 5.0.0. The DTS build fails against the bottom of the range, which is a build error for the
 * consumer rather than a typed refusal.
 *
 * Caught by `dep-check / suite at the bottom of every declared range` — the job that runs on a pull
 * request into `main` and skips on one into `develop`, so it fired exactly where it was designed to.
 *
 * Measured with controls at each version (positive `transcriptPath` = 1, invented name = 0):
 * 5.0.0 carries 1 of the 7, and 5.3.0, 5.4.0 and 5.5.0 carry all 7. So 5.3.0 is the lowest version
 * MEASURED to work, not necessarily the first — the two tarballs between them were not published to
 * this scratch set, and declaring a floor that was proven beats declaring one that was inferred.
 */
const SURFACE_SINCE_MINOR = 3

/**
 * The minor that first marks the system prompt cacheable for an Anthropic-family model.
 *
 * Below it the agent runs, compiles and pays full price on every turn, and no error or warning
 * names the gap: the silent kind of gap the invariant above says the range must close.
 */
const CACHING_SINCE_MINOR = 11

/** The version the root `pnpm.overrides` resolves for every importer in the workspace. */
function overriddenSdkVersion(): string {
  const root = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    pnpm?: { overrides?: Record<string, string> }
  }
  const pinned = root.pnpm?.overrides?.['@theokit/sdk']
  if (pinned === undefined) throw new Error('the root package.json has no @theokit/sdk override')
  return pinned
}

/**
 * Whether `range` admits `version`, for the two shapes the workspace spells: `^x.y.z` and an exact
 * `x.y.z`, joined by `||`. Any other shape throws rather than answering, so a declaration written
 * another way is reported instead of read as agreement.
 */
function admits(range: string, version: string): boolean {
  const [vMajor, vMinor, vPatch] = version.split('.').map(Number)
  return range.split('||').some((part) => {
    const m = /^(\^?)(\d+)\.(\d+)\.(\d+)$/.exec(part.trim())
    if (m === null) throw new Error(`cannot read the range "${part.trim()}"`)
    const [major, minor, patch] = [Number(m[2]), Number(m[3]), Number(m[4])]
    if (m[1] === '') return major === vMajor && minor === vMinor && patch === vPatch
    if (major !== vMajor) return false
    return minor !== vMinor ? (vMinor ?? 0) > minor : (vPatch ?? 0) >= patch
  })
}

describe('the declared SDK range delivers the parity the package advertises', () => {
  it('has at least one declaration to check, so a silent zero cannot pass', () => {
    // The control. `everySdkDeclaration()` reads the filesystem, and a rename or a moved root would
    // make it return nothing — at which point every loop below passes over an empty set and this
    // file reports agreement it never measured.
    // Ten declarations on 2026-10-21 (root, presenter twice, agents, theo twice, theoclaw, theocode
    // twice); the floor of 8 leaves room to drop one or two without hiding a scan that lost apps/.
    expect(everySdkDeclaration().length).toBeGreaterThanOrEqual(8)
  })

  it('reads the declarations under apps/ as well as packages/', () => {
    // The control for the glob expansion: the two theocode manifests are the ones the packages/-only
    // scan missed, so the scan must name them.
    const pkgs = everySdkDeclaration().map((d) => d.pkg)
    expect(pkgs).toContain(join('apps', 'theocode', 'package.json'))
    expect(pkgs).toContain(join('apps', 'theocode', 'packages', 'agent', 'package.json'))
  })

  it('declares, in every manifest, a range that admits the version the root override installs', () => {
    // pnpm.overrides resolves every importer to one version whatever its manifest says, so a
    // declaration that refuses that version names an SDK the tree does not run. theocode's pin
    // guard fails on exactly that (LCR0202), and a published package carrying it asks npm for a
    // second copy.
    const installed = overriddenSdkVersion()
    for (const { pkg, field, range } of everySdkDeclaration()) {
      expect(
        admits(range, installed),
        `${pkg} [${field}] declares @theokit/sdk "${range}", which does not admit ${installed}, ` +
          'the version the root pnpm.overrides installs for every importer',
      ).toBe(true)
    }
  })

  it('admits no major below the one that introduced the compat root, in ANY declaration', () => {
    for (const { pkg, field, range } of everySdkDeclaration()) {
      for (const floor of floorsOf(range)) {
        // The minor matters as much as the major now, and for a different reason: the major is where
        // the parity surfaces begin, the minor is where the barrel's own re-exports do.
        if (floor.major === PARITY_SINCE_MAJOR) {
          expect(
            floor.minor,
            `${pkg} [${field}] admits @theokit/sdk@5.${floor.minor}.x, where six of this ` +
              `package's persistence re-exports do not exist — the DTS build fails against the ` +
              `bottom of that range, which the consumer meets as a build error`,
          ).toBeGreaterThanOrEqual(SURFACE_SINCE_MINOR)
        }
        expect(
          floor.major,
          `${pkg} [${field}] admits @theokit/sdk@${floor.major}.${floor.minor}.x, where ` +
            `CompatSurface, the .claude/rules spec, settings.local.json and CLAUDE_PROJECT_DIR ` +
            `are all absent — so that floor delivers zero parity and nothing tells anyone. ` +
            `A devDependency counts: it is what the workspace installs.`,
        ).toBeGreaterThanOrEqual(PARITY_SINCE_MAJOR)
      }
    }
  })

  it('keeps `theo` from advertising a floor its own dependency refuses', () => {
    // `theo` depends on `agents` (workspace:^), so a peer range admitting a major that `agents`
    // rejects is unsatisfiable for the consumer and says nothing until they try to install. The two
    // must move together; narrowing one alone relocates the defect rather than closing it.
    const agents = floorsOf(declaredSdkRange('packages/agents', 'dependencies'))
    const theo = floorsOf(declaredSdkRange('packages/theo', 'peerDependencies'))

    // Compared as (major, minor), not by major alone: theo's peer read ^5.9.2 beside the agents
    // floor ^5.11.0, a consumer on 5.9 or 5.10 satisfied the peer, and npm then installed a second
    // SDK copy under @theokit/agents (B-412 review round 2, F-dom-3).
    const lowest = (fs: Array<{ major: number; minor: number }>) =>
      Math.min(...fs.map((f) => f.major * 1000 + f.minor))

    expect(
      lowest(theo),
      'theo peer-advertises an SDK floor that its own agents dependency will not resolve',
    ).toBeGreaterThanOrEqual(lowest(agents))
  })

  it('pins the agents floor at the caching release, below which the cache directive is silently absent', () => {
    // The invariant's other half. A named gap (a typed error that states the version it needs) may
    // stay inside the range; a silent one may not. On 5.3 to 5.10 an Anthropic-family agent sends
    // no `cache_control` and reports nothing, so the floor is 5.11, the release that sends it. The
    // floor used to stay below 5.4 so the hook and import guards kept 5.0-5.3 consumers installable;
    // the caching gap outranks that, by decision of human/paulo on 2026-10-20 (B-412 option A).
    const floors = floorsOf(declaredSdkRange('packages/agents', 'dependencies'))
    expect(floors).toHaveLength(1)
    expect(floors[0]?.major).toBe(5)
    expect(
      floors[0]?.minor,
      `the agents floor admits @theokit/sdk@5.${floors[0]?.minor}.x, where an Anthropic-family ` +
        'agent sends no cache directive and nothing tells the consumer; the floor must be the ' +
        'caching release',
    ).toBeGreaterThanOrEqual(CACHING_SINCE_MINOR)
  })
})
