#!/usr/bin/env node
/**
 * Fail when a test asserts that something throws without saying WHAT.
 *
 * `rules/error-handling.md` § 2 requires errors to be explicit and typed. Nothing checked that the
 * TESTS honour it, which is the inverted shape of a defect this repository has paid for before: a
 * principle written down with no mechanism reads exactly like an enforced one.
 *
 * ## What a bare assertion costs
 *
 * `expect(fn).toThrow()` is satisfied by ANY throw — including a `TypeError` from an unrelated null
 * deref. So a test guarding a typed refusal keeps reporting green after that refusal has decayed
 * into a crash, and the decay is invisible precisely where the contract mattered. Measured
 * 2026-09-05: two such assertions in this repository, both guarding fail-loud contracts —
 * `config/memory-default.test.ts` (a non-boolean must be REJECTED, not coerced) and
 * `composition/agent-spec.test.ts` (an unknown tool name must fail at declaration).
 *
 * The upstream `theokit-sdk` gate that inspired this one exists because two of its tests had been
 * typed with the shape of each other's `ZodError`, and only running them revealed it. Its message
 * tells the author to MEASURE which error arrives — which is the half that makes the gate useful
 * rather than merely strict, and is repeated below.
 *
 * ## What it does NOT flag
 *
 * `.not.toThrow()` — there is no error to name when the assertion is that none arrives.
 *
 * ## The scope, which was declared wider than it was
 *
 * Measured 2026-09-10: `ROOTS` named `tools` while the pattern was `/\.test\.tsx?$/`, and every
 * test file under `tools/` is `.mjs` — eleven of them. The declared root contributed zero files on
 * every run, so a bare `toThrow()` written in a tools test was invisible while the identical
 * assertion in `packages/` was flagged. The walk found nothing, which is indistinguishable from
 * finding nothing wrong.
 *
 * That is the same rot `check-english-only.mjs` recorded when `.mts`/`.cts` had to be added to its
 * `EXTS` after their absence hid real violations, and it is why the pattern and the walk are
 * exported and pinned by tests now: a guard's silence is only evidence when you know what it looks
 * at. The per-root census printed on every run is the second half of that — a declared root
 * contributing zero files says so out loud instead of passing quietly.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const ROOTS = ['packages', 'tools']

/**
 * This guard's own two files, skipped for the reason `check-english-only.mjs` skips its own:
 * "a detector that flags its own vocabulary is unusable."
 *
 * Widening the pattern to `.mjs` — the fix for the declared-but-empty `tools` root — made the
 * checker read its own test file for the first time and report five hits in it. All five are
 * STRING LITERALS: the fixtures that assert `expect(fn).toThrow()` is flagged, plus a line quoting
 * this header. There is no way to test the predicate without writing the form it detects, so the
 * exemption is the file, named explicitly rather than inferred from a pattern.
 *
 * The cost is stated: a genuine bare assertion inside these two files would not be flagged. It is
 * the narrowest exemption that lets the guard have a test at all, and it is two paths, not a rule.
 */
export const SELF = new Set([
  'tools/check-typed-error-assertions.mjs',
  'tools/check-typed-error-assertions.test.mjs',
])

/**
 * A test file, in every extension this repository writes tests in.
 *
 * `.mjs`/`.cjs` are here because `tools/` is a declared root and its eleven tests are all `.mjs`;
 * see the header. The list mirrors `check-english-only.mjs`'s `EXTS` minus `.mts`/`.cts`, which no
 * test in this repository uses — adding an extension nobody writes would be a scope claim as empty
 * as the one this fixes.
 */
const TEST = /\.test\.(?:tsx?|mjs|cjs)$/

/** A `toThrow` / `toThrowError` / `rejects.toThrow` with an EMPTY argument list. */
const BARE = /(?<!not\.)\btoThrow(?:Error)?\(\s*\)/

/**
 * The decision, as a function of one line.
 *
 * Extracted 2026-09-10. Everything below used to run at module top level and call `process.exit`,
 * so importing this file WAS running the check — which is why a gate in the `npm run lint` chain
 * shipped without a test. A checker that mis-globs or matches nothing still exits 0, and the green
 * build is read as evidence that the rule holds.
 *
 * Comments are stripped first: this guard's own prose contains the literal it searches for, and so
 * does any comment explaining why an assertion was tightened. Flagging those makes the check fire
 * on the documentation of its own rule.
 */
export function isBareThrowAssertion(line) {
  const code = String(line).replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '')
  return BARE.test(code)
}

/** The other decision: whether a file name is one this guard is supposed to read. */
export function isTestFile(name) {
  return TEST.test(name)
}

/**
 * Every test file under `dir`, recursively. Yields nothing when `dir` does not exist.
 *
 * Exported for the same reason `isBareThrowAssertion` is: it decides half the verdict. A test over
 * the predicate cannot see a walk that matches no file, and that is exactly the state this was
 * found in.
 */
export function* testFilesUnder(dir, io = { readDir: readdirSync, stat: statSync }) {
  let entries
  try {
    entries = io.readDir(dir)
  } catch (err) {
    if (err?.code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    const path = join(dir, entry)
    if (io.stat(path).isDirectory()) yield* testFilesUnder(path, io)
    else if (isTestFile(entry)) yield path
  }
}

/** Every bare assertion under the declared roots, plus what each root contributed. */
export function scan(roots = ROOTS) {
  const found = []
  const census = []
  for (const root of roots) {
    let files = 0
    for (const path of testFilesUnder(root)) {
      if (SELF.has(path)) continue
      files += 1
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // A line that only TALKS about the bare form (this file's own prose, or a comment
          // explaining why an assertion was tightened) is not an assertion.
          if (isBareThrowAssertion(line)) found.push(`${path}:${i + 1}: ${line.trim().slice(0, 100)}`)
        })
    }
    census.push({ root, files })
  }
  return { found, census }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { found, census } = scan()

  if (found.length > 0) {
    process.stderr.write(
      'Assertions that something throws, without saying what:\n\n' +
        found.map((f) => `  ${f}\n`).join('') +
        '\nAny throw satisfies a bare `toThrow()`, so this passes on a crash for an unrelated reason\n' +
        'and keeps passing after the typed refusal it guards has decayed into one.\n\n' +
        'MEASURE which error arrives — run the case and read it — then assert that class or a regex\n' +
        'over its message. Do not infer the type from what the code looks like it should raise.\n',
    )
    process.exit(1)
  }

  const empty = census.filter((c) => c.files === 0)
  if (empty.length > 0) {
    // Printed even under `--quiet`, and non-fatal. A declared root that matched no file is the
    // defect this checker was found carrying; it is worth a line on every run, and it is not worth
    // a red build in a checkout that legitimately has no `packages/` yet.
    process.stderr.write(
      `typed error assertions: ${empty.length} declared root(s) contributed no test file — ` +
        `${empty.map((c) => c.root).join(', ')}. Silence from a root that cannot match is not evidence.\n`,
    )
  }

  if (!process.argv.includes('--quiet')) {
    process.stdout.write(
      `typed error assertions: clean (${census.map((c) => `${c.root}: ${c.files}`).join(', ')})\n`,
    )
  }
}
