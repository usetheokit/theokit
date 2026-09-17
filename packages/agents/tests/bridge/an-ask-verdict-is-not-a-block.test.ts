import { describe, expect, it } from 'vitest'

import { createPermissionsPlugin } from '../../src/bridge/permissions-plugin.js'

/**
 * #826 — a tool nobody wrote a rule about must not be dead.
 *
 * `PermissionEngine` answers `ask` for an unmatched tool, and `PermissionPlugin.create` turns that
 * into a HARD BLOCK when no gate is supplied: `opts.onAsk ? opts.onAsk(name) : { block: true,
 * message: \`requires approval: ${name}\` }`. So wiring the engine without a gate made every tool an
 * operator did not enumerate stop working, the moment they wrote any `permissions` block at all.
 *
 * Measured on the built binary 2026-09-17, with one project rule allowing `Read(./src/**)`:
 * `skill_read` answered "Plugin blocked this tool call: requires approval: `skill_read`" for a skill
 * that loads; adding `"allow":["skill_read"]` made the same call return the skill body. Delegation
 * failed the same way, which is why #828 read as a delegation defect and was neither.
 *
 * The gate is MANDATORY rather than optional, and that is the fix rather than a detail of it. The
 * absence had a silent catastrophic default, which is the shape `approval-posture.ts` in this same
 * package already refuses in writing: "the 'no HITL' posture was not representable as a value, so it
 * was expressed as ABSENCE — and an absence has no exhaustive match, appears in no log, and fails no
 * test."
 */
describe('an ask verdict', () => {
  it('test_a_tool_no_rule_matches_is_not_hard_blocked', async () => {
    let asked: string | undefined
    const plugin = createPermissionsPlugin([{ tool: 'Read', action: 'allow' }], {
      onAsk: (toolName) => {
        asked = toolName
        return { behavior: 'allow' }
      },
    })

    expect(plugin, 'rules were supplied, so a plugin must be built').toBeDefined()
    const veto = await vetoFor(plugin!, 'skill_read')

    expect(veto, 'the gate allowed it, so nothing may veto the call').toBeUndefined()
    expect(asked, 'the gate must be consulted with the tool the model called').toBe('skill_read')
  })

  it('test_the_gate_can_still_refuse_and_its_reason_reaches_the_model', async () => {
    const plugin = createPermissionsPlugin([{ tool: 'Read', action: 'allow' }], {
      onAsk: () => ({ behavior: 'deny', message: 'nobody is here to approve this' }),
    })
    const veto = await vetoFor(plugin!, 'skill_read')

    expect(veto?.block, 'a refusal must still stop the call').toBe(true)
    expect(veto?.message, 'the reason must travel, not a generic phrase').toContain(
      'nobody is here to approve this',
    )
  })
})

/** Drive the plugin's `pre_tool_call` the way the SDK does, and return whatever it vetoes with. */
async function vetoFor(
  plugin: { register: (ctx: unknown) => void },
  toolName: string,
): Promise<{ block?: boolean; message?: string } | undefined> {
  let handler: ((c: { name: string; args: unknown }) => unknown) | undefined
  plugin.register({
    on: (event: string, fn: (c: { name: string; args: unknown }) => unknown) => {
      if (event === 'pre_tool_call') handler = fn
    },
  })
  expect(handler, 'the plugin must register a pre_tool_call handler').toBeDefined()
  return (await handler!({ name: toolName, args: {} })) as
    | { block?: boolean; message?: string }
    | undefined
}
