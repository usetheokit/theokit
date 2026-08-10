/**
 * theokit#200 — the guard must not decide the tarball's name by parsing `pnpm pack` stdout.
 *
 * ## The defect
 *
 * It took the LAST non-empty line of stdout as the filename. Locally `pnpm pack` prints just the
 * name, so it worked. In CI the reporter prints a JSON block, whose last line is `}` — so the guard
 * looked for `/tmp/pack-no-workspace-XXXX/}`, `tar` failed to open it, and the catch reported
 * "could not pack". That path is deliberately treated as an UNKNOWN rather than as clean, so every
 * package failed and the release aborted with "6 package(s) would publish an uninstallable
 * manifest" — a false accusation that blocked a legitimate publish.
 *
 * The bug is in the ORACLE, not in the packages: nothing was wrong with any manifest.
 *
 * ## Why the fix is a directory diff
 *
 * `pnpm pack --pack-destination <dir>` writes exactly one tarball per invocation. The directory is
 * the fact; stdout is a reporter's rendering of it, and a rendering is free to change between
 * versions — which is precisely what happened. Diffing the directory has no format to break.
 */
import { describe, expect, it } from 'vitest'

import { newTarball } from '../scripts/check-pack-no-workspace.mjs'

describe('theokit#200 — resolving the packed tarball', () => {
  it('returns the file that appeared', () => {
    expect(newTarball(['old.tgz'], ['old.tgz', 'theokit-agents-7.5.0.tgz'])).toBe(
      'theokit-agents-7.5.0.tgz',
    )
  })

  it('works on an empty destination', () => {
    expect(newTarball([], ['theokit-http-1.0.0.tgz'])).toBe('theokit-http-1.0.0.tgz')
  })

  it('ignores non-tarball files that appear alongside', () => {
    expect(newTarball([], ['notes.txt', 'theokit-sdk-4.41.0.tgz'])).toBe('theokit-sdk-4.41.0.tgz')
  })

  it('throws when nothing appeared, rather than returning a name that does not exist', () => {
    // The old code's failure mode: it produced a plausible-looking path and let `tar` discover the
    // problem, which surfaced as "could not pack" and read as a manifest defect. An empty result is
    // a fault in the guard and must say so.
    expect(() => newTarball(['old.tgz'], ['old.tgz'])).toThrow(/no tarball/i)
  })

  it('throws when more than one appeared, instead of guessing', () => {
    expect(() => newTarball([], ['a-1.0.0.tgz', 'b-1.0.0.tgz'])).toThrow(/expected exactly one/i)
  })
})
