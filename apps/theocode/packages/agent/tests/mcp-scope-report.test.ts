/**
 * #72 — the wiring record separates the operator's MCP servers from the repository's.
 *
 * The personal scope is not gated on project trust, so in an untrusted directory the product hands a
 * personal server to `.mcp()` and starts it. `recordWiring` takes the posture and reports EVERY
 * requested server as suppressed, which made `theocode doctor` say "declared but NOT wired" about a
 * server that was, in fact, running.
 *
 * Measured against the built binary before this fix: `mcp: declared but NOT wired — this directory
 * is untrusted`, with `~/.theokit/.mcp.json` declaring `personal-probe`. A record that contradicts
 * the run is worse than no record: this file's whole reason for existing, per B-071, is that it is
 * "a record of the decision" rather than a second guess at it.
 */
import { describe, expect, it } from 'vitest'

import { wiredCapabilities } from '../src/wired-capabilities.js'

const base = {
  projectSourcesAllowed: false,
  configuredSkills: [],
  hookEvents: [],
  agentsMdFiles: [],
  sandboxMode: 'workspace-write',
}

const allows = (mcp: boolean): { allows: { mcp: boolean; skills: boolean; hooks: boolean; agentsMd: boolean } } => ({
  allows: { mcp, skills: mcp, hooks: mcp, agentsMd: mcp },
})

describe('#72 — personal MCP servers in the wiring record', () => {
  it('test_a_personal_server_is_reported_active_in_an_untrusted_directory', () => {
    const w = wiredCapabilities({
      ...base,
      posture: allows(false),
      mcpServers: { mine: {} },
      mcpPersonal: ['mine'],
    })

    expect(w.mcp.active, 'a server that IS running was reported as not wired').toEqual(['mine'])
  })

  it('test_the_project_scope_is_still_reported_as_suppressed', () => {
    // Both facts, not one. "Yours is running" must not erase "the repository's was withheld".
    const w = wiredCapabilities({
      ...base,
      posture: allows(false),
      mcpServers: { mine: {}, theirs: {} },
      mcpPersonal: ['mine'],
    })

    expect(w.mcp.suppressedByTrust).toBe(true)
    expect(w.mcp.active, "the repository's server was reported as running").toEqual(['mine'])
  })

  it('test_a_trusted_directory_reports_both_scopes', () => {
    const w = wiredCapabilities({
      ...base,
      posture: allows(true),
      mcpServers: { mine: {}, theirs: {} },
      mcpPersonal: ['mine'],
    })

    expect([...w.mcp.active].sort()).toEqual(['mine', 'theirs'])
    expect(w.mcp.suppressedByTrust).toBe(false)
  })

  it('test_no_personal_server_leaves_the_old_behaviour_exactly_as_it_was', () => {
    // The anti-regression floor: this is every existing caller, and the gate must still empty the
    // list for them.
    const w = wiredCapabilities({
      ...base,
      posture: allows(false),
      mcpServers: { theirs: {} },
      mcpPersonal: [],
    })

    expect(w.mcp.active).toEqual([])
    expect(w.mcp.suppressedByTrust).toBe(true)
  })
})

describe('#72 — a withheld project server reaches the record', () => {
  it('test_the_gate_is_reported_as_having_refused_something', () => {
    const w = wiredCapabilities({
      ...base,
      posture: allows(false),
      mcpServers: { mine: {} },
      mcpPersonal: ['mine'],
      mcpWithheld: ['theirs'],
    })

    expect(w.mcp.suppressedByTrust, 'the gate refused a server and the record does not say so').toBe(
      true,
    )
    expect(w.mcp.active, 'a withheld server was reported as running').toEqual(['mine'])
  })
})
