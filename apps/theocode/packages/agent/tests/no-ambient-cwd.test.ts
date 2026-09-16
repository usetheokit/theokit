/**
 * B-168 — the guard B-161's plan declared and nobody wrote.
 *
 * B-161 spent four channels and three false claims of closure establishing one invariant: no test
 * hands `buildChatAgent` the repository as its project directory. When a test does, the context it
 * assembles depends on what that tree holds — the rule corpus, a project document, the session store
 * keyed by the path — and the suite's coverage total quietly becomes a property of the machine.
 *
 * The invariant holds on HEAD by nobody having broken it since. This is what keeps it: a future edit
 * that reintroduces the ambient read turns THIS test red instead of turning a coverage number into a
 * mystery three weeks later.
 *
 * It guards against ACCIDENT, not evasion. `cwd: process . cwd()` would pass, and that is fine — the
 * failure this exists to catch is someone reaching for the obvious idiom, which is exactly how all
 * three original sites were written.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url))

/**
 * Every `.ts`/`.tsx` under a package's `tests/`, not only `*.test.ts`. A violation in a helper the
 * tests import reaches the build exactly as one in a test does, and this repository has such helpers
 * (`hooks-test-helpers.ts`). Scanning only test files was the first version and would have missed them.
 */
function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) testFiles(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

describe('no test hands the build the real working directory', () => {
  it('test_no_test_file_passes_the_ambient_cwd_as_a_project_directory', () => {
    const offenders: string[] = []
    const packagesSeen: string[] = []
    let scanned = 0
    for (const pkg of readdirSync(PACKAGES)) {
      const tests = join(PACKAGES, pkg, 'tests')
      let stat
      try {
        stat = statSync(tests)
      } catch {
        continue
      }
      if (!stat.isDirectory()) continue
      packagesSeen.push(pkg)
      for (const file of testFiles(tests)) {
        scanned += 1
        // Comments are stripped first: this guard's own file discusses the idiom, and so does
        // `chat-cwd.test.ts` — which strips comments before counting for the same reason. A guard
        // that fires on prose teaches people to phrase around it instead of to fix the code.
        const source = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        if (/\bcwd:\s*process\.cwd\(\)/.test(source)) {
          offenders.push(file.slice(PACKAGES.length))
        }
      }
    }

    // ANTI-VACUITY. Without this, mutating the root above from `../../` to `../` leaves this test
    // green: it scans zero files and reports zero offenders, forever. A missing root throws; a
    // wrong-but-existing one is silent, which is the failure mode this whole item is about.
    // `registry.test.ts:39-44` carries the same floor for the same reason.
    expect(scanned, 'the scan found no test files — the root is wrong, not the tree clean').toBeGreaterThan(100)
    expect(
      packagesSeen.sort(),
      'a package stopped being scanned, so a violation there would pass unseen',
    ).toEqual(['agent', 'cli', 'shared', 'tui'])

    expect(
      offenders,
      `these tests hand the build the repository, so what they cover depends on what this checkout ` +
        `holds (B-161). Pass a directory of their own — mkdtempSync(join(tmpdir(), '...')) — and, if ` +
        `the test is about operator state, a 'home' of its own too:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
