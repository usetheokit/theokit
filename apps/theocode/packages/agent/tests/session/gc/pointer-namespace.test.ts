/**
 * The live-session pointer holds a SESSION ID; the protected set is keyed by FILENAME.
 *
 * A transcript's name is derived from its session id and is not equal to it — measured on the built
 * binary:
 *
 *     filename   7dc7d4ef-419d-8142-b6e0-c255dbe042bc.jsonl
 *     sessionId  exec-522dc0ef-9247-4a5b-bdce-e421c29d11b8
 *
 * `protectedIds` is filled from both — filename stems for the quota and most-recent guards, the raw
 * pointer id for the live session — and consulted with a filename stem. So the pointer's entry can
 * never match, and the guard that exists to stop a running TUI losing its own conversation matches
 * nothing at all.
 *
 * It has never been seen because the quota and most-recent guards cover the live session whenever it
 * is also the newest, which is the common case. It fails when it is not: a second session in the same
 * project, or a long-running one left open while another is used. Deletion calls `unlink` and there
 * is no restore, so the direction of that failure is the expensive one.
 *
 * The expected filename here is computed with the SAME mapping production uses rather than written
 * out, because writing it out would make the test agree with a string instead of with the system.
 */
import { describe, expect, it } from 'vitest'

import { fileOf, planVirtual, targets } from './plan-harness.js'

const CWD = '/proj'
const LIVE_SESSION = 'exec-522dc0ef-9247-4a5b-bdce-e421c29d11b8'
/** What the transcript of `LIVE_SESSION` is actually called on disk. */
const LIVE_FILE = fileOf(CWD, LIVE_SESSION)
/**
 * A second, NEWER transcript, and it is what makes the arm meaningful.
 *
 * With one transcript the live session is also the most recent, so the quota protects it and the
 * pointer is never the thing being tested. A fixture that could not be collected would make the
 * guard assertion pass for free.
 */
const NEWER_FILE = fileOf(CWD, 'exec-8918b35d-2341-4545-84a7-c62dc9bee641')

const plan = (pointer?: () => string | undefined) =>
  planVirtual({
    // ALIVE, because the pointer is only consulted for a live project.
    liveness: () => 'alive',
    projects: {
      [CWD]: [
        { name: NEWER_FILE, ageDays: 40 },
        { name: LIVE_FILE, ageDays: 60 },
      ],
    },
    ...(pointer === undefined ? {} : { pointer }),
  })

describe('the pointer guard and the protected set must speak one language', () => {
  it('test_the_fixture_is_collectable_without_a_pointer', async () => {
    // Anti-vacuity floor: without this, a plan that collected nothing would pass the guard test below
    // for free — the failure mode this whole file is about, one level up.
    expect(
      targets(await plan()).some((t) => t.endsWith(LIVE_FILE)),
      'the fixture stopped producing a collectable transcript, so the guard test proves nothing',
    ).toBe(true)
  })

  it('test_the_pointer_protects_the_transcript_of_the_session_it_names', async () => {
    expect(
      targets(await plan(() => LIVE_SESSION)).some((t) => t.endsWith(LIVE_FILE)),
      'the live session named by the pointer was planned for deletion — the guard matched nothing',
    ).toBe(false)
  })
})
