import { describe, expect, it } from 'vitest'

import {
  APPROVAL_KEY_HINT,
  approvalChoices,
  formatApproval,
  formatToolHeader,
  formatToolResult,
  REJECTED_BODY,
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
    expect(formatApproval({ toolName: 'run_shell', input: { command: 'ls' } }).hint).toBe(
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
    const card = formatApproval({ toolName: 'run_shell', input: { command: 'echo hi' } })

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
    const card = formatApproval({ toolName: 'run_shell', input: { command: 'ls' } })

    expect(card.choices.map((c) => c.label)).not.toEqual(['Yes', 'No'])
    expect(card.choices.at(-1)?.value).toBe('no')
  })
})

/**
 * A rejected call must not be reported as one that ran.
 *
 * Measured in the TUI by rejecting a real approval and dumping the event the renderer receives:
 *
 *     {"kind":"tool","name":"Ran echo probe2","status":"failed",
 *      "output":"{\"stdout\":\"\",\"stderr\":\"Tool 'run_shell' denied by human approver\",
 *                \"exitCode\":126}"}
 *
 * Every header here reads `failed` as "not active" and prints the past tense, so the transcript
 * said `Ran echo probe2` for a command that never executed. B-027 deleted a detector for this exact
 * shape on the grounds that "nothing in this repository or the SDK produces exit code 126"; the
 * measurement above says otherwise.
 */
const denied = (name: string, input: Record<string, unknown>) =>
  ({
    kind: 'tool',
    name,
    status: 'failed',
    input,
    output: JSON.stringify({
      stdout: '',
      stderr: `Tool '${name}' denied by human approver`,
      exitCode: 126,
    }),
  }) as never

describe('a rejected tool call is not reported as one that ran', () => {
  it('test_the_header_does_not_claim_the_command_ran', () => {
    const header = formatToolHeader(denied('run_shell', { command: 'echo probe2' }))

    expect(header?.name, 'the transcript claims a rejected command ran').not.toMatch(/^Ran /)
    expect(header?.name).toBe('Rejected echo probe2')
  })

  it('test_it_says_nothing_changed', () => {
    // The question a user asks after rejecting is "did anything happen?". A header alone leaves it
    // open; the summary answers it.
    expect(formatToolHeader(denied('run_shell', { command: 'rm -rf /' }))?.summary).toContain(
      'nothing ran',
    )
  })

  it('test_a_write_tool_is_named_by_what_it_would_have_done', () => {
    expect(formatToolHeader(denied('apply_patch', {}))?.name).toBe('Rejected the patch')
    expect(formatToolHeader(denied('edit_file', { path: 'a.ts' }))?.name).toBe('Rejected the edit')
  })

  it('test_it_recognises_the_body_the_RESULT_formatter_already_produced', () => {
    // The ordering trap. Since usetheokit/theokit-tui#156 the result formatter runs FIRST and
    // replaces `output`, so the header no longer sees the runtime's raw payload — it sees
    // `REJECTED_BODY`. Matching only the raw form stopped working the moment that fix landed, and
    // the symptom was a body reading `rejected — nothing ran` under a header saying `Ran echo …`.
    const afterResultFormatter = {
      kind: 'tool',
      name: 'run_shell',
      status: 'failed',
      input: { command: 'echo parity-final' },
      output: REJECTED_BODY,
    } as never

    expect(formatToolHeader(afterResultFormatter)?.name).toBe('Rejected echo parity-final')
  })

  it('test_a_call_that_actually_ran_is_untouched', () => {
    // Anti-vacuity: treating every `failed` as a rejection would relabel real command failures,
    // which is the opposite mistake and just as misleading.
    const ran = {
      kind: 'tool',
      name: 'run_shell',
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
      name: 'run_shell',
      status: 'running',
      input: { command: 'sleep 1' },
    } as never

    expect(formatToolHeader(running)?.name).toBe('Running sleep 1')
  })
})

/**
 * The BODY of a rejected call, which used to reach the user as raw JSON:
 *
 *     ⎿ {"stdout":"","stderr":"Tool 'run_shell' denied by human approver","exitCode":126}
 *
 * Not a formatting oversight here — `formatToolResult` was never CALLED on the failure path.
 * `toToolEvent` gated the override on a field an errored part does not populate
 * (usetheokit/theokit-tui#156). With the gate fixed upstream, this is the body it produces.
 */
describe('the body of a rejected call', () => {
  const result = (raw: unknown) =>
    formatToolResult({ name: 'run_shell', status: 'failed' } as never, raw)?.output

  it('test_a_rejection_reads_as_a_rejection_not_as_a_shell_result', () => {
    expect(
      result(JSON.stringify({ stdout: '', stderr: "Tool 'run_shell' denied by human approver", exitCode: 126 })),
    ).toBe('rejected — nothing ran')
  })

  it('test_a_real_shell_failure_still_shows_its_output_and_code', () => {
    // Anti-vacuity, and the reason 126 alone is not the signal: a real shell returns 126 for
    // "command not executable", which deserves different words from "you said no".
    expect(result(JSON.stringify({ stdout: '', stderr: 'bash: ./x: Permission denied', exit_code: 126 }))).toBe(
      'bash: ./x: Permission denied\n(exit code: 126)',
    )
  })

  it('test_a_successful_run_is_untouched', () => {
    expect(result(JSON.stringify({ stdout: 'hi\n', stderr: '', exit_code: 0 }))).toBe('hi')
  })
})

/**
 * The toolkit's default table is NOT composed in — measured, then reverted.
 *
 * It was added as a fallback so `git_diff`, `grep`, `list_dir` and `read_file` would stop rendering
 * as raw snake_case names. All four are in `DEFAULT_EXPLORE_TOOLS`, and `ToolHeaderFormatter`'s
 * docblock says returning a name for such a tool opts it OUT of the explored collapse. Measured on
 * three consecutive `read_file` calls: `explored` (one block) became three separate cards.
 *
 * The grouping is the Claude Code shape this product is chasing, so the fallback was a pure loss.
 * These tests pin the trade in both directions, because the argument for adding it back is
 * persuasive and the cost is invisible from the call site.
 */
describe('the explored grouping is worth more than a verb on a card', () => {
  it('test_an_explored_tool_is_left_unnamed_so_its_run_can_collapse', () => {
    for (const tool of ['read_file', 'list_dir', 'grep', 'git_diff']) {
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
        name: 'run_shell',
        status: 'running',
        input: { command: 'echo hi' },
      } as never)?.name,
    ).toBe('Running echo hi')
    expect(
      formatToolHeader({ name: 'view_image', status: 'completed', input: { path: 'a.png' } } as never)
        ?.name,
    ).toBe('Viewed a.png')
  })
})
