/**
 * `--help` promises "Stdout carries ONLY the final message". It carried every message, joined.
 *
 * A turn emits text more than once: the instructions ask for a preamble before a burst of tool
 * calls and a closing recap after the last one, and both arrive as `text-delta` with nothing in the
 * stream marking the boundary. The processors concatenated them, so on a two-step task measured
 * 2026-08-25 stdout read:
 *
 *     I'll read `duration.mjs` and report its contents briefly.`duration.mjs:2` defines …
 *
 * Two messages with no separator, because nothing ever meant to join them. `-o/--output-last-message`
 * wrote that same run-on string to a file a script then reads. Codex, on the same task, prints the
 * closing message alone.
 *
 * These tests pin the boundary rule — a tool call ends the current message — on BOTH processors,
 * because both derive `finalText` and only one of them writes stdout.
 */
import { describe, expect, it } from 'vitest'

import { createHumanProcessor, createJsonlProcessor, type ExecIo } from '../../src/runtime/events.js'

function capture(): { io: ExecIo; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err }
}

const text = (delta: string) => ({ type: 'text-delta' as const, delta })
const toolCall = (toolName: string) => ({
  type: 'tool-input-available' as const,
  toolName,
  input: {},
})

describe('the preamble is not part of the final message', () => {
  it('test_stdout_carries_the_closing_message_alone', () => {
    const { io, out } = capture()
    const p = createHumanProcessor(io, 'sess-1')

    p.process(text("I'll read duration.mjs and report briefly."))
    p.process(toolCall('read_file'))
    p.process({ type: 'tool-output-available' })
    p.process(text('parseDuration converts seconds to milliseconds.'))
    const result = p.finish('finished')

    expect(out, 'stdout emitted more than the final message').toEqual([
      'parseDuration converts seconds to milliseconds.',
    ])
    expect(result.finalText, '--output-last-message would write the preamble too').toBe(
      'parseDuration converts seconds to milliseconds.',
    )
  })

  it('test_the_preamble_is_reported_on_stderr_before_the_call_it_announces', () => {
    // Not discarded — it is the running commentary that makes the work legible, and stderr is
    // where the rest of the progress already goes. Order matters: a preamble printed after its
    // tool call announces something that already happened.
    const { io, err } = capture()
    const p = createHumanProcessor(io, 'sess-1')

    p.process(text('Patching the parser now.'))
    p.process(toolCall('apply_patch'))
    p.finish('finished')

    const preamble = err.indexOf('Patching the parser now.')
    const call = err.findIndex((l) => l.startsWith('exec apply_patch'))

    expect(preamble, 'the preamble was dropped instead of reported').toBeGreaterThanOrEqual(0)
    expect(call, 'the tool call was not reported').toBeGreaterThanOrEqual(0)
    expect(preamble, 'the preamble was printed after the call it announces').toBeLessThan(call)
  })

  it('test_several_preambles_do_not_accumulate_into_the_answer', () => {
    // The real shape of a multi-step task: three preambles, three calls, one recap. The defect grew
    // with the task — a ten-step run put ten messages on stdout as one paragraph.
    const { io, out } = capture()
    const p = createHumanProcessor(io, 'sess-1')

    for (const step of ['First I look.', 'Now I patch.', 'Now I test.']) {
      p.process(text(step))
      p.process(toolCall('run_shell'))
    }
    p.process(text('All ten tests pass.'))
    p.finish('finished')

    expect(out).toEqual(['All ten tests pass.'])
  })

  it('test_deltas_of_ONE_message_are_still_joined', () => {
    // Anti-vacuity in the other direction: the boundary is the tool call, not every delta. A
    // processor that emitted each chunk separately would pass the tests above and shred the answer.
    const { io, out } = capture()
    const p = createHumanProcessor(io, 'sess-1')

    p.process(text('All ten '))
    p.process(text('tests pass.'))
    p.finish('finished')

    expect(out).toEqual(['All ten tests pass.'])
  })

  it('test_a_turn_with_no_tool_call_still_answers', () => {
    // One message, and it is the answer. Falls out of the same rule rather than needing a branch —
    // but a `cut()` misplaced in `finish` would swallow it, which is worth one test.
    const { io, out } = capture()
    const p = createHumanProcessor(io, 'sess-1')

    p.process(text('PONG'))

    expect(p.finish('finished').finalText).toBe('PONG')
    expect(out).toEqual(['PONG'])
  })

  it('test_a_trailing_preamble_with_no_recap_leaves_no_answer', () => {
    // The turn the instructions call INCOMPLETE: last emitted item was a tool call. Reporting the
    // preamble as the answer would dress a broken turn as a finished one — and
    // `silentEmptyTurnDiagnostic` exists precisely to notice the empty result.
    const { io, out } = capture()
    const p = createHumanProcessor(io, 'sess-1')

    p.process(text('Running the suite now.'))
    p.process(toolCall('run_shell'))

    expect(p.finish('finished').finalText).toBe('')
    expect(out, 'a preamble was passed off as the final answer').toEqual([])
  })
})

describe('the JSONL processor derives the same final message', () => {
  it('test_output_last_message_matches_the_human_processor', () => {
    // `-o` reads `finalText` from whichever processor ran, so the two must agree. They did not:
    // only the human one was ever looked at when this was found.
    const { io } = capture()
    const p = createJsonlProcessor(io, 'sess-1')

    p.process(text('Looking at the file.'))
    p.process(toolCall('read_file'))
    p.process(text('It defines parseDuration.'))

    expect(p.finish('finished').finalText).toBe('It defines parseDuration.')
  })
})
