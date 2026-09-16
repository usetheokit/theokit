/**
 * Which root this product claims on its own, and which it refuses to.
 *
 * The claim cannot be unconditional or it would claim `.claude` the moment an operator points us
 * there, defeating the marker entirely. It cannot be absent either: every existing installation has
 * a `~/.theokit/projects` full of our transcripts and no marker, and refusing those would turn
 * retention off for everyone on upgrade — the silent non-collection this whole line of work is
 * about, delivered by the fix for it.
 *
 * So the rule is historical rather than clever: the BUILT-IN DEFAULT root is ours by fact, and
 * anything else has to be claimed deliberately by whoever pointed us at it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { builtInDefaultRoot, claimDefaultRoot } from '../../../src/session/gc/root-claim.js'
import { rootIsOurs } from '../../../src/session/gc/root-ownership.js'

const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

function scratch(): { projects: string } {
  const base = mkdtempSync(join(tmpdir(), 'theocode-claim-'))
  roots.push(base)
  const projects = join(base, 'projects')
  mkdirSync(projects, { recursive: true })
  return { projects }
}

describe('claimDefaultRoot', () => {
  it('test_the_default_root_is_claimed_so_an_upgrade_keeps_collecting', () => {
    // The migration case, and the one that matters most: an installation that predates the marker.
    const { projects } = scratch()

    claimDefaultRoot(projects, projects)

    expect(rootIsOurs(projects)).toBe(true)
  })

  it('test_a_root_the_operator_pointed_us_at_that_already_holds_transcripts_is_not_claimed', () => {
    // The `.claude` case. Consent is theirs to give, and giving it on their behalf is exactly what
    // the marker exists to prevent.
    //
    // NON-EMPTY on purpose. An empty custom root IS claimed — the operator renamed our directory and
    // we are the ones creating it — so emptiness cannot carry this assertion. What separates the two
    // is whether something else already wrote there.
    const { projects } = scratch()
    mkdirSync(join(projects, '-home-someone-else-a-project'), { recursive: true })

    claimDefaultRoot(projects, builtInDefaultRoot('/somewhere/else'))

    expect(rootIsOurs(projects)).toBe(false)
  })

  it('test_an_already_claimed_root_stays_claimed', () => {
    const { projects } = scratch()
    claimDefaultRoot(projects, projects)
    claimDefaultRoot(projects, projects)

    expect(rootIsOurs(projects)).toBe(true)
  })

  it('test_a_foreign_marker_is_never_overwritten', () => {
    // Anti-vacuity in the safe direction: claiming must not be a way to take a root from whoever
    // marked it first, even when it is the default path.
    const { projects } = scratch()
    writeFileSync(join(dirname(projects), '.theocode-collector.json'), '{"product":"other"}')

    claimDefaultRoot(projects, projects)

    expect(rootIsOurs(projects)).toBe(false)
  })

  it('test_the_default_is_the_BUILT_IN_path_and_not_whatever_the_environment_says', () => {
    // The bug this file could not see. `claimDefaultRoot(root, projectsRoot())` compares a value
    // with ITSELF, because projectsRoot() already honours THEOKIT_HOME — so every root an operator
    // pointed us at was claimed, which is the one thing the marker exists to prevent.
    //
    // Every test above passed both arguments explicitly and was blind to it. It was caught by running
    // the built binary against a scratch home, which claimed the scratch directory on the spot and
    // left a marker there.
    const home = '/somewhere/else'

    expect(builtInDefaultRoot(home)).toBe(join(home, '.theokit', 'projects'))
    expect(builtInDefaultRoot(home)).not.toContain('scratch')
  })

  it('test_a_non_empty_root_AT_the_default_path_is_still_claimed', () => {
    // The migration, and the other side of the case above: the same non-empty shape is claimed when
    // it IS our default, because those transcripts are ours by history. Without this the upgrade
    // would switch retention off for every existing installation.
    const { projects } = scratch()
    mkdirSync(join(projects, '-home-op-a-project'), { recursive: true })

    claimDefaultRoot(projects, projects)

    expect(rootIsOurs(projects)).toBe(true)
  })

  it('test_a_custom_root_with_nothing_in_it_is_claimed', () => {
    // The operator renamed the directory. We are the ones creating it, so it is ours — refusing
    // forever would mean retention never runs again for anyone who set `home_dir`.
    const { projects } = scratch()

    claimDefaultRoot(projects, builtInDefaultRoot('/somewhere/else'))

    expect(rootIsOurs(projects)).toBe(true)
  })

  it('test_a_custom_root_that_already_holds_projects_is_refused', () => {
    // The `.claude` case, concretely: a directory with another product's transcripts in it. Claiming
    // on sight would hand our delete path a tree we did not write.
    const { projects } = scratch()
    mkdirSync(join(projects, '-home-someone-a-project'), { recursive: true })

    claimDefaultRoot(projects, builtInDefaultRoot('/somewhere/else'))

    expect(rootIsOurs(projects), 'a root with someone else\'s projects in it was claimed').toBe(false)
  })

  it('test_a_custom_root_that_does_not_exist_yet_is_claimed', () => {
    // First run after the rename: nothing on disk at all.
    const base = mkdtempSync(join(tmpdir(), 'theocode-claim-'))
    roots.push(base)
    const projects = join(base, 'not-created-yet', 'projects')

    claimDefaultRoot(projects, builtInDefaultRoot('/somewhere/else'))

    expect(rootIsOurs(projects)).toBe(true)
  })
})
