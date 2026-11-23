import { describe, expect, it, vi } from 'vitest'

import {
  APPROVAL_KEY_HINT,
  approvalChoices,
  formatApproval,
  formatToolHeader,
  formatToolResult,
} from '../../src/formatting/tool-header.js'

/**
 * The approval card tells the user which keys settle it.
 *
 * Both references print this and this product printed nothing: Claude Code ends its prompt with
 * `Enter to confirm · Esc to cancel`, Codex with `Press enter to continue`. Here the card showed
 * `❯ 1. Yes / 2. No` and nothing else — on a card blocking a shell command, which is the worst
 * moment to leave someone guessing between typing the digit, Enter, and Esc.
 */
describe('every approval card carries the key hint', () => {
  it('test_a_known_tool_gets_the_hint', () => {
    expect(formatApproval({ toolName: 'Bash', input: { command: 'ls' } }).hint).toBe(
      APPROVAL_KEY_HINT,
    )
  })

  it('test_an_UNKNOWN_tool_gets_it_too', () => {
    // The fallback branch is the one a new gated tool lands in before anyone writes it a label —
    // so it is exactly the branch that must not silently lose the hint.
    expect(formatApproval({ toolName: 'some_future_tool', input: { x: 1 } }).hint).toBe(
      APPROVAL_KEY_HINT,
    )
  })

  it('test_the_hint_names_Esc_as_a_REJECT_not_a_cancel', () => {
    // `PermissionPrompt` documents Esc as yielding the LAST choice, which here is No. "Cancel"
    // would suggest the question goes away; the tool call is refused.
    expect(APPROVAL_KEY_HINT).toContain('Esc')
    expect(APPROVAL_KEY_HINT).toContain('reject')
    expect(APPROVAL_KEY_HINT).not.toContain('cancel')
  })

  it('test_the_known_label_is_not_lost_when_the_hint_is_added', () => {
    // Anti-vacuity: spreading the hint over the label object could have replaced it.
    const card = formatApproval({ toolName: 'Bash', input: { command: 'echo hi' } })

    expect(card.toolType).toBe('Run command')
    expect(card.command).toBe('echo hi')
  })
})

/**
 * The choice labels say what the answer DOES.
 *
 * `PermissionPrompt` defaults to a bare `Yes` / `No`, which names the keystroke and not the
 * consequence. Codex renders `1. Yes, continue` / `2. No, quit`; Claude Code renders
 * `1. Yes, I trust this folder` / `2. No, exit`.
 */
describe('approvalChoices', () => {
  it('test_the_deny_label_is_the_one_the_caller_supplied', () => {
    // Each gate refuses into a different outcome — a tool call is rejected, the trust gate QUITS,
    // a hook is left inert. One shared "No" would misdescribe two of the three.
    expect(approvalChoices('No, quit').at(-1)?.label).toBe('No, quit')
  })

  it('test_deny_is_LAST_because_Esc_yields_the_last_choice', () => {
    // Load-bearing ordering, not style. `PermissionPrompt` documents Esc as yielding the last
    // choice's value — reversing these would make Esc APPROVE a shell command.
    expect(approvalChoices('No, reject').at(-1)?.value).toBe('no')
    expect(approvalChoices('No, reject')[0]?.value).toBe('yes')
  })

  it('test_the_approval_card_carries_them', () => {
    const card = formatApproval({ toolName: 'Bash', input: { command: 'ls' } })

    expect(card.choices.map((c) => c.label)).not.toEqual(['Yes', 'No'])
    expect(card.choices.at(-1)?.value).toBe('no')
  })
})

/**
 * A rejected call must not be reported as one that ran.
 *
 * Every header here reads `failed` as "not active" and prints the past tense, so the transcript
 * said `Ran echo probe2` for a command that never executed. The refusal is the typed `refusal` on
 * the event (`@theokit/tui` `ToolRefusal`); the result text and exit code are never consulted.
 */
const denied = (name: string, input: Record<string, unknown>) =>
  ({
    kind: 'tool',
    name,
    status: 'failed',
    input,
    refusal: { by: 'human' },
  }) as never

describe('a rejected tool call is not reported as one that ran', () => {
  it('test_the_header_does_not_claim_the_command_ran', () => {
    const header = formatToolHeader(denied('Bash', { command: 'echo probe2' }))

    expect(header?.name, 'the transcript claims a rejected command ran').not.toMatch(/^Ran /)
    expect(header?.name).toBe('Rejected echo probe2')
  })

  it('test_it_says_nothing_changed', () => {
    // The question a user asks after rejecting is "did anything happen?". A header alone leaves it
    // open; the summary answers it.
    expect(formatToolHeader(denied('Bash', { command: 'rm -rf /' }))?.summary).toContain(
      'nothing ran',
    )
  })

  it('test_a_write_tool_is_named_by_what_it_would_have_done', () => {
    expect(formatToolHeader(denied('ApplyPatch', {}))?.name).toBe('Rejected the patch')
    expect(formatToolHeader(denied('Edit', { path: 'a.ts' }))?.name).toBe('Rejected the edit')
  })

  it('test_a_timeout_reads_as_a_rejection', () => {
    expect(
      formatToolHeader({
        ...(denied('Bash', { command: 'ls' }) as object),
        refusal: { by: 'timeout' },
      } as never)?.name,
    ).toBe('Rejected ls')
  })

  it('test_a_rejection_keeps_its_header_whatever_the_output_became', () => {
    for (const output of ['rejected — nothing ran', 'nothing ran: x', '']) {
      const event = {
        ...(denied('Bash', { command: 'echo parity-final' }) as object),
        output,
      } as never
      expect(formatToolHeader(event)?.name).toBe('Rejected echo parity-final')
      expect(formatToolHeader(event)?.summary).toContain('nothing ran')
    }
  })

  it('test_a_call_that_actually_ran_is_untouched', () => {
    // Anti-vacuity: treating every `failed` as a rejection would relabel real command failures,
    // which is the opposite mistake and just as misleading.
    const ran = {
      kind: 'tool',
      name: 'Bash',
      status: 'failed',
      input: { command: 'false' },
      output: JSON.stringify({ stdout: '', stderr: '', exit_code: 1 }),
    } as never

    expect(formatToolHeader(ran)?.name).toBe('Ran false')
    expect(formatToolHeader(ran)?.summary).toBeUndefined()
  })

  it('test_a_running_call_still_reads_as_running', () => {
    const running = {
      kind: 'tool',
      name: 'Bash',
      status: 'running',
      input: { command: 'sleep 1' },
    } as never

    expect(formatToolHeader(running)?.name).toBe('Running sleep 1')
  })
})

/**
 * The BODY of a refused call. The toolkit supplies it from the typed `refusal` (`nothing ran:
 * <reason>`), so the shell formatter has no refusal branch and treats marker text as the ordinary
 * shell output it is.
 */
describe('the body of a rejected call', () => {
  const result = (raw: unknown) =>
    formatToolResult({ name: 'Bash', status: 'failed' } as never, raw)?.output

  it('test_marker_text_in_the_output_is_not_a_refusal', () => {
    expect(
      result(
        JSON.stringify({
          stdout: '',
          stderr: "Tool 'Bash' denied by human approver",
          exitCode: 126,
        }),
      ),
    ).toBe("Tool 'Bash' denied by human approver")
  })

  it('test_a_refused_call_has_no_shell_body_so_the_toolkit_states_the_reason', () => {
    const event = { name: 'Bash', status: 'failed', refusal: { by: 'human' } } as never

    expect(formatToolResult(event, undefined)).toBeUndefined()
  })

  it('test_a_real_shell_failure_still_shows_its_output_and_code', () => {
    // Anti-vacuity, and the reason 126 alone is not the signal: a real shell returns 126 for
    // "command not executable", which deserves different words from "you said no".
    expect(
      result(
        JSON.stringify({ stdout: '', stderr: 'bash: ./x: Permission denied', exit_code: 126 }),
      ),
    ).toBe('bash: ./x: Permission denied\n(exit code: 126)')
  })

  it('test_a_successful_run_is_untouched', () => {
    expect(result(JSON.stringify({ stdout: 'hi\n', stderr: '', exit_code: 0 }))).toBe('hi')
  })
})

/**
 * The toolkit's default table is NOT composed in — measured, then reverted.
 *
 * It was added as a fallback so `GitDiff`, `Grep`, `Glob` and `Read` would stop rendering
 * as raw snake_case names. All four are in `DEFAULT_EXPLORE_TOOLS`, and `ToolHeaderFormatter`'s
 * docblock says returning a name for such a tool opts it OUT of the explored collapse. Measured on
 * three consecutive `Read` calls: `explored` (one block) became three separate cards.
 *
 * The grouping is the Claude Code shape this product is chasing, so the fallback was a pure loss.
 * These tests pin the trade in both directions, because the argument for adding it back is
 * persuasive and the cost is invisible from the call site.
 */
describe('the explored grouping is worth more than a verb on a card', () => {
  it('test_an_explored_tool_is_left_unnamed_so_its_run_can_collapse', () => {
    for (const tool of ['Read', 'Glob', 'Grep', 'GitDiff']) {
      expect(
        formatToolHeader({ name: tool, status: 'completed', input: {} } as never),
        `${tool} is in DEFAULT_EXPLORE_TOOLS — naming it breaks the collapse`,
      ).toBe(undefined)
    }
  })

  it('test_our_own_table_still_names_what_it_knows', () => {
    // Anti-vacuity: a formatter that returned `undefined` for everything would satisfy the case
    // above and delete every header in the product.
    expect(
      formatToolHeader({
        name: 'Bash',
        status: 'running',
        input: { command: 'echo hi' },
      } as never)?.name,
    ).toBe('Running echo hi')
    expect(
      formatToolHeader({
        name: 'ViewImage',
        status: 'completed',
        input: { path: 'a.png' },
      } as never)?.name,
    ).toBe('Viewed a.png')
  })
})

/**
 * A call a policy refused must not be reported as one that ran either.
 *
 * Measured in the TUI on 2026-10-02: a permissions gate refused `ApplyPatch` before it ran and
 * `ctrl+o` showed `Edited hello.txt (+1 -0)` for a file that was never written. The signal is the
 * typed `refusal` (`policy`, `hook`), whatever the output says.
 */
const refused = (name: string, input: Record<string, unknown>) =>
  ({
    kind: 'tool',
    name,
    status: 'failed',
    input,
    refusal: { by: 'policy', reason: `\`${name}\` matched no rule in your \`permissions\` block` },
  }) as never

describe('a tool call a policy refused is not reported as one that ran', () => {
  it('test_a_refused_patch_is_not_reported_as_an_edit', () => {
    const header = formatToolHeader(
      refused('ApplyPatch', {
        patch: '*** Begin Patch\n*** Add File: hello.txt\n+tui-ok\n*** End Patch',
      }),
    )

    expect(header?.name, 'the transcript claims a refused patch edited a file').not.toMatch(
      /^Edited /,
    )
    expect(header?.name).toBe('Blocked the patch')
    expect(header?.summary).toContain('nothing ran')
  })

  it('test_a_refused_command_is_not_reported_as_run', () => {
    expect(formatToolHeader(refused('Bash', { command: 'ls' }))?.name).toBe('Blocked ls')
  })

  it('test_the_refusal_wins_over_whatever_the_output_became', () => {
    // The result formatter and `turnErrorText` rewrite `output` before the header sees it; the
    // header must not depend on what they left there.
    for (const output of [
      'nothing ran: x',
      '{"stdout":"hi"} — set THEOCODE_DIAGNOSTICS=stderr',
      '',
    ]) {
      const event = { ...(refused('ApplyPatch', {}) as object), output } as never
      expect(formatToolHeader(event)?.name).toBe('Blocked the patch')
    }
  })

  it('test_a_hook_refusal_reads_as_a_block', () => {
    expect(
      formatToolHeader({
        ...(refused('Bash', { command: 'ls' }) as object),
        refusal: { by: 'hook' },
      } as never)?.name,
    ).toBe('Blocked ls')
  })

  it('test_a_human_rejection_still_reads_as_a_rejection', () => {
    expect(formatToolHeader(denied('ApplyPatch', {}))?.name).toBe('Rejected the patch')
  })

  it('test_a_real_shell_126_without_a_refusal_is_not_a_block', () => {
    // Only a typed `refusal` marks a refused call; the exit code and the text never do.
    const ran = {
      kind: 'tool',
      name: 'Bash',
      status: 'failed',
      input: { command: './x' },
      output: JSON.stringify({ stdout: '', stderr: 'denied by human approver', exitCode: 126 }),
    } as never

    expect(formatToolHeader(ran)?.name).toBe('Ran ./x')
  })
})

describe('Bash, Edit and ApplyPatch headers come from the toolkit presentation', () => {
  const header = (name: string, input: Record<string, unknown>, status = 'completed') =>
    formatToolHeader({ kind: 'tool', name, status, input } as never)

  it('words Bash and Edit by tense and flattens a multi-line command', () => {
    expect(header('Bash', { command: 'ls\nx' }, 'running')?.name).toBe('Running ls⏎x')
    expect(header('Bash', { command: 'ls' })?.name).toBe('Ran ls')
    expect(header('Edit', { path: 'a.ts' })?.name).toBe('Edited a.ts')
  })

  it('keeps the own fallbacks for a missing target, and the patch counts', () => {
    expect(header('Bash', {})?.name).toBe('Ran')
    expect(header('Bash', { command: '' }, 'running')?.name).toBe('Running')
    expect(header('Edit', {})?.name).toBe('Edited file')
    expect(header('ApplyPatch', { patch: 'garbage' })?.name).toBe('Edited files')
    const patch = [1, 2, 3, 4].map((n) => `*** Update File: f${n}.ts\n@@\n-a\n+b`).join('\n')
    const wrapped = `*** Begin Patch\n${patch}\n*** End Patch`
    expect(header('ApplyPatch', { patch: wrapped })?.name).toMatch(
      /^Edited f1\.ts, f2\.ts, f3\.ts \+1 more/,
    )
    expect(header('ApplyPatch', { patch: wrapped }, 'running')?.name).toMatch(/^Editing /)
    const counted = '*** Begin Patch\n*** Update File: a.ts\n@@\n-a\n+b\n*** End Patch'
    expect(header('ApplyPatch', { patch: counted })?.name).toMatch(/^Edited a\.ts.*\+1/)
  })

  it('fails loudly when the installed toolkit has no entry for an aliased tool', async () => {
    vi.resetModules()
    vi.doMock('@theokit/tui', () => ({ toolPresentation: () => new Map() }))
    const mod = await import('../../src/formatting/tool-header.js')
    expect(() =>
      mod.formatToolHeader({ kind: 'tool', name: 'Bash', status: 'completed', input: {} } as never),
    ).toThrow(/@theokit\/tui >= 0\.83\.4/)
    vi.doUnmock('@theokit/tui')
  })
})
