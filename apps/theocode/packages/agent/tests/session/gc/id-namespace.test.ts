/**
 * A session id and a transcript filename are different strings, and this plan compared them.
 *
 * Measured on the built binary, one project created through the TUI:
 *
 *     registry agentId   tui-838055f5-73ea-4e10-af3b-f88482de2e2c
 *     transcript file    80a43d49-8b6b-8f93-9256-60f752a17f2d.jsonl
 *
 * `protectedIds` was filled from THREE sources — registry agent ids, filename stems for the quota,
 * and the pointer's session id — and consulted with a filename stem. Two of the three could never
 * match, so neither a registered session nor the live one was protected; only `keepLast` and
 * most-recent were, because those are filename-derived on both sides.
 *
 * The same mismatch made `inRegistry` always false, which is why every session in a manual run read
 * as `orphan` — a report that looked like an explanation and was an artefact.
 *
 * Expected filenames are computed with the SAME forward mapping production uses. The inverse cannot
 * exist over a hash (usetheokit/theokit-sdk#577) and is not needed: the id is in hand, so ask what it
 * is called.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptPath } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'

const DAY = 86_400_000
const NOW = 1_000 * DAY

const REGISTERED = 'tui-838055f5-73ea-4e10-af3b-f88482de2e2c'
const LIVE = 'exec-522dc0ef-9247-4a5b-bdce-e421c29d11b8'
const PLAIN = 'exec-8918b35d-2341-4545-84a7-c62dc9bee641'

// The framework planner has no `readdir`/`list`/`readPointer` seams: the three transcripts are real
// files under a temp root, the pointer is the real `.theokit/tui-session` file, and only the registry
// listing stays injected. The framework names a candidate by the session id it reads from the file.
let root = ''
let cwd = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theocode-gc-root-'))
  cwd = mkdtempSync(join(tmpdir(), 'theocode-gc-cwd-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

/** Three transcripts, all old enough to collect; the newest is the one nobody claims. */
function options(
  overrides: {
    pointer?: string
    list?: () => Promise<{ agentId: string; archived?: boolean }[]>
  } = {},
) {
  for (const [id, age] of [
    [PLAIN, 40],
    [REGISTERED, 50],
    [LIVE, 60],
  ] as const) {
    const path = transcriptPath(root, cwd, id)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ type: 'user', sessionId: id })}\n`)
    utimesSync(path, new Date(NOW - age * DAY), new Date(NOW - age * DAY))
  }
  if (overrides.pointer !== undefined) {
    mkdirSync(join(cwd, '.theokit'), { recursive: true })
    writeFileSync(join(cwd, '.theokit', 'tui-session'), `${overrides.pointer}\n`)
  }
  return {
    cwd,
    root,
    now: NOW,
    keepLast: 1,
    maxAgeDays: 30,
    apply: false,
    listRegistry: overrides.list ?? (async () => []),
  }
}

const planSessionGC = (o: ReturnType<typeof options>) =>
  planAndRunCurrentProjectGC(o).then((r) => r.plan)

describe('the protected set and the transcripts must be keyed the same way', () => {
  it('test_the_fixture_collects_everything_nobody_claims', async () => {
    // Anti-vacuity floor. Without it, a plan that collected nothing would pass both guards below for
    // free — and the first draft of this file did exactly that, because a single transcript is also
    // the most recent and was protected for a reason unrelated to what was under test.
    const plan = await planSessionGC(options())

    expect(plan.candidates.map((c) => c.id)).toContain(LIVE)
    expect(plan.candidates.map((c) => c.id)).toContain(REGISTERED)
  })

  it('test_the_pointer_protects_the_transcript_of_the_session_it_names', async () => {
    const plan = await planSessionGC(options({ pointer: LIVE }))

    expect(
      plan.candidates.map((c) => c.id),
      'the live session named by the pointer was planned for deletion',
    ).not.toContain(LIVE)
  })

  it('test_a_registered_session_is_protected_and_reported_as_registered', async () => {
    const listed = [{ agentId: REGISTERED, archived: false }]
    const plan = await planSessionGC(options({ list: async () => listed }))

    expect(
      plan.candidates.map((c) => c.id),
      'a session the registry still lists was planned for deletion',
    ).not.toContain(REGISTERED)
    // The framework plan has no `inRegistry` field; "reported as registered" is now that the
    // transcript appears under `kept` rather than among the candidates.
    expect(
      plan.kept.map((k) => k.id),
      'the registered session is not reported as kept',
    ).toContain(REGISTERED)
  })
})
