/**
 * #65 — declaring `.claude/` as a setting source, and gating it exactly like the directory it is.
 *
 * `theokit-sdk#524` put `<cwd>/.claude/` behind an opt-in and `@theokit/agents@13.0.0-next.0`
 * forwards it. Without it a repository written for Claude Code gets its `skills/` and `agents/`
 * ignored; with it, both work — verified end to end on the built binary, one project holding both:
 *
 *     .theokit/agents/native.md   -> delegated, NATIVE-OK
 *     .claude/agents/foreign.md   -> delegated, FOREIGN-OK
 *
 * The security shape is the whole reason this is its own change. `.claude/` is repository-controlled
 * — it usually arrived with the clone — and holds a `hooks.json` that executes shell. So it takes the
 * SAME evidence `project` takes and no less: an untrusted directory must not reach the agent through
 * a second door just because that door has another product's name on it.
 */
import { describe, expect, it } from 'vitest'

import { settingSourcesFor } from '../src/setting-sources.js'

const posture = (allows: Record<string, boolean>) =>
  ({
    allows,
    level: allows.projectConfig === true ? 'trusted' : 'untrusted',
    // `source` travels into the grant, so a refusal downstream can say WHERE the decision came
    // from. Omitting it here made the fixture disagree with every real posture.
    source: 'store',
  }) as never

// `projectSourceAllowed` reads `subagents && hooks` (B-008: the project source enables repository
// hooks too, not only subagent discovery, so it requires both).
const TRUSTED = posture({
  projectConfig: true,
  subagents: true,
  hooks: true,
  skills: true,
  mcp: true,
  memory: true,
  agentsMd: true,
})
const UNTRUSTED = posture({
  projectConfig: false,
  subagents: false,
  hooks: false,
  skills: false,
  mcp: false,
  memory: false,
  agentsMd: false,
})

describe('#65 — the foreign dialect is declared, and gated', () => {
  it('test_a_trusted_directory_carries_the_evidence_that_authorised_it', () => {
    // Not a boolean. The grant carries the posture, so a refusal further down can say WHERE the
    // decision came from rather than only that it was refused.
    expect(settingSourcesFor(TRUSTED).project).toEqual({
      trustedBy: { level: 'trusted', source: 'store', allows: { projectSettings: true } },
    })
  })

  it('test_an_untrusted_directory_does_not_even_request_the_root', () => {
    // Absence, not a denying grant: a present-but-denying value would be a claim the gate is on
    // when it is not, and a requested-but-ungranted `project` is a hard refusal upstream.
    expect(settingSourcesFor(UNTRUSTED).project).toBeUndefined()
  })

  it('test_the_foreign_root_takes_the_same_evidence_as_the_native_one', () => {
    // Not a boolean, and not a weaker grant. `.claude/hooks.json` executes shell from a directory
    // that usually arrived with a clone. The EVIDENCE is identical; what differs is the surface
    // list below, which is a separate question from how much trust the root required.
    const sources = settingSourcesFor(TRUSTED)

    expect(sources.claudeCode?.trustedBy).toEqual(sources.project?.trustedBy)
  })

  it('test_the_foreign_root_is_imported_without_its_hooks', () => {
    // #130. The whole point of the declaration: `.claude/` contributes skills and subagents, and its
    // `hooks` are never read. Asserted as an absence rather than by comparing the whole list, so
    // adding a surface later does not silently pass a test about the one that must stay out.
    const imported = settingSourcesFor(TRUSTED).claudeCode?.import ?? []

    expect(imported).not.toContain('hooks')
    expect(imported).toContain('skills')
    expect(imported).toContain('subagents')
  })

  it('test_the_list_names_a_surface_it_does_not_actually_govern', () => {
    // Measured, and pinned so it is discovered rather than believed: `subagents` is in the list and
    // removing it changes nothing, because `discoverRoles` reaches `.claude/agents/` with its own
    // direct `compatSources: ['claude-code']` and never through this declaration. Same for the TUI's
    // custom commands.
    //
    // The entry stays — it states what the framework MAY load, which is true and would matter the
    // day anything routes through it. This test exists so the next reader learns that tightening
    // this list does not tighten those two surfaces, instead of assuming a security declaration
    // governs everything it names.
    expect(settingSourcesFor(TRUSTED).claudeCode?.import).toContain('subagents')
  })

  it('test_the_surface_list_is_never_empty', () => {
    // The framework refuses `[]` rather than interpreting it, because it reads as "no surfaces" or
    // as "not declared, therefore all" and the two differ by whether shell runs. A refactor that
    // emptied this list would turn a security declaration into a startup failure.
    expect(settingSourcesFor(TRUSTED).claudeCode?.import.length).toBeGreaterThan(0)
  })

  it('test_an_untrusted_directory_gets_neither_door', () => {
    const sources = settingSourcesFor(UNTRUSTED)

    expect(
      sources.claudeCode,
      'an untrusted repository reached the agent through .claude/',
    ).toBeUndefined()
    expect(sources.project, 'the anti-vacuity floor: the original gate must still hold').toBeUndefined()
  })

  it('test_the_user_source_is_unaffected', () => {
    // `user: true` through an untrusted directory is the recorded asymmetry: that gate asks about
    // THIS repository's code, and the operator's home is not the repository.
    expect(settingSourcesFor(UNTRUSTED).user).toBe(true)
    expect(settingSourcesFor(TRUSTED).user).toBe(true)
  })
})
