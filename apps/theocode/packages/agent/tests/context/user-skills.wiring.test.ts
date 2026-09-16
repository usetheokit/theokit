/**
 * #65, pillar (a) — the operator's skill reaches a BUILT agent, not just the loader.
 *
 * `user-skills.test.ts` proves the module reads the right root. This proves something different and
 * is the half that would rot silently: that the result is actually handed to `.skills()` and shows
 * up in the record a surface reads. A loader with no caller passes its own tests forever.
 *
 * The record is the observable seam. Asserting on it rather than on the agent's internals also
 * covers the second defect this could have: `/skills` listing a set the agent does not hold, which
 * is the config-versus-reality disagreement `wired-capabilities.ts` exists to make impossible.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { tempRoot } from '../helpers/temp-root.js'

const realHome = process.env.HOME

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
})

describe('#65 — an operator skill is wired into the agent', () => {
  it('test_the_record_lists_a_skill_that_exists_only_in_the_operators_root', async () => {
    const home = tempRoot('user-skills-wiring-')
    const dir = join(home, '.theokit', 'skills', 'reply-in-portuguese')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      '---\nname: reply-in-portuguese\ndescription: how this operator works\n---\n\nReply in pt-BR.\n',
    )
    process.env.HOME = home

    const { buildChatAgent } = await import('../../src/chat/chat.js')
    let wired: { skills: { active: readonly string[] } } | undefined
    await buildChatAgent({
      // B-161: a directory of its own, not `process.cwd()`. This test isolates HOME into a tmpdir
      // and used to hand the build the REPOSITORY as the project directory — so the context it
      // assembled depended on what that tree held: the rule corpus, a project document, the session
      // store keyed by the path. Measured: three production lines were covered on a maintainer's
      // machine and not in a clean checkout, which made total coverage a property of the machine.
      // The half that was isolated was not the half the content arrives through.
      cwd: tempRoot('b161-project-'),
      surface: 'headless',
      onWired: (w) => {
        wired = w as typeof wired
      },
    })

    expect(
      wired?.skills.active,
      'the operator root was read but its skill never reached `.skills()` or the record',
    ).toContain('reply-in-portuguese')
  })

  it('test_negative_control_an_operator_with_no_skills_adds_nothing', async () => {
    // Anti-vacuity. Without this, a record that listed 'reply-in-portuguese' unconditionally — or a
    // `toContain` against a list built from something else entirely — would pass the arm above.
    const home = tempRoot('user-skills-wiring-empty-')
    process.env.HOME = home

    const { buildChatAgent } = await import('../../src/chat/chat.js')
    let wired: { skills: { active: readonly string[] } } | undefined
    await buildChatAgent({
      // B-161: a directory of its own, not `process.cwd()`. This test isolates HOME into a tmpdir
      // and used to hand the build the REPOSITORY as the project directory — so the context it
      // assembled depended on what that tree held: the rule corpus, a project document, the session
      // store keyed by the path. Measured: three production lines were covered on a maintainer's
      // machine and not in a clean checkout, which made total coverage a property of the machine.
      // The half that was isolated was not the half the content arrives through.
      cwd: tempRoot('b161-project-'),
      surface: 'headless',
      onWired: (w) => {
        wired = w as typeof wired
      },
    })

    expect(wired?.skills.active).not.toContain('reply-in-portuguese')
  })
})
