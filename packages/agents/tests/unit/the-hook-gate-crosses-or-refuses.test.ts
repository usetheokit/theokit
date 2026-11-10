import { describe, expect, it } from 'vitest'

import { assembleM8CreateOptions } from '../../src/bridge/sdk-adapter-create-options.js'
import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'

/**
 * theokit#686 — `@theokit/sdk@5.4.0` added `local.hooks.approve`, a consumer's decision point
 * BEFORE the runtime spawns a hook. This layer never forwarded it, so a hook declared in a foreign
 * config root ran shell without passing the consumer's approval.
 *
 * Measured in TheoCode against 5.4.0, with a control arm proving the zero was not an empty turn:
 *
 *     control_nothing             fires=0  tool_ran=yes
 *     claude_project_unapproved   fires=1  tool_ran=yes
 *
 * The forward is the easy half. The hard half is that the option is 5.4.0-only while this package
 * declares `^4.52.1 || ^5.0.0`, so a naive pass-through would compile and do NOTHING on most
 * admitted versions — a security gate that silently does not gate, which is worse than offering
 * none, because whoever configured it stops looking. The consumer said so in those words and
 * asked for the refusal rather than the forward.
 *
 * The version check is a pure function so both directions are testable without installing two SDKs.
 */

const base = (): CompiledAgentOptions => ({ tools: [], agents: {}, stream: true })

describe('the hook approval gate crosses, or refuses to pretend (theokit#686)', () => {
  it('test_a_declared_gate_reaches_the_sdk_local_options', () => {
    const approve = (): boolean => true
    const { options, applied } = assembleM8CreateOptions({ ...base(), hookApproval: { approve } })
    expect(options.local?.hooks?.approve).toBe(approve)
    expect(applied).toContain('hookApproval')
  })

  it('test_no_declared_gate_forwards_nothing', () => {
    // An agent that declares no gate must not be refused on an old SDK — the refusal exists to
    // protect a promise nobody made here.
    const { options, applied } = assembleM8CreateOptions(base())
    expect(options.local?.hooks).toBeUndefined()
    expect(applied).not.toContain('hookApproval')
  })
})
