/**
 * The user layer of instructions — usetheoai-lab/TheoCode#65.
 *
 * Configuration and credentials have had a user layer since the beginning (`~/.theocode/config.toml`,
 * `~/.theocode/auth.json`); instructions never got one. A preference that belongs to the PERSON —
 * "answer in Portuguese", "run the suite before telling me it works" — had nowhere to live but a
 * project `AGENTS.md`, which commits it into a shared repository where it steers a teammate's agent
 * too.
 *
 * Two properties carry the design and both are asserted below.
 *
 * NOT TRUST-GATED. The project chain is, and must be: an untrusted repository's `AGENTS.md` is a
 * prompt-injection vector, which is the whole reason `posture.allows.agentsMd` exists. A file under
 * `~/.theocode/` is the operator's own, on their own machine — gating it would be answering the
 * wrong question. `settingSourcesFor` already encodes exactly this asymmetry by keeping `user: true`
 * through an untrusted directory.
 *
 * CONFINED TO ITS OWN ROOT. Imports in the user file resolve against `~/.theocode`, not against the
 * repository — a user file importing `@shared.md` means the one next to it. Pointing the expansion
 * at the project root would make the operator's own imports fail while they are inside a repo, and
 * make them mean something different in each one.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadUserAgentsMd, userAgentsMdPath } from '../../src/context/user-agents-md.js'

let home: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'theocode-home-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

function writeUserDoc(text: string): void {
  // #72 — the directory comes from the path the loader will read, not from a name spelled here.
  // Both are valid locations now, and pinning one would test the fixture rather than the loader.
  const path = userAgentsMdPath(home)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

describe('loadUserAgentsMd', () => {
  it('test_an_absent_file_is_the_common_case_and_yields_nothing', () => {
    // Most operators will never write one. An absent file must not warn, throw, or leave a marker in
    // the prompt — it is the default state, not an error.
    expect(loadUserAgentsMd(home)).toBe('')
  })

  it('test_the_user_file_is_read', () => {
    writeUserDoc('Always answer in Portuguese.')
    expect(loadUserAgentsMd(home)).toContain('Always answer in Portuguese.')
  })

  it('test_an_import_resolves_against_the_user_directory_not_the_repository', () => {
    // The load-bearing half: `expandInstructionImports` confines to a root, and pointing it at the
    // project would make an operator's own `@shared.md` unreadable from inside a repo.
    writeUserDoc('See @shared.md for the rest.')
    writeFileSync(join(dirname(userAgentsMdPath(home)), 'shared.md'), 'shared preference')
    expect(loadUserAgentsMd(home)).toContain('shared preference')
  })

  it('test_a_traversal_out_of_the_user_directory_is_refused', () => {
    // Confinement is not a formality just because the file is the operator's: an import is expanded
    // into the model's prompt, and the state directory is one other tools also write into.
    const outside = join(home, 'secret.md')
    writeFileSync(outside, 'SHOULD-NOT-APPEAR')
    writeUserDoc('Read @../secret.md now.')
    expect(loadUserAgentsMd(home, () => {})).not.toContain('SHOULD-NOT-APPEAR')
  })

  it('test_a_blank_file_contributes_nothing_to_compose', () => {
    // Anti-vacuity for the caller: an empty user file must not produce a separator with nothing
    // around it, which would show up in the prompt as an unexplained blank section.
    writeUserDoc('   \n\n  ')
    expect(loadUserAgentsMd(home)).toBe('')
  })
})
