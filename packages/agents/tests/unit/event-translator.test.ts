/**
 * NF-1 — event-translator must read the REAL @theokit/sdk SDKMessage union.
 *
 * `Run.stream(): AsyncGenerator<SDKMessage, void>` (theokit-sdk types/run.ts:279)
 * yields raw SDKMessage straight into translateSdkEvent (sdk-adapter.ts:139). The
 * translator was reading fields that do not exist on the real union:
 *   - assistant content lives at `msg.message.content`, NOT `msg.content`
 *   - tool_call id lives at `msg.call_id`, NOT `msg.id`
 *   - status enum is UPPERCASE `FINISHED|ERROR|CANCELLED|EXPIRED`, not `done|error`
 *   - thinking text lives at `msg.text`, NOT `msg.content`
 * Against a live SDK this made the answer text vanish and ERROR status get
 * swallowed (fail-loud violation). These RED tests script the EXACT real shapes
 * (verified against theokit-sdk/packages/sdk/src/types/messages.ts).
 */
import { describe, expect, it } from 'vitest'

import { translateInteractionUpdate, translateSdkEvent } from '../../src/bridge/event-translator.js'

const RUN = 'run-1'

describe('translateSdkEvent — real SDKMessage shapes (NF-1)', () => {
  it('test_assistant_text_from_message_content — reads msg.message.content, not msg.content', () => {
    // Real SDKAssistantMessage (messages.ts:58): content is at msg.message.content
    const events = translateSdkEvent(
      {
        type: 'assistant',
        agent_id: 'a',
        run_id: RUN,
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] },
      },
      RUN,
    )
    expect(events).toEqual([{ type: 'text_delta', content: 'Hello world' }])
  })

  it('test_assistant_tool_use_block_from_message_content — tool_use block emits tool_call', () => {
    const events = translateSdkEvent(
      {
        type: 'assistant',
        agent_id: 'a',
        run_id: RUN,
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tu-1', name: 'read', input: { path: 'x' } }],
        },
      },
      RUN,
    )
    expect(events).toEqual([
      { type: 'tool_call', callId: 'tu-1', toolName: 'read', input: { path: 'x' } },
    ])
  })

  it('test_tool_call_completed_uses_call_id — real SDKToolUseMessage.call_id (not .id)', () => {
    // Real SDKToolUseMessage (messages.ts:89): call_id + status completed + result
    const events = translateSdkEvent(
      {
        type: 'tool_call',
        agent_id: 'a',
        run_id: RUN,
        call_id: 'c-1',
        name: 'read',
        status: 'completed',
        result: 'ok',
      },
      RUN,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      callId: 'c-1',
      toolName: 'read',
      output: 'ok',
      isError: false,
    })
  })

  it('test_tool_call_completed_serializes_object_result — non-string result becomes JSON', () => {
    // #41: object tool results were dropped (asString → ''); now serialized to JSON.
    const events = translateSdkEvent(
      {
        type: 'tool_call',
        agent_id: 'a',
        run_id: RUN,
        call_id: 'c1',
        name: 'glob',
        status: 'completed',
        result: { ok: true, files: ['a'] },
      },
      RUN,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      callId: 'c1',
      toolName: 'glob',
      output: '{"ok":true,"files":["a"]}',
      isError: false,
    })
  })

  it('test_tool_call_error_uses_call_id_and_result', () => {
    const events = translateSdkEvent(
      {
        type: 'tool_call',
        agent_id: 'a',
        run_id: RUN,
        call_id: 'c-2',
        name: 'write',
        status: 'error',
        result: 'disk full',
      },
      RUN,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      callId: 'c-2',
      isError: true,
      output: 'disk full',
    })
  })

  it('test_tool_call_running_emits_tool_call — running status emits a tool_call card with args', () => {
    // #42: running status now emits a tool_call so the UI shows a running card with input args.
    expect(
      translateSdkEvent(
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: RUN,
          call_id: 'c1',
          name: 'glob',
          status: 'running',
          input: { p: '*' },
        },
        RUN,
      ),
    ).toEqual([{ type: 'tool_call', callId: 'c1', toolName: 'glob', input: { p: '*' } }])
  })

  it('test_running_tool_call_surfaces_args_as_input — real SDK field is msg.args (theokit#58)', () => {
    // theokit#58: the real SDKToolUseMessage carries the tool args in `args`
    // (run-D22b53SU.d.ts:486; live TC-DIAG confirmed `args={"command":...}`),
    // NOT `input`/`arguments`. Reading the wrong field surfaced an empty card.
    expect(
      translateSdkEvent(
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: RUN,
          call_id: 'c1',
          name: 'shell_exec',
          status: 'running',
          args: { command: 'echo hi' },
        },
        RUN,
      ),
    ).toEqual([
      { type: 'tool_call', callId: 'c1', toolName: 'shell_exec', input: { command: 'echo hi' } },
    ])
  })

  it('test_running_tool_call_args_takes_precedence_over_legacy_fields — args wins (theokit#58)', () => {
    expect(
      translateSdkEvent(
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: RUN,
          call_id: 'c1',
          name: 'shell_exec',
          status: 'running',
          args: { a: 1 },
          input: { b: 2 },
        },
        RUN,
      ),
    ).toEqual([{ type: 'tool_call', callId: 'c1', toolName: 'shell_exec', input: { a: 1 } }])
  })

  it('test_running_tool_call_absent_args_is_empty_object — defensive default, no throw (theokit#58)', () => {
    expect(
      translateSdkEvent(
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: RUN,
          call_id: 'c1',
          name: 'shell_exec',
          status: 'running',
        },
        RUN,
      ),
    ).toEqual([{ type: 'tool_call', callId: 'c1', toolName: 'shell_exec', input: {} }])
  })

  it('test_running_tool_call_nonobject_args_passthrough — primitive args pass through, no throw (theokit#58 failure-scenario)', () => {
    // Failure scenario (plan): a non-object `args` (e.g. a raw string) must pass through
    // as-is (?? only short-circuits on nullish) — no throw; downstream coerces.
    expect(
      translateSdkEvent(
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: RUN,
          call_id: 'c1',
          name: 'shell_exec',
          status: 'running',
          args: 'raw-string',
        },
        RUN,
      ),
    ).toEqual([{ type: 'tool_call', callId: 'c1', toolName: 'shell_exec', input: 'raw-string' }])
  })

  it('test_status_FINISHED_maps_to_done — uppercase enum (messages.ts:110)', () => {
    const events = translateSdkEvent(
      { type: 'status', agent_id: 'a', run_id: RUN, status: 'FINISHED' },
      RUN,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'done' })
  })

  it('test_status_ERROR_maps_to_error — fail-loud, not swallowed (Unbreakable Rule 8)', () => {
    const events = translateSdkEvent(
      { type: 'status', agent_id: 'a', run_id: RUN, status: 'ERROR', message: 'run failed' },
      RUN,
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'error', message: 'run failed' })
  })

  it('test_status_EXPIRED_maps_to_error — timeout is a failure', () => {
    const events = translateSdkEvent(
      { type: 'status', agent_id: 'a', run_id: RUN, status: 'EXPIRED' },
      RUN,
    )
    expect(events[0]).toMatchObject({ type: 'error' })
  })

  it('test_status_RUNNING_creating_emit_nothing — in-progress', () => {
    expect(
      translateSdkEvent({ type: 'status', agent_id: 'a', run_id: RUN, status: 'RUNNING' }, RUN),
    ).toEqual([])
    expect(
      translateSdkEvent({ type: 'status', agent_id: 'a', run_id: RUN, status: 'CREATING' }, RUN),
    ).toEqual([])
  })

  it('test_thinking_from_text — real SDKThinkingMessage.text (not .content)', () => {
    const events = translateSdkEvent(
      { type: 'thinking', agent_id: 'a', run_id: RUN, text: 'reasoning…' },
      RUN,
    )
    expect(events).toEqual([{ type: 'thinking', content: 'reasoning…' }])
  })
})

// #44 — real-time onDelta InteractionUpdate → StreamEvent mapping (chronological ordering fix).
// Shapes verified against theokit-sdk/packages/sdk/src/types/updates.ts:
//   text-delta {text}, thinking-delta {text}, tool-call-started/completed {callId, toolCall:{callId,name,args?,result?}, modelCallId}.
describe('translateInteractionUpdate — real-time InteractionUpdate shapes (#44)', () => {
  it('test_translate_text_delta_emits_text_delta', () => {
    expect(translateInteractionUpdate({ type: 'text-delta', text: 'hi' })).toEqual([
      { type: 'text_delta', content: 'hi' },
    ])
  })

  it('test_translate_empty_text_delta_emits_nothing', () => {
    expect(translateInteractionUpdate({ type: 'text-delta', text: '' })).toEqual([])
  })

  it('test_translate_thinking_delta_emits_thinking', () => {
    expect(translateInteractionUpdate({ type: 'thinking-delta', text: 'reason' })).toEqual([
      { type: 'thinking', content: 'reason' },
    ])
  })

  it('test_translate_empty_thinking_delta_emits_nothing', () => {
    expect(translateInteractionUpdate({ type: 'thinking-delta', text: '' })).toEqual([])
  })

  it('test_translate_tool_call_completed_null_result_falls_back_to_empty', () => {
    expect(
      translateInteractionUpdate({
        type: 'tool-call-completed',
        callId: 'c4',
        modelCallId: 'm4',
        toolCall: { callId: 'c4', name: 'noop' },
      }),
    ).toEqual([
      {
        type: 'tool_result',
        callId: 'c4',
        toolName: 'noop',
        output: '',
        durationMs: 0,
        isError: false,
      },
    ])
  })

  it('test_translate_tool_call_started_emits_tool_call', () => {
    expect(
      translateInteractionUpdate({
        type: 'tool-call-started',
        callId: 'c1',
        modelCallId: 'm1',
        toolCall: { callId: 'c1', name: 'write_file', args: { path: 'a.txt' } },
      }),
    ).toEqual([
      { type: 'tool_call', callId: 'c1', toolName: 'write_file', input: { path: 'a.txt' } },
    ])
  })

  it('test_translate_tool_call_started_defaults_missing_args_to_empty', () => {
    expect(
      translateInteractionUpdate({
        type: 'tool-call-started',
        callId: 'c2',
        modelCallId: 'm2',
        toolCall: { callId: 'c2', name: 'glob_files' },
      }),
    ).toEqual([{ type: 'tool_call', callId: 'c2', toolName: 'glob_files', input: {} }])
  })

  it('test_translate_tool_call_completed_serializes_object_result', () => {
    const events = translateInteractionUpdate({
      type: 'tool-call-completed',
      callId: 'c1',
      modelCallId: 'm1',
      toolCall: { callId: 'c1', name: 'glob_files', result: { ok: true, count: 2 } },
    })
    expect(events).toEqual([
      {
        type: 'tool_result',
        callId: 'c1',
        toolName: 'glob_files',
        output: '{"ok":true,"count":2}',
        durationMs: 0,
        isError: false,
      },
    ])
  })

  it('test_translate_tool_call_completed_string_result_passthrough', () => {
    const events = translateInteractionUpdate({
      type: 'tool-call-completed',
      callId: 'c3',
      modelCallId: 'm3',
      toolCall: { callId: 'c3', name: 'shell', result: 'done' },
    })
    expect(events).toEqual([
      {
        type: 'tool_result',
        callId: 'c3',
        toolName: 'shell',
        output: 'done',
        durationMs: 0,
        isError: false,
      },
    ])
  })

  it('test_translate_unknown_update_emits_nothing', () => {
    expect(translateInteractionUpdate({ type: 'token-delta', tokens: 5 })).toEqual([])
    expect(
      translateInteractionUpdate({ type: 'thinking-completed', thinkingDurationMs: 10 }),
    ).toEqual([])
    expect(translateInteractionUpdate({ type: 'step-started', stepId: 1 })).toEqual([])
  })

  // theokit-sdk#70 — surface the SDK's partial-tool-call so consumers can stream tool-input.
  it('test_partial_tool_call_update_is_translated', () => {
    const out = translateInteractionUpdate({
      type: 'partial-tool-call',
      callId: 'c1',
      modelCallId: 'm1',
      toolCall: { callId: 'c1', name: 'write_file', args: { path: 'a.ts' } },
    })
    expect(out).toEqual([
      { type: 'partial_tool_call', callId: 'c1', toolName: 'write_file', input: { path: 'a.ts' } },
    ])
  })

  it('test_partial_tool_call_defaults_missing_args_to_empty', () => {
    const out = translateInteractionUpdate({
      type: 'partial-tool-call',
      callId: 'c2',
      modelCallId: 'm2',
      toolCall: { callId: 'c2', name: 'glob_files' },
    })
    expect(out).toEqual([
      { type: 'partial_tool_call', callId: 'c2', toolName: 'glob_files', input: {} },
    ])
  })

  it('test_partial_tool_call_emits_no_tool_call', () => {
    // D1 invariant: the partial update must NOT duplicate the `tool_call` event
    // (that comes only from `tool-call-started`, args-committed).
    const out = translateInteractionUpdate({
      type: 'partial-tool-call',
      callId: 'c3',
      modelCallId: 'm3',
      toolCall: { callId: 'c3', name: 'edit_file', args: { old: 'x' } },
    })
    const toolCalls = out.filter((e) => e.type === 'tool_call')
    expect(toolCalls).toHaveLength(0)
  })
})
