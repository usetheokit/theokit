/**
 * B-080 — warn once when the context pressure RISES, never on every turn.
 *
 * A message that repeats each turn is how a warning gets ignored, and the failure this exists to
 * prevent arrives mid-turn where the work is least recoverable. So it fires on the TRANSITION
 * upward and stays quiet until the level changes again — including after a `/compact`, which drops
 * the level and re-arms it honestly.
 *
 * B-012 — the rise DETECTION now comes from `@theokit/tui`'s `useRisingEdge`. Three owners, one
 * fact each:
 *
 *   classify  -> `@theokit/agents/config` (`contextPressure`, and its thresholds)
 *   detect    -> `@theokit/tui` (`useRisingEdge`)
 *   speak     -> here (`contextWarning` names `/compact` and says what compaction costs)
 *
 * The middle one was eight hand-written lines with two silent failure modes the library's own
 * docstring enumerates. The last one stays because a framework that wrote it would be putting
 * words in this product's mouth.
 */
import { useRef } from 'react'

import { useRisingEdge } from '@theokit/tui'

import { contextPressure, contextWarning, type ContextPressure } from '../formatting/index.js'

/** Least severe first. `useRisingEdge` reads the ORDER as the severity, and no type can catch a reversal — the six tests in this file's suite are what pin it. */
const SEVERITY_ASCENDING: readonly ContextPressure[] = ['ok', 'warn', 'critical']

export function useContextWarning(
  usedTokens: number | undefined,
  windowTokens: number,
  warn: (message: string) => void,
): void {
  // An absent reading is NO INFORMATION, so the last computed level is HELD.
  //
  // The tempting adoption maps `undefined` to `'ok'` — but `'ok'` is a FALL, and a fall re-arms
  // the detector, so the next real reading warns a second time for a level the user was already
  // told about. `test_an_absent_reading_mid_stream_does_not_re_arm` was written before this
  // rewrite specifically to fail that version.
  const lastKnown = useRef<ContextPressure>('ok')
  const level =
    usedTokens === undefined ? lastKnown.current : contextPressure(usedTokens, windowTokens)
  lastKnown.current = level

  useRisingEdge(level, SEVERITY_ASCENDING, (risen) => {
    const message = contextWarning(risen)
    if (message !== undefined) warn(message)
  })
}
