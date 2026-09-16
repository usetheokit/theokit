/**
 * B-012 — read the transcript with the SDK's reader, and let its typed error through.
 *
 * `parseTranscript` hand-rolled JSONL parsing that `@theokit/agents/persistence` exports as
 * `loadJsonl`, including the "tolerate a truncated LAST line" behaviour the SDK ships as an explicit
 * opt-in flag. It threw a bare `SyntaxError`; the SDK throws `JsonlParseError`, which carries the
 * 1-based line number the user needs to act.
 *
 * The tolerance itself was the right call and stays: the SDK argues in its own docblock that
 * swallowing a malformed line in the MIDDLE of the file "turns loud data loss into silent data loss
 * — the wrong trade for a session store". What changes is that the choice is now declared through a
 * documented flag instead of being re-derived by an index comparison.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { JsonlParseError, transcriptPath } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readUserTurnPreviewsAsync } from '../../src/session/backtrack.js'

let base: string
let cwd: string

// The layout is the SDK's to own, not this fixture's. It used to build
// `<base>/projects/<encoded-cwd>/<id>.jsonl` by hand, which stopped matching when the SDK moved
// transcript filenames to UUIDs — and the reader answers a wrong path with an EMPTY LIST rather
// than an error, so all three cases here failed as "no turns found" with nothing naming the cause.
function writeTranscript(id: string, lines: string[]): void {
  const file = transcriptPath(base, cwd, id)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, lines.join('\n'))
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'theocode-bt-'))
  cwd = mkdtempSync(join(tmpdir(), 'theocode-btproj-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

const userTurn = (text: string): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } })

describe('B-012 — transcript reading uses the SDK reader', () => {
  it('test_a_truncated_last_line_is_tolerated', async () => {
    // The crash artifact the SDK's flag exists for: the process died mid-write.
    writeTranscript('s1', [userTurn('first'), userTurn('second'), '{"type":"user","mess'])

    const previews = await readUserTurnPreviewsAsync('s1', { cwd, baseDir: base })

    // B-029 — the contract is "you lose the PARTIAL line and nothing else". `> 0` also passes when
    // a reader silently drops a valid turn, which is the failure this test exists to catch.
    expect(previews, 'a valid turn was dropped along with the truncated one').toHaveLength(2)
  })

  it('test_corruption_in_the_middle_raises_the_typed_error_with_a_line_number', async () => {
    writeTranscript('s2', [userTurn('first'), 'not json at all', userTurn('third')])

    await expect(
      readUserTurnPreviewsAsync('s2', { cwd, baseDir: base }),
      'a bare SyntaxError loses the line number, so the surface can only report "transcript ' +
        'unreadable" and the user has nothing to act on',
    ).rejects.toBeInstanceOf(JsonlParseError)
  })

  it('test_a_clean_transcript_reads_its_user_turns', async () => {
    // Anti-vacuity floor: throwing on everything would satisfy the assertion above.
    writeTranscript('s3', [userTurn('hello'), userTurn('world')])

    const previews = await readUserTurnPreviewsAsync('s3', { cwd, baseDir: base })

    expect(previews.length).toBe(2)
  })
})
