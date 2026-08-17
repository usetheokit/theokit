import { execFileSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

/**
 * The read-only study zone must not be in git — the rule the repository already declares.
 *
 * ## The rule, and the state that contradicted it
 *
 * `reference-provenance.md` § 1 says `knowledge-base/references/**` and
 * `knowledge-base/tools/**` are "never versioned — `.gitignore` excludes both". `.gitignore` does
 * exclude them. But **ten of those paths were already tracked as submodule gitlinks** (mode
 * `160000`), and `.gitignore` has no effect on an entry that is already in the index.
 *
 * There was no `.gitmodules` to go with them, so every `git submodule` walk in CI ended with
 * `fatal: No url found for submodule path ''` and exit 128.
 * The CodeQL job's cleanup step is where it surfaced — as a warning nobody had reason to read,
 * inside a job that was already failing for an unrelated reason.
 *
 * ## Why this is a test and not just a cleanup commit
 *
 * The zone is repopulated by the discovery cycle: a future `/discover-plan` clones peer projects back
 * into it. A clone that carries its own `.git` becomes a gitlink again the moment someone runs
 * `git add -A`, and the licence of every one of those third-party trees would be recorded in this
 * repository's history — which is precisely the legal problem § 1 exists to prevent, not a style
 * preference.
 */

const ZONE_PREFIXES = ['knowledge-base/references/', 'knowledge-base/tools/']

/** Every tracked path, with its index mode. */
function trackedEntries(): { mode: string; path: string }[] {
  // `git` from PATH: this test asks the index of the repository it runs in.
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- reads the local index only
  const out = execFileSync('git', ['ls-files', '--stage'], { encoding: 'utf8', maxBuffer: 1 << 28 })
  return out
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => {
      const [meta, path] = l.split('\t')
      return { mode: meta!.split(' ')[0]!, path: path! }
    })
}

describe('the read-only study zone stays out of git (reference-provenance.md § 1)', () => {
  it('test_no_file_under_the_study_zone_is_tracked', () => {
    const tracked = trackedEntries().filter((e) =>
      ZONE_PREFIXES.some((prefix) => e.path.startsWith(prefix)),
    )
    expect(
      tracked.map((e) => `${e.mode} ${e.path}`),
      'the study zone is third-party material; tracking it records their licences in this history',
    ).toEqual([])
  })

  it('test_no_submodule_gitlink_exists_without_a_gitmodules_entry', () => {
    // Mode `160000` is a gitlink. One with no `.gitmodules` entry is not a submodule — it is an
    // accident that makes every `git submodule` walk exit 128, and it is how the zone got tracked.
    const gitlinks = trackedEntries().filter((e) => e.mode === '160000')
    if (gitlinks.length === 0) return

    let gitmodules = ''
    try {
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- reads a tracked file
      gitmodules = execFileSync('git', ['show', 'HEAD:.gitmodules'], { encoding: 'utf8' })
    } catch {
      gitmodules = ''
    }
    for (const link of gitlinks) {
      expect(
        gitmodules.includes(link.path),
        `${link.path} is a gitlink with no .gitmodules entry — every git submodule walk fails on it`,
      ).toBe(true)
    }
  })
})
