import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * B-021 / ADR 0002 — an abnormal ending is never reported as a normal one.
 *
 * The ADR's first rule: *"The reason travels with the terminal event, not beside it. A consumer
 * reading only the terminal frame must be able to tell the two apart. A log line, a span attribute
 * or a separate channel does not satisfy this — the client deciding whether to retry does not read
 * spans."*
 *
 * Four defects in four subsystems were the same defect, and **none was found by the test suite**.
 * The ADR says why: *"In every case the code did what its author intended and the tests asserted
 * that intention. A test that asks 'did the run finish?' gets `yes` from a truncated run, because
 * the code is the thing deciding what finished means."*
 *
 * So this does not ask whether a run finished. It asks a structural question the code cannot answer
 * in its own favour: **does every terminal event type carry a field that could express an abnormal
 * ending at all?** A frame with no such field makes the distinction unrepresentable, and no runtime
 * test can recover it.
 *
 * ## Why this shape and not a runtime assertion
 *
 * A runtime test needs a producer that truncates, and the producers are the thing under suspicion —
 * the SDK reported a failed handler as `status: "completed"` with a hardcoded literal, so the
 * `status === 'error'` branch the translator was written against was dead code that could never run.
 * A fixture built from the same assumption as the code agrees with it. The type declaration does
 * not: it is the contract every producer and every consumer share, and a missing field there is
 * missing for all of them.
 *
 * ## What this does NOT check
 *
 * Whether a producer actually SETS the field when it should. That needs the producer, and
 * `packages/agents/tests/integration/stop-reason.test.ts` and `tests/integration/stream-interrupted.test.ts`
 * cover it. This is the half that stays true no matter which producer is looking.
 */

const here = dirname(fileURLToPath(import.meta.url))
const events = join(here, '..', '..', 'src', 'bridge', 'agent-stream-events.ts')

/** A frame that ENDS a unit of work. Anything else may legitimately carry no reason. */
const TERMINAL_DISCRIMINANTS = ['done', 'finish', 'complete', 'error', 'aborted'] as const

/** A field a consumer could read to tell an abnormal ending from a normal one. */
const REASON_FIELDS = ['stopReason', 'reason', 'error', 'code'] as const

interface Declared {
  readonly name: string
  readonly body: string
}

function declaredEvents(): Declared[] {
  const src = readFileSync(events, 'utf8')
  return [...src.matchAll(/export interface (\w+Event) \{(.*?)\n\}/gs)].map((m) => ({
    name: m[1] ?? '',
    body: m[2] ?? '',
  }))
}

const isTerminal = (body: string): boolean =>
  TERMINAL_DISCRIMINANTS.some((d) => new RegExp(`type: '${d}'`).test(body))

const reasonFields = (body: string): string[] =>
  REASON_FIELDS.filter((f) => new RegExp(`\\b${f}\\??:`).test(body))

describe('every terminal event can say why it ended (B-021, ADR 0002)', () => {
  const all = declaredEvents()

  it('test_the_declarations_were_found', () => {
    // Guards the check itself. A regex that stops matching would make the assertion below pass over
    // an empty list — a green run that measured nothing, which is the exact shape ADR 0002 records
    // as how four defects survived a whole suite.
    expect(
      all.length,
      'no event interfaces were parsed from agent-stream-events.ts',
    ).toBeGreaterThan(8)
  })

  const terminal = all.filter((e) => isTerminal(e.body))

  it('test_at_least_two_terminal_events_are_recognised', () => {
    // `DoneEvent` and `ErrorEvent` at the time of writing. Fewer means the discriminant list drifted
    // away from the union, and the check below would be silently narrower than it reads.
    expect(
      terminal.map((e) => e.name),
      'the terminal-event discriminants no longer match the union',
    ).toEqual(expect.arrayContaining(['DoneEvent', 'ErrorEvent']))
  })

  for (const event of terminal) {
    it(`test_${event.name}_carries_a_field_that_can_express_an_abnormal_ending`, () => {
      const found = reasonFields(event.body)
      expect(
        found,
        `${event.name} is a terminal frame and declares none of ${REASON_FIELDS.join(', ')}. ` +
          `A consumer reading only this frame cannot tell a completed unit of work from a cut one, ` +
          `and ADR 0002 rule 1 says the reason travels WITH the terminal event — not in a log line, ` +
          `a span attribute, or a separate channel.`,
      ).not.toHaveLength(0)
    })
  }

  it('test_the_reason_is_optional_so_absence_still_means_success', () => {
    // ADR 0002 rule 2: "Absence means success, so success must be the expensive claim." A REQUIRED
    // `stopReason` would force every clean finish to invent a value, and the field meant to mark the
    // abnormal case would stop marking anything.
    const done = all.find((e) => e.name === 'DoneEvent')
    expect(done, 'DoneEvent is gone — this test is about it').toBeDefined()
    expect(
      /\bstopReason\?:/.test(done?.body ?? ''),
      'stopReason became required on DoneEvent; absence can no longer mean a clean finish',
    ).toBe(true)
  })
})
