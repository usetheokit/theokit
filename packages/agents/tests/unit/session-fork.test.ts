/**
 * T1.1 — the regression suite `forkBeforeUserTurn` never had.
 *
 * The function shipped a correct signature over an implementation that could not succeed:
 * `recordIndexOfUserTurn` filtered on `record.role`, and a transcript record carries `type` at the
 * top level with `role` nested under `message`. The predicate was therefore never true, the counter
 * never advanced, and every call ended in "fewer than N user turns".
 *
 * Zero tests and zero production callers is how it survived — so these tests come first, and the
 * fixtures are shaped to fail the old implementation for the RIGHT reason.
 *
 * The load-bearing fixture detail: a turn spans MANY records (the user message, the assistant reply,
 * every tool call and result). Record index ≠ turn index. A two-line fixture where the two coincide
 * would pass against a naive implementation and prove nothing — the trap the module's own docstring
 * describes at `session-lifecycle.ts:257-260`.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { forkBeforeUserTurn } from '../../src/session/session-lifecycle.js'
import { transcriptPath } from '../../src/persistence-entry.js'

let root: string
let cwd: string

/** One JSONL line in the shape the SDK's transcript writer actually emits. */
function record(type: 'user' | 'assistant', text: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type,
    message: { role: type, content: [{ type: 'text', text }] },
    uuid: `${type}-${text}`,
    parentUuid: null,
    sessionId: 'src',
    timestamp: '2026-08-14T00:00:00.000Z',
    ...extra,
  })
}

/**
 * Three user turns separated by tool traffic, so the Nth user turn does NOT sit at index N-1.
 *
 *   0 system-ish assistant preamble
 *   1 user      #1   <- 1st user turn
 *   2 assistant
 *   3 assistant (tool call)
 *   4 assistant (tool result)
 *   5 user      #2   <- 2nd user turn
 *   6 assistant
 *   7 user      #3   <- 3rd user turn
 */
function writeTranscript(sessionId: string): void {
  const lines = [
    record('assistant', 'preamble'),
    record('user', 'first'),
    record('assistant', 'reply-1'),
    record('assistant', 'tool-call', { subtype: 'tool_use' }),
    record('assistant', 'tool-result', { subtype: 'tool_result' }),
    record('user', 'second'),
    record('assistant', 'reply-2'),
    record('user', 'third'),
  ]
  const path = transcriptPath(root, cwd, sessionId)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theokit-fork-'))
  cwd = mkdtempSync(join(tmpdir(), 'theokit-proj-'))
  writeTranscript('src')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

describe('forkBeforeUserTurn', () => {
  it('finds_the_first_user_turn_past_a_leading_assistant_record', () => {
    const { recordIndex } = forkBeforeUserTurn('src', 'fork-1', 1, { cwd, root })
    // Index 1, not 0 — the transcript opens with an assistant preamble.
    expect(recordIndex).toBe(1)
  })

  it('finds_second_user_turn_past_tool_records', () => {
    const { recordIndex } = forkBeforeUserTurn('src', 'fork-2', 2, { cwd, root })
    // Index 5, not 1 — three assistant/tool records separate the two user turns. A naive
    // implementation counting records instead of turns would answer 1 here.
    expect(recordIndex).toBe(5)
  })

  it('accepts_nth_equal_to_the_last_user_turn', () => {
    // EC-8 — the boundary itself, not just "one past it". Off-by-one at the top of a range is the
    // classic failure of 1-based counting, and the original suite tested only the overflow.
    const { recordIndex } = forkBeforeUserTurn('src', 'fork-3', 3, { cwd, root })
    expect(recordIndex).toBe(7)
  })

  it('writes_the_fork_to_the_destination_transcript', () => {
    const { transcript } = forkBeforeUserTurn('src', 'fork-dst', 2, { cwd, root })
    expect(transcript).toBe(transcriptPath(root, cwd, 'fork-dst'))
  })

  it('throws_when_nth_exceeds_available_turns', () => {
    expect(() => forkBeforeUserTurn('src', 'fork-x', 4, { cwd, root })).toThrow(
      /has 3 reachable user turn\(s\)/,
    )
  })

  it('rejects_zero_and_negative_nth', () => {
    // The 1-based guard: a 0-based index on a destructive-feeling operation is a silent off-by-one.
    expect(() => forkBeforeUserTurn('src', 'fork-y', 0, { cwd, root })).toThrow(
      /counts user turns from 1/,
    )
    expect(() => forkBeforeUserTurn('src', 'fork-z', -1, { cwd, root })).toThrow(
      /counts user turns from 1/,
    )
  })

  it('rejects_src_equal_to_new_id', () => {
    // EC-1 (MUST FIX) — both ids resolve to the SAME path, so a self-fork truncates the source in
    // place. Unreachable while the function always threw; fixing the count is what opens it.
    expect(() => forkBeforeUserTurn('src', 'src', 1, { cwd, root })).toThrow(
      /srcId and newId must differ/,
    )
  })
})

/**
 * T2.3 — a transcript with the two things a REAL one has and the original fixture did not:
 * tool results carrying `type: 'user'`, and a `compact_boundary`.
 *
 *   0 user      "old-1"                  <- pre-boundary: the model can no longer see it
 *   1 assistant
 *   2 user      "old-2"                  <- pre-boundary
 *   3 system    compact_boundary         <- everything above has left the window
 *   4 user      "kept-1"                 <- 1st REACHABLE turn
 *   5 user      (tool_result, no text)   <- type 'user', but nobody typed it
 *   6 assistant
 *   7 user      "[[theokit:goal-continuation]] ..."  <- synthetic, not a turn the user took
 *   8 user      "kept-2"                 <- 2nd REACHABLE turn
 *
 * Counting every `type: 'user'` from index 0 — what the framework did — makes nth=1 land on index 0,
 * a turn the user cannot reach and the model can no longer see. The fork SUCCEEDS at the wrong
 * place, which is the worst failure shape: nothing errors.
 */
function writeRealisticTranscript(sessionId: string): void {
  const lines = [
    record('user', 'old-1'),
    record('assistant', 'old-reply'),
    record('user', 'old-2'),
    JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
      uuid: 'boundary',
      sessionId,
      timestamp: '2026-08-14T00:00:00.000Z',
    }),
    record('user', 'kept-1'),
    JSON.stringify({
      type: 'user',
      subtype: 'tool_result',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] },
      uuid: 'tool-result-1',
      sessionId,
      timestamp: '2026-08-14T00:00:00.000Z',
    }),
    record('assistant', 'reply-after-tool'),
    record('user', '[[theokit:goal-continuation]] keep going'),
    record('user', 'kept-2'),
  ]
  const path = transcriptPath(root, cwd, sessionId)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
}

describe('forkBeforeUserTurn — on a transcript that looks like a real one', () => {
  beforeEach(() => {
    writeRealisticTranscript('real')
  })

  it('test_fork_starts_after_the_last_compact_boundary', () => {
    const { recordIndex } = forkBeforeUserTurn('real', 'f1', 1, { cwd, root })
    // 4, not 0. Index 0 is a turn that has left the model's window; forking there silently rewinds
    // the user past what they can see.
    expect(recordIndex).toBe(4)
  })

  it('test_fork_skips_tool_result_records_when_counting_turns', () => {
    const { recordIndex } = forkBeforeUserTurn('real', 'f2', 2, { cwd, root })
    // 8, not 5. Index 5 carries `type: 'user'` because that is how the protocol frames a tool
    // result — but nobody typed it, and "the 2nd thing I said" does not mean it.
    expect(recordIndex).toBe(8)
  })

  it('test_fork_skips_goal_continuation_markers', () => {
    // Index 7 is synthetic: the goal runner wrote it, not the user. If it counted, nth=2 would land
    // there and the user would be rewound to a message they never sent.
    const { recordIndex } = forkBeforeUserTurn('real', 'f3', 2, { cwd, root })
    expect(recordIndex).not.toBe(7)
  })

  it('test_fork_returns_the_selected_turn_text', () => {
    // The whole point of a backtrack is re-seeding the composer with what was typed. Returning only
    // an index makes every surface re-read the transcript to find out what it just selected.
    const result = forkBeforeUserTurn('real', 'f4', 1, { cwd, root })
    expect(result.selectedText).toBe('kept-1')
  })

  it('test_nth_below_one_raises_a_distinct_typed_error', () => {
    // EC-5. Record indices in this module are 0-based, so 0 is the likely mistake. Falling through
    // to "0 exceeds the 2 reachable turns" sends the caller to read the transcript instead of their
    // own call.
    // The message already distinguished the two cases before T2.3 — it says "counts user turns
    // from 1" rather than falling through to the exceeded-error, which is what EC-5 asked for.
    expect(() => forkBeforeUserTurn('real', 'f5', 0, { cwd, root })).toThrow(
      /counts user turns from 1/i,
    )
  })

  it('test_nth_beyond_reachable_turns_names_the_reachable_count', () => {
    expect(() => forkBeforeUserTurn('real', 'f6', 3, { cwd, root })).toThrow(/\b2\b/)
  })
})
