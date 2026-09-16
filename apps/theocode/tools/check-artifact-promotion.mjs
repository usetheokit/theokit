#!/usr/bin/env node
/**
 * B-064 / ADR 0002 — a cycle artifact must not exist in two homes with two different contents.
 *
 * `docs/` is where an artifact lives once it is worth keeping; `.claude/records/` is the working
 * area it is produced in. Both are legitimate. What is not legitimate is the SAME file name in
 * both with divergent bodies, because then "the plan" has two answers and whichever one a reader
 * opens is luck. Measured on 2026-08-10: that had already happened to
 * `english-only-completion-plan.md`, and the stale copy was the one a session resolved as active.
 *
 * Deliberately narrow. It does NOT demand that every working file be promoted: drafts, intake logs
 * and in-flight notes belong in the working area, and a check that demanded promotion of all of
 * them would push people to stop using the working area at all — which is the failure mode this
 * repository already has, one directory over.
 *
 * ## Where it can and cannot do work, stated because it was not
 *
 * Measured 2026-09-10: every one of the six directories this constant named was absent. The
 * working side still said `.claude/knowledge-base/`, a location this project renamed to
 * `.claude/records/`; the published side (`docs/plans`, `docs/reviews`, `docs/adr`) was deleted
 * wholesale in 41732e6. `markdownIn` swallowed each ENOENT and returned `[]`, so the gate printed
 * "no divergent duplicates" and exited 0 in the `npm run lint` chain having opened no file. The
 * green was read as evidence — which is the failure this checker's own header warns about, run on
 * the checker itself.
 *
 * The harder half of that finding is structural and is not fixed by re-anchoring the paths.
 * `.claude/` is gitignored — the maintainers' scaffolding, not product code — so on a CI runner
 * the working side of every pair is absent BY CONSTRUCTION. This gate therefore does real work on
 * a developer's machine and none at all in CI, where it can only ever report that it compared
 * nothing.
 *
 * That is not a reason to exit 1 there: a permanently red lint job is a gate everyone learns to
 * scroll past, which is the same defect in the other direction. It is a reason for the output to
 * SAY SO. Every run now ends with a census — how many pairs were compared, how many files, and
 * which directories were absent — and a run that compared nothing prints `SKIPPED`, never a clean
 * line. That is the treatment `check-codex-parity.mjs` already gives its own gitignored input:
 * "A checker that cannot be told apart from one that read nothing is the defect."
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'

/**
 * The pairs, re-anchored 2026-09-10 on the working area this project actually writes to.
 *
 * `adrs` is deliberately NOT declared: neither `.claude/records/adrs` nor `docs/adr` exists here
 * (the two ADRs that lived in the latter were deleted in 41732e6), and a pair naming a directory
 * that exists on neither side is precisely the stale configuration this file was found carrying.
 * Declaring one costs a line the day an ADR is written; declaring it now costs the constant its
 * only property a test can check.
 */
export const PAIRS = [
  ['.claude/records/plans', 'docs/plans'],
  ['.claude/records/reviews', 'docs/reviews'],
]

/**
 * The markdown in a directory, or `null` when the directory is not there.
 *
 * The `null` is the whole point of this function's existence. It used to `catch { return [] }`,
 * which made "the directory does not exist", "the directory is empty" and "the directory could not
 * be read" a single, silent answer that every caller downstream reads as "nothing to compare".
 *
 * Anything that is NOT an absence is rethrown. A permission error or a path that turned out to be
 * a file are conditions a human has to see; swallowing them is how a checker keeps reporting clean
 * after it stopped being able to look.
 */
async function listMarkdown(dir, readDir) {
  try {
    return (await readDir(dir)).filter((f) => f.endsWith('.md'))
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

/**
 * The decision, separated from the process it used to be welded to, and now reporting what it
 * looked at as well as what it found.
 *
 * Rewritten 2026-09-10: this file ran its whole check at module top level and called
 * `process.exit`, so importing it WAS running it. That is why it shipped without a test while
 * sitting in the `npm run lint` chain that gates every build, and it is the shape the finding
 * objected to: a checker that mis-globs, throws early, or returns 0 over an empty match set passes
 * the gate having inspected nothing.
 *
 * `readDir` and `readFileText` are injected for the same reason the eight tested checkers inject
 * theirs: a test must be able to state a tree that MUST fail, and asserting on a real directory
 * would make the test a description of this repository's current contents rather than of the rule.
 *
 * Returns the problems AND the census, because the count of files actually compared is the only
 * thing that separates "clean" from "never looked".
 */
export async function auditPairs(
  pairs = PAIRS,
  { readDir = readdir, readFileText = (p) => readFile(p, 'utf8') } = {},
) {
  const problems = []
  const inspected = []

  for (const [working, published] of pairs) {
    const inWorking = await listMarkdown(working, readDir)
    const inPublished = await listMarkdown(published, readDir)

    if (inWorking === null || inPublished === null) {
      const absent = [inWorking === null && working, inPublished === null && published].filter(
        Boolean,
      )
      inspected.push({ working, published, compared: false, absent, files: 0 })
      continue
    }

    const published_ = new Set(inPublished)
    let files = 0
    for (const name of inWorking) {
      if (!published_.has(name)) continue
      files += 1
      const [a, b] = await Promise.all([
        readFileText(join(working, name)),
        readFileText(join(published, name)),
      ])
      if (a !== b) {
        problems.push(
          `${name}\n` +
            `    working  : ${join(working, name)}\n` +
            `    published: ${join(published, name)}\n` +
            `    The two differ. ${published} is authoritative (ADR 0002) — copy it over the working\n` +
            `    copy, or delete the working copy. A reader who opens the wrong one is reading a\n` +
            `    version of the truth nobody chose.`,
        )
      }
    }
    inspected.push({ working, published, compared: true, absent: [], files })
  }

  return {
    problems,
    inspected,
    comparedPairs: inspected.filter((p) => p.compared).length,
    comparedFiles: inspected.reduce((n, p) => n + p.files, 0),
  }
}

/** The problems alone, for callers that only need the verdict. */
export async function divergentDuplicates(pairs = PAIRS, io = {}) {
  return (await auditPairs(pairs, io)).problems
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { problems, inspected, comparedPairs, comparedFiles } = await auditPairs()

  if (problems.length > 0) {
    process.stderr.write(
      `\ncheck-artifact-promotion: ${problems.length} artifact(s) exist in both homes and disagree.\n\n`,
    )
    for (const p of problems) process.stderr.write(`  ${p}\n\n`)
    process.exit(1)
  }

  const absent = inspected
    .filter((p) => !p.compared)
    .map((p) => `    ${p.working} <-> ${p.published} — absent: ${p.absent.join(', ')}`)

  if (comparedPairs === 0) {
    // Printed even under `--quiet`. A run that compared nothing must not be mistakable for a run
    // that compared everything and found nothing, which is the whole of the finding this replaced.
    process.stdout.write(
      'check-artifact-promotion: SKIPPED — no declared pair could be compared.\n' +
        `${absent.join('\n')}\n` +
        '    `.claude/` is not versioned, so the working side is absent in any fresh checkout and\n' +
        '    on every CI runner. This gate guards a developer working tree; here it checked nothing.\n',
    )
  } else if (!process.argv.includes('--quiet')) {
    process.stdout.write(
      `check-artifact-promotion: no divergent duplicates ` +
        `(${comparedFiles} file name(s) in both homes, across ${comparedPairs}/${inspected.length} pair(s))\n` +
        (absent.length > 0 ? `${absent.join('\n')}\n` : ''),
    )
  }
}
