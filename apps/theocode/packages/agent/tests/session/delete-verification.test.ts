/**
 * #125 — `sessions delete` reported success about the half nobody checked.
 *
 * Measured: the session's transcript was removed and its registry entry stayed, and the command
 * printed `deleted <id> — transcript removed from disk` and exited 0. What was left behind is a
 * registered session whose transcript no longer exists.
 *
 * ## Why the SDK's own `registryRemoved` is not the answer
 *
 * `@theokit/agents/session`'s `deleteSession` returns `{ registryRemoved, transcriptRemoved }`, and
 * this product was destructuring only the second. Carrying the first through looks like the fix and
 * is not: measured 2026-09-07, `registryRemoved` is `true` even when the injected removal returns
 * `undefined` and removes nothing. It reports that the call did not REJECT — which, with
 * `Agent.delete(id): Promise<void>` that never throws on a miss (theokit-sdk#612), is
 * indistinguishable from success.
 *
 * ## So the entry is re-read
 *
 * The listing is consulted before and after, and the outcome is one of three — never a boolean,
 * because a boolean would have to lie about the third:
 *
 *   `removed`      — listed before, absent after. The only case that may say "deleted".
 *   `still-present` — listed after. The defect, and it must reach the exit code.
 *   `unverified`   — not listed before either (archived sessions are excluded from the listing),
 *                    so this method cannot tell. Absence of evidence, reported as such.
 *
 * Re-reading rather than trusting the return value is the discipline the implementation gate already
 * uses for the wiring triad: evidence derived independently, never self-reported.
 */
import { deleteSession } from '@theokit/agents/session'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { transcriptPath } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { registryEntryFrom } from '../../src/session/session-ops.js'

let base: string
let cwd: string
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'theocode-dv-'))
  cwd = mkdtempSync(join(tmpdir(), 'theocode-dvp-'))
})
afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

/** The framework measures listing before/after; this maps it to the product's vocabulary. */
async function outcome(before: string[], after: string[], id: string) {
  let calls = 0
  const file = transcriptPath(base, cwd, id)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '')
  const r = await deleteSession(id, {
    cwd,
    root: base,
    force: true,
    removeFromRegistry: async () => undefined,
    isListedInRegistry: async (x) => (calls++ === 0 ? before : after).includes(x),
  })
  return registryEntryFrom(r.registryOutcome)
}

describe('what happened to the registry entry', () => {
  it('test_listed_before_and_gone_after_is_the_only_removal', async () => {
    expect(await outcome(['exec-1', 'tui-2'], ['tui-2'], 'exec-1')).toBe('removed')
  })

  it('test_still_listed_after_is_the_defect_and_is_named', async () => {
    expect(await outcome(['exec-1'], ['exec-1'], 'exec-1')).toBe('still-present')
  })

  it('test_absent_before_cannot_be_verified_by_this_method', async () => {
    // An archived session is excluded from the listing, so "gone after" would be true for a session
    // that was never visible — a false removal.
    expect(await outcome([], [], 'exec-1')).toBe('unverified')
  })

  it('test_an_unrelated_session_disappearing_is_not_this_ones_removal', async () => {
    expect(await outcome(['exec-1', 'tui-2'], ['exec-1'], 'exec-1')).toBe('still-present')
  })
})
