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

import { createJsonlProcessor, type ExecIo } from '../../src/runtime/events.js'

function capture() {
  const lines: string[] = []
  const io: ExecIo = { out: (l) => lines.push(l), err: () => {} }
  return { io, events: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) }
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
    p.process({ type: 'text-delta', delta: 'hel' })
    p.process({ type: 'text-delta', delta: 'lo' })
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
    p.process({ type: 'tool-input-available', id: 'c1', toolName: 'read' })
    p.process({ type: 'tool-output-available', id: 'c1', toolName: 'read' })
    p.finish('finished')

    expect(types(c.events())).toEqual([
      'thread.started',
      'turn.started',
      'item.started',
      'item.completed',
      'turn.completed',
    ])
  })

  it('test_an_unmapped_chunk_emits_nothing', () => {
    // The stream carries more than a lifecycle needs. A chunk this dialect does not model must not
    // produce a stray event, which no consumer of the wire could interpret.
    const c = capture()
    const p = createJsonlProcessor(c.io, 't')
    p.process({ type: 'reasoning-delta', delta: 'thinking' })

    expect(types(c.events())).toEqual(['thread.started', 'turn.started'])
  })
})
