import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * The anti-vacuity floor for the vitest project split.
 *
 * ## Why this test exists
 *
 * The suite used to run every file through a single `root` project whose `include` was
 * `tests/**`, serialized by a global `fileParallelism: false`. That setting was written for the ~22
 * files that spawn `theokit dev` / `theokit build` and fight over ports — and it was paid for by all
 * 759. Measured: 434 unit files took **235 s** serial and **30 s** parallel, same 3477 assertions,
 * green both ways.
 *
 * The split fixes that: `root` runs in parallel, `root-serial` keeps the serialization for
 * integration and smoke. But it moved the file selection from ONE catch-all glob to an ENUMERATED
 * set of directories — and an enumeration fails by **omission**. Add `tests/e2e/`, and those tests
 * simply never run: no error, no red, just a smaller gate wearing the same name.
 *
 * That is the same failure guards against with its coverage floor, and
 * for the same reason: a scan that returns less than it should looks exactly like a complete one.
 *
 * So: every test file under `tests/` must be claimed by exactly one project. Not zero — that is the
 * silent gap. Not two — that is the double execution this split introduced on its first attempt,
 * where both projects inherited the root `include` and ran the same 550 files twice.
 *
 * ## The sweep covers `packages/{name}/tests/` too, and did not always
 *
 * It swept `tests/` alone, and the enumeration it exists to police lists PACKAGE configs as well.
 * So it confirmed full coverage of a scope that excluded the gap: eighteen files under
 * `packages/theo`, `packages/create-theokit` and `packages/tauri` typechecked and ran in no project
 * at all — `packages/theo` had no vitest config, and the other two had one that the root never
 * referenced (usetheokit/theokit#357). One of them had been asserting against a literal that no
 * longer appeared in the file, and nothing said so, because nothing ran it.
 *
 * That is this file's own failure mode arriving one level up: a guard whose scope is narrower than
 * the thing it guards reports green over the part it cannot see.
 */

const ROOT = resolve(__dirname, '../..')

/**
 * Every test file on disk under `tests/`, the way the filesystem sees it.
 *
 * The walk tolerates an entry that vanishes between `readdirSync` and `statSync`. That is not
 * defensive padding: `tests/` is a LIVE directory while the suite runs — sibling tests create and
 * remove scratch trees there (`tests/__tmp_manifest_test__/`, `tests/.tmp-middleware/`), and this
 * gate walks it concurrently. Without the guard the whole file fails with an `ENOENT` on a path
 * that existed a millisecond earlier, intermittently, which is the flakiness this repository's own
 * testing rules call a bug.
 *
 * A directory that disappears mid-walk holds no test file this gate could be missing: it is scratch
 * output, by construction.
 */
function testFilesOnDisk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'fixtures') continue
    const full = join(dir, entry)
    let isDirectory: boolean
    try {
      isDirectory = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDirectory) {
      // The recursion can race too — the directory may go while its children are being listed.
      try {
        found.push(...testFilesOnDisk(full))
      } catch {
        continue
      }
    } else if (/\.test(-d)?\.tsx?$/.test(entry)) {
      found.push(relative(ROOT, full))
    }
  }
  return found
}

/** What vitest says it will run, per project — the source of truth for the gate's real reach. */
function filesVitestWillRun(): Map<string, Set<string>> {
  // `npx` from PATH, same contract states for its own spawns: this runs
  // as part of the test suite, in the repository, with the toolchain the developer already invoked.
  // An absolute path would break across macOS/nix and closes no threat — whoever controls the PATH
  // of a local test run already controls the `node` executing it.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
  const out = execFileSync('npx', ['vitest', 'list', '--filesOnly'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    timeout: 240_000,
  })
  const byProject = new Map<string, Set<string>>()
  for (const line of out.split('\n')) {
    const match = /^\[([^\]]+)\]\s+(\S+)/.exec(line.trim())
    if (match === null) continue
    const [, project, file] = match
    if (!byProject.has(file)) byProject.set(file, new Set())
    byProject.get(file)!.add(project)
  }
  return byProject
}

/**
 * Test roots: the repository's own `tests/`, plus each package's. Derived from disk
 * rather than listed, for the same reason the rest of this file exists — a list
 * fails by omission, and a new package would inherit exactly the gap #357 recorded.
 */
function testRoots(): string[] {
  const roots = [join(ROOT, 'tests')]
  const packagesDir = join(ROOT, 'packages')
  for (const entry of readdirSync(packagesDir)) {
    const candidate = join(packagesDir, entry, 'tests')
    try {
      if (statSync(candidate).isDirectory()) roots.push(candidate)
    } catch {
      // The package owns no tests. Nothing to claim, nothing to check.
    }
  }
  return roots
}

/**
 * Files deliberately claimed by NO project, each with the reason it is out.
 *
 * An allowlist and not a silent skip: a declared exclusion and a forgotten one look
 * identical from the outside, and telling them apart is the entire job of this file.
 * Adding a row here is a decision someone made on the record; adding a test that
 * nothing runs is not.
 */
const DECLARED_EXCLUSIONS: { pattern: RegExp; why: string }[] = [
  {
    pattern: /^packages\/agents\/tests\/live\//,
    why: 'hits a real provider; excluded by packages/agents/vitest.config.ts and run on demand via `npm run test:live`',
  },
]

function isDeclaredExclusion(file: string): boolean {
  return DECLARED_EXCLUSIONS.some((rule) => rule.pattern.test(file))
}

describe('the vitest project split reaches every test file', () => {
  const onDisk = testRoots()
    .flatMap((root) => testFilesOnDisk(root))
    .filter((file) => !isDeclaredExclusion(file))
  const claimed = filesVitestWillRun()

  it('test_there_is_at_least_one_test_file_to_check', () => {
    // Anti-vacuity for the anti-vacuity guard: if the walk finds nothing, every assertion below
    // passes trivially and this file becomes decoration.
    expect(onDisk.length).toBeGreaterThan(400)
  })

  it('test_EVERY_file_under_tests_is_claimed_by_some_project', () => {
    // The omission failure. A new `tests/e2e/` directory would land here, loudly, instead of
    // silently never running.
    const orphans = onDisk.filter(
      (file) => ![...claimed.keys()].some((c) => c.endsWith(file) || file.endsWith(c)),
    )
    expect(orphans, `not covered by any vitest project: ${orphans.join(', ')}`).toEqual([])
  })

  it('test_NO_file_is_claimed_by_two_projects', () => {
    // The duplication failure, and it is not hypothetical: the first version of this split had both
    // root projects inherit the top-level `include`, so 550 files ran TWICE — 783 test files became
    // 1357 and the run got slower, not faster, while reporting more green tests than exist.
    const doubled = [...claimed.entries()]
      .filter(([, projects]) => projects.size > 1)
      .map(([file, projects]) => `${file} → ${[...projects].join(' + ')}`)
    expect(doubled, `claimed by more than one project: ${doubled.join('; ')}`).toEqual([])
  })

  it('test_ROOT_integration_and_smoke_land_in_the_SERIAL_project', () => {
    // The guarantee the split must not lose. These are the files that bind ports and run the real
    // build; putting one in the parallel project re-creates the contention the original global
    // setting was written to remove.
    //
    // Scoped to the ROOT `tests/` tree, which is the only thing this split governs. The packages'
    // own integration suites (`packages/*/tests/integration/`) belong to their own projects, which
    // are referenced by path and therefore never inherited the root-level `fileParallelism` — they
    // already ran in parallel before this change. Measured on the way in: 209 files, 1622
    // assertions, green in 57 s. Asserting over them here would be asserting a guarantee this
    // config never made.
    const misplaced = [...claimed.entries()]
      .filter(([file]) => /(^|\/)tests\/(integration|smoke)\//.test(file))
      .filter(([file]) => !file.includes('packages/'))
      .filter(([, projects]) => !projects.has('root-serial'))
      .map(([file]) => file)
    expect(misplaced, `must run in root-serial: ${misplaced.join(', ')}`).toEqual([])
  })
}, 300_000)
