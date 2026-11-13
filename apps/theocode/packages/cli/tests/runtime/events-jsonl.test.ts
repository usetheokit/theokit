/**
 * The Codex JSONL dialect — what `theokit run --json` actually emits.
 *
 * B-123 migrated this onto the framework's lifecycle fold, and three mutations survived the whole
 * CLI suite while doing it: closing a failed turn as completed, dropping the error entirely, and
 * never accumulating text. Nothing covered the emitter, and it is the contract every consumer of
 * the JSONL output reads.
 *
 * These pin the WIRE, not the fold. The fold's own invariants are tested in `@theokit/presenter`;
 * what belongs here is that this product's words come out in the right shape and in the right order.
 */
import { describe, expect, it } from 'vitest'

import {
  createHumanProcessor,
  createJsonlProcessor,
  execExitCode,
  type ExecIo,
} from '../../src/runtime/events.js'
import { USAGE } from '../../src/runtime/usage.js'

function capture() {
  const lines: string[] = []
  const err: string[] = []
  const io: ExecIo = { out: (l) => lines.push(l), err: (l) => err.push(l) }
  return { io, err, events: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) }
}

const types = (events: Record<string, unknown>[]) => events.map((e) => e['type'])

/**
 * Two defects that lived in this file, and one hid the other.
 *
 * **`finish('ok')`** — `ExecProcessor.finish` accepts `'finished' | 'error'`. Six calls here passed
 * `'ok'`, which is the INTERNAL vocabulary (`outcome.status`), not the API's. The tests passed
 * because the implementation only asks `status === 'error'`, so `'ok'` fell into the same branch as
 * `'finished'` — accidentally correct behaviour over an invalid call.
 *
 * **The eight `as never`** — they were not needed. `ChunkLike` is structural and loose
 * (`type: string`), and every literal here already satisfied it. Removed, `tsc` comes back clean.
 *
 * The relationship between the two is what is worth recording: the casts ANAESTHETISED the file.
 * With `as never` scattered through it, nobody reads the errors that remain — I called those six a
 * "pre-existing baseline" for an entire session without once reading what they said.
 */

describe('createJsonlProcessor — the turn opens and closes exactly once', () => {
  it('test_a_clean_turn_emits_thread_then_turn_then_completion', () => {
    const c = capture()
    const p = createJsonlProcessor(c.io, 'thread-1')
    p.finish('finished')

    expect(types(c.events())).toEqual(['thread.started', 'turn.started', 'turn.completed'])
    expect(c.events()[0]?.['thread_id']).toBe('thread-1')
  })

  it('test_an_error_chunk_closes_the_turn_as_failed_not_completed', () => {
    // Survived as a mutation: dropping the error left the turn closing as completed, and a caller
    // reading the JSONL would record a successful run.
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'error', errorText: 'boom' })
    p.finish('finished')

    expect(types(c.events())).toContain('turn.failed')
    expect(types(c.events())).not.toContain('turn.completed')
  })

  it('test_the_returned_result_reports_the_error_the_stream_carried', () => {
    // Survived as a mutation, and the reason is worth keeping: the FOLD already closes the turn as
    // failed, so dropping this flag left the wire correct while `ProcessorResult.errorSeen` — which
    // the caller reads to set its exit code — went false. A run that failed would have exited 0.
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'error', errorText: 'boom' })

    expect(p.finish('finished').errorSeen).toBe(true)
  })

  it('test_a_declared_error_status_closes_as_failed_too', () => {
    const c = capture()
    createJsonlProcessor(c.io, 't').finish('error', { error: 'transport' })

    expect(types(c.events())).toContain('turn.failed')
  })

  it('test_the_turn_closes_once_even_when_both_signals_fire', () => {
    // Anti-vacuity for the two above, and the defect the hand-rolled version guarded with a flag:
    // an error chunk AND an error status must still produce exactly one closing event.
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'error', errorText: 'boom' })
    p.finish('error', { error: 'also' })

    expect(
      types(c.events()).filter((t) => t === 'turn.failed' || t === 'turn.completed'),
    ).toHaveLength(1)
  })
})

describe('createJsonlProcessor — text becomes one message item', () => {
  it('test_accumulated_deltas_are_emitted_as_a_single_agent_message', () => {
    // Survived as a mutation: dropping accumulation emitted no message at all, and the run looked
    // like the agent had said nothing.
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'text-delta', id: 't1', delta: 'hel' })
    p.process({ type: 'text-delta', id: 't1', delta: 'lo' })
    const result = p.finish('finished')

    const message = c.events().find((e) => e['type'] === 'item.completed')
    expect((message?.['item'] as Record<string, unknown> | undefined)?.['text']).toBe('hello')
    expect(result.finalText).toBe('hello')
  })

  it('test_a_turn_with_no_text_emits_no_message_item', () => {
    // A blank agent_message renders as an empty bubble in every consumer of this wire.
    const c = capture()
    createJsonlProcessor(c.io, 't').finish('finished')

    expect(types(c.events())).not.toContain('item.completed')
  })
})

describe('createJsonlProcessor — tool calls open and close items', () => {
  it('test_a_tool_call_and_its_result_bracket_one_item', () => {
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'tool-input-available', toolCallId: 'c1', toolName: 'read', input: {} })
    p.process({ type: 'tool-output-available', toolCallId: 'c1', output: 'ok' })
    p.finish('finished')

    expect(types(c.events())).toEqual([
      'thread.started',
      'turn.started',
      'item.started',
      'item.completed',
      'turn.completed',
    ])
  })

  it('test_parallel_calls_get_distinct_item_ids', () => {
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'tool-input-available', toolCallId: 'a', toolName: 'Read', input: {} })
    p.process({ type: 'tool-input-available', toolCallId: 'b', toolName: 'Read', input: {} })

    const ids = c
      .events()
      .filter((e) => e['type'] === 'item.started')
      .map((e) => (e['item'] as Record<string, unknown>)['id'])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('test_a_failed_call_completes_as_failed_and_keeps_its_tool_name', () => {
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'tool-input-available', toolCallId: 'a', toolName: 'Read', input: {} })
    p.process({ type: 'tool-input-available', toolCallId: 'b', toolName: 'Read', input: {} })
    p.process({ type: 'tool-output-error', toolCallId: 'a', errorText: 'ENOENT' })
    p.process({ type: 'tool-output-available', toolCallId: 'b', output: 'ok' })

    const done = c
      .events()
      .filter((e) => e['type'] === 'item.completed')
      .map((e) => e['item'] as Record<string, unknown>)
    expect(done).toHaveLength(2)
    expect(done[0]).toMatchObject({ command: 'Read', status: 'failed' })
    expect(done[1]).toMatchObject({ command: 'Read', status: 'completed' })
    expect(done[0]?.['id']).not.toBe(done[1]?.['id'])
  })

  it('test_the_human_surface_prints_a_failure_line', () => {
    const err: string[] = []
    const p = createHumanProcessor({ out: () => {}, err: (l) => err.push(l) }, 's')
    p.process({ type: 'tool-input-available', toolCallId: 'a', toolName: 'Read', input: {} })
    p.process({ type: 'tool-output-error', toolCallId: 'a', errorText: 'ENOENT' })

    expect(err).toContain('  failed: ENOENT')
  })

  it('test_an_unmapped_chunk_emits_nothing', () => {
    // The stream carries more than a lifecycle needs. A chunk this dialect does not model must not
    // produce a stray event, which no consumer of the wire could interpret.
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'reasoning-delta', id: 'r1', delta: 'thinking' })

    expect(types(c.events())).toEqual(['thread.started', 'turn.started'])
  })
})

describe('a turn cut by the loop', () => {
  const cut = { type: 'finish', messageMetadata: { stopReason: 'step_limit' } } as never
  it('test_jsonl_cut_turn_fails_and_carries_the_reason', () => {
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process(cut)
    const result = p.finish('finished')
    expect(types(c.events())).toContain('turn.failed')
    expect(types(c.events())).not.toContain('turn.completed')
    expect(JSON.stringify(c.events())).toContain('turn cut: step_limit')
    expect(result.stopReason).toBe('step_limit')
    expect(execExitCode(result, undefined)).toBe(2)
  })

  it('test_a_finish_without_stop_reason_still_exits_zero', () => {
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'finish', messageMetadata: { usage: {} } } as never)
    const result = p.finish('finished')
    expect(types(c.events())).toContain('turn.completed')
    expect(result.stopReason).toBeUndefined()
    expect(execExitCode(result, undefined)).toBe(0)
  })

  it('test_human_exec_line_says_why_the_turn_was_cut', () => {
    const err: string[] = []
    const p = createHumanProcessor({ out: () => {}, err: (l) => err.push(l) }, 't')
    p.process(cut)
    const result = p.finish('finished')
    expect(err.join('\n')).toContain('status=cut stop=step_limit')
    expect(result.stopReason).toBe('step_limit')
    expect(execExitCode(result, undefined)).not.toBe(0)
  })

  it('test_usage_text_lists_the_cut_turn_exit_code', () => {
    expect(USAGE).toContain('Exit code is 2 when the loop cut the turn')
  })
})
