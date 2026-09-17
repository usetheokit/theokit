/**
 * #67 — a green tick for a skill that is not there, and silence about one that is.
 *
 * `theocode doctor` reports the skills row from the DECLARED list in configuration. Nothing compares
 * it with the disk, so both directions are wrong and neither says so. Measured on the built binary:
 *
 *     config declares ["exists","ghost"], only `exists` has a SKILL.md
 *       →  ✓ skills: exists, ghost
 *
 *     a SKILL.md on disk, declared nowhere
 *       →  ✓ skills: daily-briefing      (the default value, which exists nowhere either)
 *
 * The first is a capability advertised and absent — the shape this repository has fixed three times.
 * The second is the documented way to create a skill doing nothing, silently: the panel shows a
 * phantom and hides the real file.
 *
 * This module answers only what is on disk. Whether a found skill is WIRED is a separate question the
 * trust gate already answers, and conflating them would produce a row that is wrong in a new way.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { skillsOnDisk } from '../src/skills-on-disk.js'

let cwd: string
let home: string

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'theocode-skills-'))
  home = mkdtempSync(join(tmpdir(), 'theocode-home-'))
})
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

function write(root: string, name: string): void {
  mkdirSync(join(cwd, root, 'skills', name), { recursive: true })
  writeFileSync(join(cwd, root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\nbody\n`)
}

/** The operator's own root — `~/.theokit/skills/<name>/SKILL.md`. */
function writeUser(name: string): void {
  mkdirSync(join(home, '.theokit', 'skills', name), { recursive: true })
  writeFileSync(join(home, '.theokit', 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\nbody\n`)
}

describe('#67 — declared against what is on disk', () => {
  it('test_a_declared_skill_with_no_file_is_named', () => {
    write('.theokit', 'exists')

    expect(skillsOnDisk(cwd, ['exists', 'ghost']).declaredButAbsent).toEqual(['ghost'])
  })

  it('test_a_file_declared_nowhere_is_named_too', () => {
    // The other direction, and the one the documented instructions produce: create the file, forget
    // the config line, and nothing anywhere says the skill is inert.
    write('.theokit', 'undeclared')

    expect(skillsOnDisk(cwd, []).presentButUndeclared).toEqual(['undeclared'])
  })

  it('test_the_foreign_root_counts_as_present', () => {
    // `.claude/skills/` is read since #72, so a skill living only there is NOT missing.
    write('.claude', 'foreign')

    const found = skillsOnDisk(cwd, ['foreign'])
    expect(found.declaredButAbsent).toEqual([])
    expect(found.presentButUndeclared).toEqual([])
  })

  it('test_a_matching_pair_reports_nothing', () => {
    // Anti-vacuity: a function that always returned names would satisfy the cases above.
    write('.theokit', 'exists')

    expect(skillsOnDisk(cwd, ['exists'])).toEqual({
      declaredButAbsent: [],
      presentButUndeclared: [],
      declaredUserOnlySoNotLoaded: [],
      // The foreign root is reported now; these fixtures put nothing under `.claude/skills/`.
      foreignRootSkills: [],
      bundledSkills: [],
    })
  })

  it('test_a_directory_without_a_SKILL_md_is_not_a_skill', () => {
    // An empty folder under `skills/` is a half-finished skill, and calling it present would send
    // the reader looking for a defect in a file that was never written.
    mkdirSync(join(cwd, '.theokit', 'skills', 'hollow'), { recursive: true })

    expect(skillsOnDisk(cwd, ['hollow']).declaredButAbsent).toEqual(['hollow'])
  })


  it('test_a_skill_under_the_user_root_is_not_reported_as_absent', () => {
    // Measured 2026-09-05 against the built binary: a `SKILL.md` at `~/.theokit/skills/<name>/`,
    // declared in config, produced `! declared with no SKILL.md`. The file was there. The reason
    // given was false, and a diagnostic that names the wrong cause sends the reader to write a file
    // that already exists.
    writeUser('mine')

    expect(skillsOnDisk(cwd, ['mine'], home).declaredButAbsent).toEqual([])
  })

  it('test_a_skill_only_under_the_user_root_is_named_as_not_loading', () => {
    // And it is NOT clean either. Same measurement, with the same file copied into the project as a
    // positive control: the project copy loads (`PROBE-OK`), the user copy leaves the model with no
    // skill tool at all. `@theokit/sdk@5.0.1` builds every skill root from `cwd`
    // (`SkillsCapability.refresh`), so the operator's root contributes nothing.
    //
    // Reporting it as present would be the failure this whole module exists to end, one root over:
    // a green tick over a capability that is not there.
    writeUser('mine')

    expect(skillsOnDisk(cwd, ['mine'], home).declaredUserOnlySoNotLoaded).toEqual(['mine'])
  })

  it('test_the_project_root_wins_when_a_name_lives_in_both', () => {
    // The project copy is the one that loads, so a name present in both is simply present.
    write('.theokit', 'both')
    writeUser('both')

    const found = skillsOnDisk(cwd, ['both'], home)
    expect(found.declaredUserOnlySoNotLoaded).toEqual([])
    expect(found.declaredButAbsent).toEqual([])
  })

  it('test_an_undeclared_user_skill_is_not_dragged_into_the_project_direction', () => {
    // `presentButUndeclared` means "add a config line and it loads". That is false for the user
    // root, where declaring it changes nothing today — so it must not appear there.
    writeUser('stray')

    expect(skillsOnDisk(cwd, [], home).presentButUndeclared).toEqual([])
  })

  it('test_omitting_the_home_keeps_the_old_answer', () => {
    // Anti-vacuity on the new argument: callers that pass no home get exactly what they got before.
    write('.theokit', 'exists')

    expect(skillsOnDisk(cwd, ['exists'])).toEqual({
      declaredButAbsent: [],
      presentButUndeclared: [],
      declaredUserOnlySoNotLoaded: [],
      // The foreign root is reported now; these fixtures put nothing under `.claude/skills/`.
      foreignRootSkills: [],
      bundledSkills: [],
    })
  })


  it('test_the_foreign_root_is_not_offered_the_declare_it_remedy', () => {
    // Dogfooded on this repository 2026-09-05: `.claude/skills/` held 40 entries installed by a
    // Claude Code kit and `.theokit/skills/` was empty, so the row asked the operator to declare
    // thirty-nine skills belonging to another tool. Every one of them is a true statement and the
    // row is useless — and a diagnostic nobody reads is the failure this project's own rules name:
    // "the first thing anyone does with a noisy gate is turn it off".
    //
    // The asymmetry is deliberate and matches the remedy, not the root: a `SKILL.md` under
    // `.theokit/skills/` is one somebody wrote FOR this product and forgot to declare, and
    // "add a config line" is the fix. Under `.claude/` it is another tool's inventory, and the same
    // sentence is an instruction to adopt it.
    write('.claude', 'theirs')

    expect(skillsOnDisk(cwd, []).presentButUndeclared).toEqual([])
  })

  it('test_the_foreign_root_still_counts_when_a_declared_skill_lives_there', () => {
    // The other direction is unchanged and must stay unchanged: `.claude/skills/` IS read since #72,
    // measured on the built binary (`FOREIGN-SKILL`), so a declared skill living only there is not
    // missing and must not be reported as such.
    write('.claude', 'theirs')

    expect(skillsOnDisk(cwd, ['theirs']).declaredButAbsent).toEqual([])
  })


  it('test_a_skill_from_a_plugin_bundle_is_not_reported_as_missing', () => {
    // Measured 2026-09-06 on the built binary: a bundle at `.claude/plugins/<n>/skills/<name>/SKILL.md`
    // contributes its skill — it answers, and the control with the bundle removed does not. `doctor`
    // reported it as `declared with no SKILL.md` anyway.
    //
    // Third instance of one defect: this check knew the project roots, then learned the operator's,
    // and never learned that a root can nest bundles. Each time the row named a cause that is false —
    // "write the file" — about a file that is there and working.
    mkdirSync(join(cwd, '.claude', 'plugins', 'demo', 'skills', 'bundled'), { recursive: true })
    writeFileSync(
      join(cwd, '.claude', 'plugins', 'demo', 'skills', 'bundled', 'SKILL.md'),
      '---\nname: bundled\n---\nbody\n',
    )

    expect(skillsOnDisk(cwd, ['bundled']).declaredButAbsent).toEqual([])
  })

  it('test_a_bundled_skill_is_not_offered_the_declare_it_remedy_either', () => {
    // `presentButUndeclared` says "add a config line and it loads". A bundle is another tool's
    // inventory, exactly like `.claude/skills/` — the remedy does not fit, so the name must not
    // appear there.
    mkdirSync(join(cwd, '.claude', 'plugins', 'demo', 'skills', 'bundled'), { recursive: true })
    writeFileSync(
      join(cwd, '.claude', 'plugins', 'demo', 'skills', 'bundled', 'SKILL.md'),
      '---\nname: bundled\n---\nbody\n',
    )

    expect(skillsOnDisk(cwd, []).presentButUndeclared).toEqual([])
  })

  it('test_no_skills_anywhere_is_not_an_error', () => {
    expect(skillsOnDisk(cwd, [])).toEqual({
      declaredButAbsent: [],
      presentButUndeclared: [],
      declaredUserOnlySoNotLoaded: [],
      // The foreign root is reported now; these fixtures put nothing under `.claude/skills/`.
      foreignRootSkills: [],
      bundledSkills: [],
    })
  })
})
