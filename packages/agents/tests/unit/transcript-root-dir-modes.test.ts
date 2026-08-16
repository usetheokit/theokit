/**
 * T2.4 — every directory this package creates under the transcript root is born private.
 *
 * ## The defect
 *
 * `assertSecureModes` refuses a group- or world-writable directory under `~/.theokit`, because that
 * tree decides which commands may run: a directory others can write is a way to grant yourself that.
 * The check was right. The LAYOUT was wrong — three separate functions created directories in that
 * same tree with a bare `mkdirSync(dir, { recursive: true })`, so under `umask 002` they were born
 * `0775` and the store's own check failed on a tree the store's own code had produced.
 *
 * The package already wrote this diagnosis while fixing a sibling
 * (`config/trust-store.ts:157-161`): *"the mode argument is a NO-OP on a directory that already
 * exists, and this one is shared with the SDK's transcript root — whoever creates it first sets the
 * permissions."* Whoever creates it first is whichever of these ran first, which is why fixing one
 * of them fixes nothing: the guarantee has to hold for ALL of them, and that is what this file
 * asserts.
 *
 * ## Why `ensureSecureDir` rather than a mode argument
 *
 * Parsimony rung 4 (`rules/parsimony-ladder.md`) — the helper is already installed, in this same
 * package, and it does strictly more than a `mode:` option: it also REPAIRS a pre-existing wrong
 * mode and throws when the repair does not hold. These two call sites are low-frequency (a pointer
 * write, a sidecar write), so the extra `stat` costs nothing that matters. The per-append hot path
 * in the SDK is the one place that takes the creation-time-only form instead.
 */
import { chmodSync, mkdtempSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { recordProjectDir } from '../../src/session/project-index.js'

const WRITABLE_BY_OTHERS = 0o022

describe('directories created under the transcript root', () => {
  it('test_recordProjectDir_creates_a_private_directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'root-modes-'))
    recordProjectDir('/some/project', root)

    const created = join(root, 'projects')
    const mode = statSync(created).mode & 0o777
    expect(
      mode & WRITABLE_BY_OTHERS,
      `born ${mode.toString(8)} — assertSecureModes refuses this tree, and this package created it`,
    ).toBe(0)
  })

  it('test_a_preexisting_loose_directory_is_repaired_rather_than_accepted', () => {
    // The case a `mode:` argument cannot reach: `mkdirSync`'s mode is a no-op on a directory that
    // already exists, which is exactly how the shared root ends up loose — another process got
    // there first. `ensureSecureDir` chmods it back.
    //
    // Asserted on the LEAF — the directory this function creates — and deliberately not on its
    // ancestors. Measured (`@theokit/sdk` internal/auth/credential-store.ts): `assertSecureModes`
    // reads exactly ONE directory, the immediate parent of the file, and never walks up. Repairing
    // ancestors would mean chmod'ing directories this package did not create, on a path heading
    // toward `$HOME` — a far larger behaviour than the check demands, and not one to introduce as a
    // side effect of writing a sidecar.
    // The leaf is named by `encodeProjectDir`'s hash, so it is created by the function itself rather
    // than guessed here — then loosened, the way another process would leave it.
    const root = mkdtempSync(join(tmpdir(), 'root-modes-'))
    recordProjectDir('/some/project', root)
    const [leafName] = readdirSync(join(root, 'projects'))
    const leaf = join(root, 'projects', leafName!)
    chmodSync(leaf, 0o777)

    recordProjectDir('/some/project', root)

    const mode = statSync(leaf).mode & 0o777
    expect(mode & WRITABLE_BY_OTHERS, 'a loose pre-existing directory must not be accepted').toBe(0)
  })

  it('test_recordProjectDir_still_swallows_failure', () => {
    // Its docblock is explicit: this is an optimisation, and "a throw here would turn a missing
    // optimisation into a failed run". Hardening the mode must not change that contract.
    expect(() => {
      recordProjectDir('/some/project', '\0not-a-path')
    }).not.toThrow()
  })
})
