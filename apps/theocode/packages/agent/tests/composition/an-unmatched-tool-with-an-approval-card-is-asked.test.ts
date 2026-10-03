import { describe, expect, it } from 'vitest'

import { approvalGates } from '../../src/chat/chat.js'
import { askGateFor } from '../../src/composition/agent-spec.js'

/**
 * #945 — a tool no `permissions` rule matches is handed to the approval card it already has.
 *
 * Measured in the TUI on 2026-10-02: with a `permissions.allow` list that did not name `ApplyPatch`,
 * asking for a one-line file was refused with "Nothing here can ask you for it", and no card was
 * shown. With `HOME` pointed at an empty directory (no `permissions` block) the same request showed
 * the "Apply patch / Do you want to proceed?" card, and answering it wrote or refused the file.
 *
 * So the asker existed for every tool in the build-time `.approvals({...})` map. Letting the `ask`
 * verdict through for those tools hands the decision to that gate: the card in the TUI, the
 * headless approval posture under `exec`. Tools with no gate keep the refusal, because for them the
 * sentence is still true.
 */
const gated = new Set(Object.keys(approvalGates({ writes: true, searchConfigured: true })))

async function verdict(policy: Parameters<typeof askGateFor>[0], tool: string) {
  return askGateFor(policy, gated)(tool, {})
}

describe('the ask verdict under an approval policy that asks', () => {
  it('test_a_tool_with_an_approval_card_is_handed_to_the_card', async () => {
    expect(await verdict('on-request', 'ApplyPatch')).toEqual({ behavior: 'allow' })
    expect(await verdict('untrusted', 'Bash')).toEqual({ behavior: 'allow' })
  })

  it('test_a_tool_with_no_card_is_still_refused_with_the_reason', async () => {
    const refused = await verdict('on-request', 'Read')

    expect(refused.behavior).toBe('deny')
    expect(refused).toHaveProperty('message', expect.stringContaining('`Read` matched no rule'))
  })
})

describe('the ask verdict under approval_policy="never"', () => {
  it('test_every_unmatched_tool_runs', async () => {
    expect(await verdict('never', 'Read')).toEqual({ behavior: 'allow' })
    expect(await verdict('never', 'ApplyPatch')).toEqual({ behavior: 'allow' })
  })
})

describe('the gated set is the approval map', () => {
  it('test_every_side_effecting_tool_is_in_it', () => {
    // The names the TUI showed a card for, plus the shell and network tools the map gates. If one
    // drops out of `approvalGates`, an unmatched call to it is refused again instead of asked.
    for (const tool of [
      'ApplyPatch',
      'Edit',
      'Bash',
      'interactive_shell',
      'write_stdin',
      'web_fetch',
    ]) {
      expect(gated.has(tool), `${tool} lost its approval card`).toBe(true)
    }
  })

  it('test_read_only_tools_are_not_in_it', () => {
    expect(gated.has('Read')).toBe(false)
  })
})
