/**
 * B-020 — the collector resolves every unknown toward "delete".
 *
 * This is the only code in the product that removes user data, and five independent swallowed
 * errors on that path all failed in the same direction:
 *
 *   1. `dfsExists` continued past any unreadable directory and returned NOT_FOUND -> DEAD.
 *   2. `isDirectory` mapped every `statSync` failure to `false` -> DEAD.
 *   3. `listRealProject` mapped every `statSync` failure to `mtimeMs = 0` — infinitely old, and it
 *      sorts LAST, so `keepLast` (which slices the newest) could not protect it either.
 *   4. `resolveGuards` returned an EMPTY protection set for DEAD, so `--keep-last` had no effect on
 *      exactly the projects the collector deletes from.
 *   5. `defaultListing` dropped `nextCursor`, so the registry guard was silently page one.
 *
 * Any one of these is arguable. Together they are a DIRECTION, and the direction is deletion.
 *
 * `classifyDirectory` already had the right vocabulary — UNDETERMINED, meaning "I cannot tell" — and
 * used it on exactly one branch. `planOneProject` already keeps a project it cannot classify. The
 * machinery to be safe existed; the failure sites simply did not reach for it.
 */
import { describe, expect, it } from 'vitest'

import { CursorNotDrainedError, listAgents } from '../../../src/session/agent-list.js'
import { planVirtual, projectOf, targets } from './plan-harness.js'

const CWD = '/proj'

describe('B-020 — retention and age apply to the projects the collector deletes from', () => {
  it('test_a_transcript_with_an_unknown_mtime_is_not_collectable', async () => {
    // mtime 0 made a real transcript ~20 000 days old, clearing every window, AND sorted it last so
    // the keepLast slice could not reach it. An entry whose age cannot be computed has no age to
    // compare against the window.
    const plan = await planVirtual({ projects: { [CWD]: [{ name: 'sess-unknown.jsonl' }] } })

    expect(
      targets(plan),
      'a transcript whose mtime could not be read was planned for deletion as infinitely old',
    ).toEqual([])
  })

  it('test_keepLast_protects_the_newest_transcripts_of_a_DEAD_project', async () => {
    // The main deletion path: the quota must apply to the projects the collector deletes from.
    const plan = await planVirtual({
      keepLast: 2,
      projects: {
        [CWD]: [
          { name: 'sess-c.jsonl', ageDays: 40 },
          { name: 'sess-b.jsonl', ageDays: 50 },
          { name: 'sess-a.jsonl', ageDays: 60 },
        ],
      },
    })

    expect(
      targets(plan).map((t) => t.split('/').pop()),
      'keepLast had no effect on a DEAD project — the only kind the collector deletes from',
    ).toEqual(['sess-a.jsonl'])
  })

  it('test_a_DEAD_project_still_collects_beyond_the_keepLast_slice', async () => {
    // Anti-vacuity floor: protecting EVERYTHING would satisfy the assertion above. `keepLast` has a
    // floor of 1, so a second transcript sits outside the slice.
    const plan = await planVirtual({
      projects: {
        [CWD]: [
          { name: 'sess-new.jsonl', ageDays: 40 },
          { name: 'sess-old.jsonl', ageDays: 60 },
        ],
      },
    })

    expect(plan.candidates.length).toBeGreaterThan(0)
  })

  it('test_a_project_that_cannot_be_classified_is_kept', async () => {
    // The behaviour the fixes above route into.
    const plan = await planVirtual({
      liveness: () => 'undetermined',
      projects: { [CWD]: [{ name: 'sess-old.jsonl', ageDays: 60 }] },
    })

    expect(plan.candidates).toEqual([])
    expect(plan.kept.map((k) => k.project)).toContain(projectOf(CWD))
  })
})

describe('B-020 — a run that could not look does not report an empty result', () => {
  it('test_a_failed_projects_listing_is_reported_as_an_error', async () => {
    // A throwing listing returned an EMPTY plan with an EMPTY error list, and the renderer prints
    // "nothing to collect" for exactly that shape. "I found nothing" and "I could not look" are
    // different facts.
    const plan = await planVirtual({
      projects: { [CWD]: [{ name: 'sess-old.jsonl', ageDays: 60 }] },
      readdirRoot: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      },
    })

    expect(plan.candidates).toEqual([])
    expect(
      plan.errors,
      'a collector that could not list any project reported a clean, empty run',
    ).toHaveLength(1)
    expect(plan.errors[0]?.message).toMatch(/EACCES/)
  })
})

describe('B-020 — the cursor guard refuses a truncated protection set', () => {
  it('test_a_listing_that_returns_a_cursor_is_refused_not_truncated', async () => {
    // The default listing cannot reach this: `@theokit/agents` narrows `Agent.list` to a
    // non-paginated overload returning `Omit<ListResult, 'nextCursor'>`, so there is no cursor to
    // return. The guard is a tripwire for the SDK upgrade that lifts the narrowing — at which point
    // a truncated page would silently shrink a set that protects transcripts from deletion.
    const paginating = async () => ({ items: [], nextCursor: 'page-2' })

    await expect(listAgents('/proj', paginating)).rejects.toThrow(CursorNotDrainedError)
  })

  it('test_a_drained_listing_returns_its_items', async () => {
    // Anti-vacuity floor: refusing every listing would satisfy the assertion above.
    const drained = async () => ({ items: [{ agentId: 'a1' }] })

    await expect(listAgents('/proj', drained)).resolves.toEqual([{ agentId: 'a1' }])
  })
})
