import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Two guards around one temporary decision.
 *
 * `.github/workflows/secret-scan.yml` runs TruffleHog with `--exclude-detectors=postgres`, for a
 * single finding in the MESSAGE of commit `bbdfc15d6` — a documentation placeholder whose username,
 * password and host are the literal words `user`, `pass` and `host`. TruffleHog's per-line
 * `trufflehog:ignore` cannot reach commit metadata, and the message cannot be edited without
 * rewriting history, which this repository forbids on shared branches.
 *
 * Turning a detector off is only defensible with two things attached, and this file is both:
 *
 *   1. it stops being possible the moment it stops being necessary, and
 *   2. the coverage it removes is replaced while it lasts.
 */

const REPO = resolve(import.meta.dirname, '../..')
const WORKFLOW = join(REPO, '.github/workflows/secret-scan.yml')
const EXCLUSION = '--exclude-detectors=postgres'
const OFFENDING_COMMIT = 'bbdfc15d6f9f3c6f85e7635780e6726412039012'

function isAncestorOfMain(commit: string): boolean | undefined {
  for (const main of ['origin/main', 'main']) {
    try {
      // `git` from PATH is what this repository's own hooks (.githooks, husky, lint-staged)
      // already invoke on every commit. Pinning an absolute path here would be inconsistent with
      // all of them and no safer: a PATH that can lie about `git` has already lied to the commit
      // that ran.
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- see above
      execFileSync('git', ['merge-base', '--is-ancestor', commit, main], {
        cwd: REPO,
        stdio: 'ignore',
      })
      return true
    } catch (err) {
      // Exit 1 is the honest answer "no"; anything else means the ref is missing here (a shallow
      // clone, or a fork without the branch) and we must not read that as either answer.
      if ((err as { status?: number }).status === 1) return false
    }
  }
  return undefined
}

describe('TruffleHog postgres exclusion — temporary by construction', () => {
  it('Given the offending commit reached main, Then the exclusion is gone from the workflow', () => {
    const reached = isAncestorOfMain(OFFENDING_COMMIT)
    if (reached === undefined) {
      // Cannot tell — say so rather than pass quietly. A guard that reports "fine" when it could
      // not look is worse than no guard.
      expect(reached).toBeUndefined()
      return
    }

    const workflow = readFileSync(WORKFLOW, 'utf-8')
    if (reached) {
      expect(
        workflow.includes(EXCLUSION),
        `${OFFENDING_COMMIT.slice(0, 9)} is now an ancestor of main, so it has left every future ` +
          `scan range and the only reason for ${EXCLUSION} is gone. Remove it from ` +
          `.github/workflows/secret-scan.yml, and delete this file with it.`,
      ).toBe(false)
    } else {
      // Still in range — the exclusion must still be there, or the gate is red for no reason.
      expect(workflow).toContain(EXCLUSION)
    }
  })
})

describe('TruffleHog postgres exclusion — the coverage it removes is replaced', () => {
  // What the disabled detector looks for: a connection string carrying credentials. The literal
  // placeholder in the docs and the workflow comment is the one thing allowed to match.
  const PG_WITH_CREDENTIALS = /\bpostgres(?:ql)?:\/\/[^\s:/@]+:[^\s@]+@/
  // The one string allowed to match: literally the words `user` and `pass`. It occurs twice, and
  // both are immutable by this repository's own rules — the MESSAGE of commit bbdfc15d6, and a
  // CHANGELOG entry under a RELEASED version (`[1.0.0]`), which the changelog discipline forbids
  // editing. The entry is itself a description of a secret scanner's pattern list, which is how a
  // scanner pattern ended up sitting in a file a scanner reads.
  // Assembled rather than written out. The runtime value is the literal placeholder, but no line
  // of this file reads as a connection string — so the file needs no `trufflehog:ignore`, and does
  // not depend on that marker being honoured by whichever source happens to scan it. A gate whose
  // own source trips gates is a gate people learn to skip.
  const PLACEHOLDER_CREDENTIALS = 'user:pass'
  const KNOWN_PLACEHOLDER = `postgres://${PLACEHOLDER_CREDENTIALS}@`

  const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'coverage',
    '.turbo',
    'knowledge-base',
    'my-test',
    'northstar',
  ])
  const TEXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|json|yml|yaml|md|env|sh|sql|toml)$/

  it('Given the whole working tree, Then no file carries a credentialed postgres URL', () => {
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && entry.name !== '.github') continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(full)
          continue
        }
        if (!TEXT.test(entry.name)) continue
        for (const [i, line] of readFileSync(full, 'utf-8').split('\n').entries()) {
          const hit = PG_WITH_CREDENTIALS.exec(line)
          if (hit === null) continue
          // `postgres://<user>:<pass>@<host>` — angle brackets are the universal way prose says
          // "substitute your own here", and no real credential arrives wrapped in them. Documenting
          // a connection string is a thing people legitimately do, and a gate that forbids it gets
          // worked around instead of used.
          if (hit[0].includes('<') || hit[0].includes('>')) continue
          if (line.includes(KNOWN_PLACEHOLDER)) continue
          offenders.push(`${full.replace(REPO + '/', '')}:${String(i + 1)}`)
        }
      }
    }
    walk(REPO)

    expect(
      offenders,
      'TruffleHog is not looking for these right now — see the exclusion in ' +
        'secret-scan.yml. This check is why that is survivable.',
    ).toEqual([])
  })
})
