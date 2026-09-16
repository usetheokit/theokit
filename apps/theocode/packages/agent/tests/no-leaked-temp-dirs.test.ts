/**
 * A test that makes a temporary directory removes it.
 *
 * The cost was MEASURED here twice, not assumed. `aggregate-cut-wiring.test.ts:44-47` records 193
 * directories and 15 MB of generated rule corpora surviving a single afternoon of re-runs, from one
 * file with no cleanup; `session/gc/background-sweep.test.ts:15-18` records 2 773 leaked
 * `theocode-*` directories in `/tmp` from the same habit. Both files were given cleanup in response
 * and sixteen others went on leaking, because nothing checks — which is the whole failure mode:
 * a leak is invisible at the point it happens and shows up weeks later as a full disk on a machine
 * belonging to whoever ran the suite most. Re-measured on the machine this was written on: 28 077
 * directories in `/tmp` carrying the prefixes these files use.
 *
 * Sixteen and not the thirteen the review counted, in both directions, and both corrections came
 * from measurement. One of the thirteen creates nothing — `no-ambient-cwd.test.ts` prints the idiom
 * as ADVICE, which is why the rule below reads the import rather than the call text. Four more were
 * found by tightening the rule after its first version passed the largest leaker in the tree.
 *
 * This is the sibling of `no-ambient-cwd.test.ts` and is written to the same shape deliberately: a
 * scan over every test file, a floor on how many files were scanned so a wrong root cannot report
 * a clean tree, and a message that tells the offender what to do instead of what it did wrong.
 *
 * It guards against ACCIDENT, not evasion — the same limit that file states, and one limit is worth
 * naming because it was measured and left standing: a file that removes SOME of the roots it makes
 * passes, because the rule sees one `rmSync` and cannot tell which directory it removes.
 * `tools/check-codex-parity.test.mjs` is in that state today (four removals, two roots left behind).
 * Deciding it per call site is a different tool; the failure worth catching here is someone reaching
 * for the obvious idiom and stopping there, which is how all sixteen were written.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const PACKAGES = join(REPO, 'packages')
const TOOLS = join(REPO, 'tools')

/**
 * Keyed on the IMPORT, not on the call.
 *
 * `no-ambient-cwd.test.ts` names `mkdtempSync(join(tmpdir(), '...'))` inside the string it prints at
 * its own offenders — a file that creates no directory at all. Matching the call text alone reports
 * it, and a guard whose first finding is a false one teaches people to phrase around it. A file that
 * did not import the function did not call it.
 */
const IMPORTS_MKDTEMP = /import\s*\{[^}]*\bmkdtempSync\b[^}]*\}\s*from\s*'node:fs'/

/**
 * A REMOVAL, not merely a hook.
 *
 * The first version of this rule accepted `afterEach`/`afterAll` as evidence, and it was measured
 * wrong within the hour: `composition.test.ts` has an `afterEach` that restores `process.env.HOME`
 * and removes nothing, and it was the single largest leaker in the tree at 63 directories per full
 * run — passed by the rule that was supposed to catch it. Three more files had the same shape.
 * A hook says the file has teardown; only a removal call says the teardown removes the directory.
 *
 * Still deliberately generous about HOW: `background-sweep.test.ts` removes in `afterAll` over a
 * roots array, `aggregate-cut-wiring.test.ts` in `afterEach`, and a file calling `rmSync` inline at
 * the end of its one case is doing the job too.
 */
const CLEANS_UP = /\b(rmSync|rmdirSync)\b/

/** Comments stripped first: this file's own prose names both halves and must not report itself. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function leaksATemporaryDirectory(source: string): boolean {
  const code = withoutComments(source)
  return IMPORTS_MKDTEMP.test(code) && !CLEANS_UP.test(code)
}

/**
 * Every `.ts`/`.tsx`/`.mjs` under a tests root, not only `*.test.*`. A helper the tests import leaks
 * exactly as a test does, and this repository has one: `hooks/hooks-test-helpers.ts` exports the
 * `tmp()` that `fail-safe-defaults.test.ts` calls twice per run.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(tsx?|mjs)$/.test(entry)) out.push(full)
  }
  return out
}

describe('the detector', () => {
  it('test_a_file_that_makes_a_directory_and_never_removes_it_is_reported', () => {
    // The fixture that MUST fail, first. Without it the scan below could report an empty list
    // because the rule never matches anything, which reads identically to a clean tree.
    expect(
      leaksATemporaryDirectory(
        "import { mkdtempSync } from 'node:fs'\nconst dir = mkdtempSync('/tmp/x-')\n",
      ),
      'the rule did not report a file that plainly leaks',
    ).toBe(true)
  })

  it('test_the_same_file_with_cleanup_is_not_reported', () => {
    // Anti-vacuity: a rule that reported everything would satisfy the case above and make the scan
    // below unpassable for a reason unrelated to any leak.
    expect(
      leaksATemporaryDirectory(
        "import { mkdtempSync, rmSync } from 'node:fs'\n" +
          "const made: string[] = []\nafterEach(() => { for (const d of made) rmSync(d, { recursive: true, force: true }) })\n",
      ),
    ).toBe(false)
  })

  it('test_a_teardown_hook_that_removes_nothing_is_still_reported', () => {
    // The measured false negative, pinned. This is `composition.test.ts` before it was fixed: an
    // `afterEach` that restores an environment variable and leaves 63 directories per run behind.
    // An earlier version of the rule read the hook as evidence of cleanup and passed it.
    expect(
      leaksATemporaryDirectory(
        "import { mkdtempSync } from 'node:fs'\n" +
          "beforeEach(() => { process.env.HOME = mkdtempSync('/tmp/x-') })\n" +
          "afterEach(() => { process.env.HOME = realHome })\n",
      ),
      'a hook that removes nothing was read as cleanup',
    ).toBe(true)
  })

  it('test_a_file_that_only_names_the_idiom_in_a_string_is_not_reported', () => {
    // `no-ambient-cwd.test.ts`, exactly: it prints the idiom as advice and creates nothing.
    expect(
      leaksATemporaryDirectory("const advice = `pass one of your own — mkdtempSync(join(tmpdir(), '...'))`\n"),
    ).toBe(false)
  })

  it('test_a_file_that_only_discusses_it_in_a_comment_is_not_reported', () => {
    expect(
      leaksATemporaryDirectory("// import { mkdtempSync } from 'node:fs' — what this used to do\n"),
    ).toBe(false)
  })
})

describe('no test leaves a temporary directory behind', () => {
  it('test_every_file_that_makes_a_temporary_directory_also_removes_it', () => {
    const offenders: string[] = []
    const rootsSeen: string[] = []
    let scanned = 0

    const scan = (label: string, dir: string): void => {
      let stat
      try {
        stat = statSync(dir)
      } catch {
        return
      }
      if (!stat.isDirectory()) return
      rootsSeen.push(label)
      for (const file of sourceFiles(dir)) {
        scanned += 1
        if (leaksATemporaryDirectory(readFileSync(file, 'utf8'))) {
          offenders.push(file.slice(REPO.length))
        }
      }
    }

    for (const pkg of readdirSync(PACKAGES)) scan(pkg, join(PACKAGES, pkg, 'tests'))
    // `tools/` is not a package and has no `src/`, so its tests sit beside its checkers
    // (`rules/testing.md` § 5). It is scanned by name for that reason, and it held the largest
    // single leak in the tree: `check-coverage-floor.test.mjs` made 17 directories per run.
    scan('tools', TOOLS)

    // ANTI-VACUITY, the same floor `no-ambient-cwd.test.ts` carries and for the same reason: a root
    // that does not exist throws, but a root that exists and holds nothing relevant is SILENT, and
    // scanning zero files reports zero offenders forever.
    expect(scanned, 'the scan found almost no files — the root is wrong, not the tree clean').toBeGreaterThan(100)
    expect(
      rootsSeen.sort(),
      'a root stopped being scanned, so a leak there would pass unseen',
    ).toEqual(['agent', 'cli', 'shared', 'tools', 'tui'])

    expect(
      offenders,
      `these files create a temporary directory per run and never remove it. Track what you make ` +
        `and remove it in an \`afterEach\`/\`afterAll\` — \`packages/agent/tests/helpers/temp-root.ts\` ` +
        `does it for you, and \`aggregate-cut-wiring.test.ts:44-57\` is the pattern to copy where a ` +
        `helper does not reach:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
