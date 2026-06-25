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

import { translateSdkEvent } from '../../src/bridge/event-translator.js'

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

  it('test_tool_call_running_emits_nothing', () => {
    expect(
      translateSdkEvent(
        {
          type: 'tool_call',
          agent_id: 'a',
          run_id: RUN,
          call_id: 'c-3',
          name: 'read',
          status: 'running',
        },
        RUN,
      ),
    ).toEqual([])
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
