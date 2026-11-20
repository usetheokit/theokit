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
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deleteSession } from '../../src/session/session-ops.js'

let base: string
let cwd: string

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'theocode-dv-'))
  cwd = mkdtempSync(join(tmpdir(), 'theocode-dvproj-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

/** A registry the test controls: `remove` decides what the removal does to the listing. */
async function outcomeOf(
  listed: string[],
  remove: (listed: string[], id: string) => string[],
  id = 'exec-1',
): Promise<string> {
  let current = [...listed]
  const result = await deleteSession(id, {
    cwd,
    baseDir: base,
    removeFromRegistry: async (agentId) => {
      current = remove(current, agentId)
    },
    isListedInRegistry: async (agentId) => current.includes(agentId),
  })
  return result.registryEntry
}

describe('what happened to the registry entry', () => {
  it('test_listed_before_and_gone_after_is_the_only_removal', async () => {
    expect(await outcomeOf(['exec-1', 'tui-2'], (l, id) => l.filter((x) => x !== id))).toBe(
      'removed',
    )
  })

  it('test_still_listed_after_is_the_defect_and_is_named', async () => {
    expect(await outcomeOf(['exec-1'], (l) => l)).toBe('still-present')
  })

  it('test_absent_before_cannot_be_verified_by_this_method', async () => {
    // An archived session is excluded from the listing, so "gone after" would be true for a session
    // that was never visible — a false removal. Saying `unverified` is the honest answer, and it is
    // why this returns three states rather than a boolean.
    expect(await outcomeOf([], (l) => l)).toBe('unverified')
  })

  it('test_an_unrelated_session_disappearing_is_not_this_ones_removal', async () => {
    // Anti-vacuity floor: a classifier that only compared list LENGTHS would pass every arm above.
    expect(await outcomeOf(['exec-1', 'tui-2'], (l) => l.filter((x) => x !== 'tui-2'))).toBe(
      'still-present',
    )
  })
})
