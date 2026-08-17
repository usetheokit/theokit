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
 */

const ROOT = resolve(__dirname, '../..')

/** Every test file on disk under `tests/`, the way the filesystem sees it. */
function testFilesOnDisk(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'fixtures') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      found.push(...testFilesOnDisk(full))
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

describe('the vitest project split reaches every test file', () => {
  const onDisk = testFilesOnDisk(join(ROOT, 'tests'))
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
