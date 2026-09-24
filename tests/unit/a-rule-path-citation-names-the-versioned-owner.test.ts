import { readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

/**
 * B-285 — a citation pointing at a path this repository does not version.
 *
 * `.claude/` is gitignored (`.gitignore:110`, 0 tracked files), so a versioned document citing
 * `rules/<name>.md` points a reader at nothing they received. Measured: 257 such citations across 32
 * rule names. Most are legitimate — they name a rule the installed kit ships, and the kit documents
 * `rules/` as where its contracts live.
 *
 * Two are not. When this repository ALSO versions the same document under `docs/program/<name>.md`,
 * the `rules/` form is stale rather than external: commit `8d4b46130` created that copy and its own
 * message states *"the `.claude/` copies remain because the local tooling reads rules from that path;
 * `docs/` wins when they disagree"*. So the checkable rule is narrow and certain — **cite the copy
 * this repository versions, when it versions one.**
 *
 * ## What this checks, and the class it deliberately does not
 *
 * A citation of `rules/<name>.md` for which `docs/program/<name>.md` is tracked. That is decidable
 * from the index alone: either the owner is versioned or it is not.
 *
 * A citation of `rules/testing.md` is NOT flagged. No versioned copy exists, the kit ships that rule,
 * and rewriting it would point the reader at a file this repository does not have. Flagging all 257
 * would be a gate somebody switches off, which is the failure mode
 * `an-adr-path-citation-names-the-real-file.test.ts` records for an 81% flag rate.
 *
 * ## Why a baseline instead of a wider fix
 *
 * `rules/northstar-app.md` is the same defect — 14 citations, and `docs/program/northstar-app.md` is
 * tracked — and it is NOT this change's scope. Widening an item that is already executing is what
 * `autonomy-envelope.md § Scope grew during measurement` forbids, so it is listed in `BASELINE`
 * below: still counted, still named, and failing the moment its owner document disappears.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// git by absolute path, never through PATH — `sonarjs/no-os-command-from-path` is right that a
// writable PATH entry decides which binary runs, and this test asks git which files are versioned.
const GIT = '/usr/bin/git'

/**
 * A cited rule path, in every prefix form measured in this tree: bare (`rules/x.md`), kit-relative
 * (`.claude/rules/x.md`) and file-relative (`../../../.claude/rules/x.md`).
 *
 * The lookbehind is load-bearing and `test_the_lookbehind_excludes_a_suffixed_directory` proves it:
 * without it, `_kit-rules/x.md` matches and the kit's own correct citations read as broken.
 */
// `[./]*` for the relative prefix rather than `(?:\.{1,2}\/)*`: a quantifier nested inside a star is
// what `security/detect-unsafe-regex` flags, and it is right — that shape backtracks catastrophically
// on a long run of dots. A star over a two-character class is linear, and over-accepting `.../` costs
// nothing because the literal `rules/` still has to follow.
const CITATION = /(?<![\w.-])[./]*(?:\.claude\/)?rules\/([a-z0-9._-]+\.md)/g

/** Rule names this repository versions under `docs/program/`, so the `rules/` form is stale. */
function versionedOwners(): Set<string> {
  return new Set(
    execFileSync(GIT, ['ls-files', '--', 'docs/program/*.md'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .map((p) => basename(p)),
  )
}

/**
 * Not this repoint's scope, and not forgiven.
 *
 * Each entry names the versioned document that SHOULD be cited instead, and
 * `test_every_baseline_entry_names_the_owner_it_defers` proves that document is on disk. The owner
 * path rather than a tracker id on purpose: an id is unverifiable from the repository and outlives
 * the tracker that issued it, which is the same staleness this whole file exists to refuse.
 */
const BASELINE: ReadonlyMap<string, string> = new Map([
  ['northstar-app.md', 'docs/program/northstar-app.md — 14 citations, deferred to its own change'],
])

describe('a rule path citation names the versioned owner (B-285)', () => {
  const owners = versionedOwners()

  it('test_the_versioned_owner_set_was_found', () => {
    // Guards the check. A glob that stopped matching would leave the assertion below comparing
    // against an empty set and reporting every citation as fine — a green over nothing measured.
    expect(
      owners.has('three-target-parity.md'),
      'docs/program/three-target-parity.md is not tracked, so this check has no subject',
    ).toBe(true)
  })

  it('test_the_lookbehind_excludes_a_suffixed_directory', () => {
    // Replaces an acceptance criterion that could not go RED: the `_kit-rules/` class has ZERO
    // occurrences in this tree, so asserting a bare grep still reports it proves nothing. The
    // lookbehind is proven here instead, on input this test controls.
    const suffixed = '_kit-rules/three-target-parity.md'
    expect(
      [...suffixed.matchAll(CITATION)],
      `${suffixed} must not read as a rules/ citation`,
    ).toEqual([])
    for (const form of [
      'rules/three-target-parity.md', // rule-citation-ok: fixture proving the bare form is seen
      '.claude/rules/three-target-parity.md', // rule-citation-ok: fixture, kit-relative form
      '../../../.claude/rules/three-target-parity.md', // rule-citation-ok: fixture, file-relative form
    ]) {
      expect([...form.matchAll(CITATION)].length, `${form} must be seen`).toBe(1)
    }
  })

  it('test_every_baseline_entry_names_the_owner_it_defers', () => {
    for (const [name, reason] of BASELINE) {
      const owner = `docs/program/${name}`
      expect(reason, `baseline entry ${name} must name the versioned owner it defers to`).toContain(
        owner,
      )
      // The deferral is only honest while the owner exists. If `docs/program/northstar-app.md` is
      // ever deleted, the `rules/` citations stop being stale and this entry stops being a deferral —
      // so the entry must fail rather than keep excusing a class whose premise is gone.
      expect(owners.has(name), `${owner} is not tracked, so deferring to it excuses nothing`).toBe(
        true,
      )
    }
  })

  it('test_no_versioned_file_cites_a_rule_path_whose_owner_this_repository_versions', () => {
    // Tracked AND untracked-but-not-ignored: a file added in the working tree is exactly where a
    // fresh citation appears, and `ls-files` alone lists only what git already knows.
    const listed = [
      execFileSync(GIT, ['ls-files', '--', '*.ts', '*.tsx', '*.mjs', '*.md'], {
        cwd: repoRoot,
        encoding: 'utf8',
      }),
      execFileSync(
        GIT,
        ['ls-files', '--others', '--exclude-standard', '--', '*.ts', '*.tsx', '*.mjs', '*.md'],
        { cwd: repoRoot, encoding: 'utf8' },
      ),
    ].join('\n')

    const scanned = listed
      .split('\n')
      .filter(Boolean)
      // A released CHANGELOG entry is an immutable record. `CLAUDE.md § 6` forbids editing one, and
      // it was correct when published — the path it cites resolved under the tooling of that day.
      // This cannot be waived with the inline marker below, because adding the marker IS the edit.
      .filter((p) => basename(p) !== 'CHANGELOG.md')

    const stale: string[] = []
    for (const path of scanned) {
      let src: string
      try {
        src = readFileSync(join(repoRoot, path), 'utf8')
      } catch {
        continue
      }
      for (const [index, line] of src.split('\n').entries()) {
        // A line may name the stale path on purpose — this test's own docblock does. The marker
        // needs a reason after the colon; a bare opt-out does not count, the same rule
        // `rules/english-only.md` applies for the same reason.
        if (/rule-citation-ok:\s*\S/.test(line)) continue
        for (const m of line.matchAll(CITATION)) {
          const name = m[1]
          if (!owners.has(name) || BASELINE.has(name)) continue
          stale.push(
            `${path}:${String(index + 1)} cites ${m[0]}, but this repository versions docs/program/${name}`,
          )
        }
      }
    }

    expect(
      stale,
      'a versioned file points a reader at an unversioned rules/ path whose owner this repository ' +
        `versions under docs/program/. Repoint each one:\n${stale.join('\n')}`,
    ).toEqual([])
  })
})
