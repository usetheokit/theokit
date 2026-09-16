/**
 * B-070 — `/skills` reports the agent that exists.
 *
 * The three states a user can be in are genuinely different and the panel must not collapse them:
 * no agent built yet, an agent with no skills, and an agent whose skills trust removed.
 */
import { describe, expect, it } from 'vitest'

import { hooksPanelBody, mcpPanelBody, skillsPanelBody } from '../../src/commands/wiring-panels.js'

type Entity = { active: string[]; requested: string[]; suppressedByTrust: boolean }
const EMPTY: Entity = { active: [], requested: [], suppressedByTrust: false }

const wiredMcp = (mcp: Entity) =>
  ({ mcp, skills: EMPTY, hooks: EMPTY, projectSources: true }) as never

const wired = (skills: Entity) =>
  ({
    skills,
    mcp: { active: [], requested: [], suppressedByTrust: false },
    hooks: { active: [], requested: [], suppressedByTrust: false },
    projectSources: true,
  }) as never

describe('B-070 — skillsPanelBody', () => {
  it('test_lists_the_skills_the_agent_actually_loaded', () => {
    const body = skillsPanelBody(
      wired({
        active: ['daily-briefing'],
        requested: ['daily-briefing'],
        suppressedByTrust: false,
      }),
    )
    expect(body).toContain('daily-briefing')
  })

  it('test_no_agent_yet_is_not_reported_as_no_skills', () => {
    // Before the first turn nothing has been built. Answering "none" would describe an agent that
    // was never constructed — at exactly the moment a user opens the listing.
    expect(skillsPanelBody(undefined)).toContain('no agent has been built yet')
  })

  it('test_trust_suppression_names_what_was_dropped', () => {
    // "No skills" and "your skills were dropped" send a user to opposite places, so the suppressed
    // case LISTS them rather than showing an empty panel.
    const body = skillsPanelBody(
      wired({ active: [], requested: ['daily-briefing'], suppressedByTrust: true }),
    )
    expect(body).toContain('DIRECTORY UNTRUSTED')
    expect(body).toContain('daily-briefing')
    expect(body).toContain('not loaded')
  })

  it('test_a_trusted_directory_with_no_skills_says_what_it_knows_and_what_it_cannot', () => {
    // Anti-vacuity floor: a panel that always warned would pass the test above, so the empty case
    // must NOT carry the suppressed wording.
    //
    // It used to assert 'no skills are enabled for this directory'. That sentence answered for two
    // loading paths while the panel observes one: `.claude/skills/` reaches the model through the
    // compatibility dialect, never through `.skills()`. Measured 2026-09-15 — the panel printed it
    // while the model, in the same turn, listed forty skills and named one created minutes earlier
    // under that root. The wording now scopes its claim and names the surface that can answer.
    const body = skillsPanelBody(wired({ active: [], requested: [], suppressedByTrust: false }))
    expect(body).toContain('the declared path wired none')
    expect(body).toContain('.claude/skills/')
    expect(body).toContain('doctor')
    expect(body).not.toContain('DIRECTORY UNTRUSTED')
  })
})

/**
 * B-069 — the same three states for MCP, and the suppressed message carries the reason trust gates
 * it at all: these are external processes SPAWNED before any per-tool approval.
 */
describe('B-069 — mcpPanelBody', () => {
  it('test_lists_the_servers_the_agent_started', () => {
    expect(
      mcpPanelBody(
        wiredMcp({ active: ['fixtures'], requested: ['fixtures'], suppressedByTrust: false }),
      ),
    ).toContain('fixtures')
  })

  it('test_no_agent_yet_is_not_reported_as_no_servers', () => {
    expect(mcpPanelBody(undefined)).toContain('no agent has been built yet')
  })

  it('test_trust_suppression_names_the_servers_and_the_reason', () => {
    const body = mcpPanelBody(
      wiredMcp({ active: [], requested: ['fixtures'], suppressedByTrust: true }),
    )
    expect(body).toContain('DIRECTORY UNTRUSTED')
    expect(body).toContain('fixtures')
    expect(body).toContain('spawn external processes')
  })

  it('test_a_trusted_directory_with_no_servers_names_the_file', () => {
    // Anti-vacuity floor, and the file name is the useful half: a user who declared servers
    // elsewhere needs to know where this looked.
    expect(mcpPanelBody(wiredMcp(EMPTY))).toContain('.mcp.json')
  })
})

/**
 * B-088 — the panel must not let a listed name imply health.
 *
 * The caveat CHANGED when the answer started existing. It used to say whether a server answered was
 * "not reported here", which was true while no layer below knew; the SDK now emits
 * `mcp_server_failed` and the panel reports it, so repeating the old wording would understate what
 * this listing can say. What must NOT change is the floor below it: silence is still not health.
 */
describe('B-069/B-088 — /mcp states what it cannot know', () => {
  it('test_a_listed_server_says_a_failure_would_be_reported_after_the_turn', () => {
    const body = mcpPanelBody(
      wiredMcp({ active: ['probe'], requested: ['probe'], suppressedByTrust: false }),
    )
    expect(body).toContain('reported here after the turn that hit it')
    // The load-bearing half: no failure event yet is not proof one answered.
    expect(body).not.toMatch(/healthy|all servers answered/i)
  })

  it('test_the_caveat_is_absent_when_nothing_is_listed', () => {
    // Anti-noise floor: a caveat on an empty panel is a warning about nothing.
    expect(mcpPanelBody(wiredMcp(EMPTY))).not.toContain('reported here after the turn')
  })
})

/**
 * B-071 — reopened because the first version re-read config. The panel now reports the record, and
 * the untrusted case must not read as protection: those hooks are declared and are NOT running.
 */
describe('B-071 — hooksPanelBody', () => {
  const wiredHooks = (hooks: Entity) =>
    ({ hooks, mcp: EMPTY, skills: EMPTY, projectSources: true }) as never

  it('test_lists_the_wired_hooks_with_event_and_command', () => {
    const body = hooksPanelBody(
      wiredHooks({
        active: ['PreToolUse  ./guard.sh'],
        requested: ['PreToolUse  ./guard.sh'],
        suppressedByTrust: false,
      }),
    )
    expect(body).toContain('PreToolUse')
    expect(body).toContain('./guard.sh')
  })

  it('test_untrusted_says_nothing_below_can_block', () => {
    const body = hooksPanelBody(
      wiredHooks({ active: [], requested: ['PreToolUse  ./guard.sh'], suppressedByTrust: true }),
    )
    expect(body).toContain('DIRECTORY UNTRUSTED')
    expect(body).toContain('NOT wired')
    expect(body.indexOf('DIRECTORY UNTRUSTED')).toBeLessThan(body.indexOf('./guard.sh'))
  })

  it('test_no_agent_yet_is_not_reported_as_no_hooks', () => {
    expect(hooksPanelBody(undefined)).toContain('no agent has been built yet')
  })
})

/**
 * B-088 — a server that FAILED is a third state, distinct from absent and from trust-suppressed.
 *
 * The panel used to end with a caveat saying whether each server answered "is not reported here".
 * That was honest while nothing downstream knew; now the SDK emits `mcp_server_failed` and the
 * answer exists, so the caveat would understate what the panel can say.
 */
describe('B-088 — mcpPanelBody reports servers that did not answer', () => {
  const LISTED = wiredMcp({
    active: ['fixtures'],
    requested: ['fixtures'],
    suppressedByTrust: false,
  })

  it('test_a_failed_server_is_named_with_its_reason', () => {
    const body = mcpPanelBody(LISTED, [
      // `source` arrived with the framework's sink: it separates "failed during the turn" from
      // "the config ignored it", which survive turn boundaries differently.
      { serverName: 'fixtures', message: 'spawn fixtures ENOENT', source: 'run' as const },
    ])
    expect(body).toContain('fixtures')
    expect(body).toContain('spawn fixtures ENOENT')
  })

  it('test_a_failed_server_is_distinct_from_trust_suppression', () => {
    const failed = mcpPanelBody(LISTED, [
      { serverName: 'fixtures', message: 'boom', source: 'run' as const },
    ])
    // Trust suppression means NOT STARTED by policy; a failure means started and did not answer.
    // Reporting one as the other sends a user to fix the wrong thing.
    expect(failed).not.toContain('DIRECTORY UNTRUSTED')
  })

  it('test_with_no_failures_the_panel_does_not_claim_health', () => {
    // The absence of a failure event is not proof a server answered — the turn may not have run
    // yet. The panel must not upgrade silence into "healthy".
    const body = mcpPanelBody(LISTED, [])
    expect(body).not.toMatch(/healthy|all servers answered|running fine/i)
  })

  it('test_failures_are_omitted_when_no_server_is_listed', () => {
    // Nothing was handed to the agent, so there is nothing to report a failure about.
    expect(mcpPanelBody(wiredMcp(EMPTY), [])).toContain('.mcp.json')
  })
})
