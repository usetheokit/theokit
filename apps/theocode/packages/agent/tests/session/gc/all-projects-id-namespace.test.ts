/**
 * The all-projects sweep must speak ONE id namespace, the way `per-session.ts` already does.
 *
 * A session id and the name of its transcript are different strings: `@theokit/agents` derives the
 * filename by hashing the id (`sessionUuidFor`), so `exec-522dc0ef-…` is stored as
 * `7dc7d4ef-419d-8142-….jsonl`. `per-session.ts` was fixed for this twice (#102, B-143) and pins it
 * with `id-namespace.test.ts`. The all-projects sweep never got the fix, and four of its guards
 * compare one namespace against the other — so they match nothing, forever, in silence.
 *
 * WHY THIS FILE EXISTS SEPARATELY. Every other test here drives `planSessionGCAllProjects` and stops.
 * The seven files importing `all-sessions.js` import only the PLAN phase; the APPLY phase is reached
 * by three tests, all through a candidate that is NOT in the registry, which takes the `unlink` arm.
 * The `deleteAgent` arm is entered by nothing, and two data-losing defects live inside it. Coverage
 * read 78.78% with 21 sibling test files, which is why nothing surfaced them.
 *
 * These cases therefore drive BOTH phases with the real SDK mapping, and each one fails on the
 * pre-fix tree in a way that costs a user something: a live transcript unlinked, or a sweep that
 * reports a removal it did not perform.
 */
import { basename } from 'node:path'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'
import { describe, expect, it } from 'vitest'

import { runSessionGCAllProjects } from '../../../src/session/gc/all-sessions-apply.js'
import { planSessionGCAllProjects, type AllPlan } from '../../../src/session/gc/all-sessions.js'

const CWD = '/home/operator/a-project'
const PROJECT = 'a-project'
const LIVE_ID = 'exec-522dc0ef-9247-4a5b-bdce-e421c29d11b8'
const OLD_ID = 'exec-11111111-2222-3333-4444-555555555555'

/** The SDK's forward mapping — the only direction that exists over a hash. */
const nameOf = (id: string): string =>
  basename(transcriptPath(transcriptRoot(), CWD, id)).replace(/\.jsonl$/, '')

const fileOf = (id: string): string => `${nameOf(id)}.jsonl`

const DAY = 86_400_000
const NOW = 1_800_000_000_000

interface Seams {
  registry?: { agentId: string; lastModified?: number; archived?: boolean }[]
  onDisk?: { name: string; mtimeMs?: number }[]
  pointer?: string
}

async function plan(seams: Seams): Promise<AllPlan> {
  return planSessionGCAllProjects({
    projectsRoot: '/projects',
    now: () => NOW,
    keepLast: 0,
    maxAgeDays: 30,
    listProjects: () => [PROJECT],
    listProject: () =>
      (seams.onDisk ?? []).map((e) => ({
        name: e.name,
        isDirectory: false,
        mtimeMs: e.mtimeMs ?? NOW - 90 * DAY,
      })),
    classify: () => ({ state: 'ALIVE' as const, cwd: CWD }),
    listRegistry: async () => (seams.registry ?? []) as never,
    hasLiveWriter: () => false,
    readPointer: () => seams.pointer,
  })
}

function applySpy(pointer?: string): {
  opts: Parameters<typeof runSessionGCAllProjects>[1]
  calls: string[]
} {
  const calls: string[] = []
  return {
    calls,
    opts: {
      apply: true,
      unlink: async (p) => void calls.push(`unlink ${p}`),
      rmdir: async (p) => void calls.push(`rmdir ${p}`),
      deleteAgent: async (id) => void calls.push(`deleteAgent ${id}`),
      readPointer: () => pointer,
      hasLiveWriter: () => false,
    },
  }
}

describe('the all-projects sweep speaks one id namespace', () => {
  it('test_the_apply_backstop_refuses_a_transcript_whose_session_became_the_live_pointer', async () => {
    // #49 — the TOCTOU backstop compares `c.id` (a filename stem) against the pointer (a session
    // id). Before the fix the refusal list is empty and the LIVE session's transcript is unlinked.
    // The pointer is set at APPLY time only — that is the TOCTOU shape: at plan time this session
    // was not live, so nothing protected it. A newer decoy is needed because the most recent
    // transcript is always protected.
    const p = await plan({
      onDisk: [
        { name: fileOf(OLD_ID), mtimeMs: NOW },
        { name: fileOf(LIVE_ID), mtimeMs: NOW - 90 * DAY },
      ],
    })
    expect(p.candidates, 'the fixture must produce a candidate, or this case proves nothing').toHaveLength(1)

    const { opts, calls } = applySpy(LIVE_ID)
    const result = await runSessionGCAllProjects(p, opts)

    expect(calls, 'the live session transcript was removed').toEqual([])
    expect(result.errors.join(' ')).toMatch(/refused/)
  })

  it('test_a_registered_transcript_is_deleted_by_its_session_id_not_its_filename', async () => {
    // #51 — `deleteAgent` requires a session id. Passing the filename makes it a no-op that never
    // touches the .jsonl, while `removed` reports the file gone. Every run, forever.
    // ARCHIVED, because that is the reachable shape: `resolveGuards` protects every UNarchived
    // registry entry, so a live registered transcript is never a candidate. An archived session's
    // transcript is collectable AND in the registry — the only way into the `deleteAgent` arm, and
    // the reason nothing had entered it.
    // A second, NEWER transcript is required: `resolveGuards` always protects the most recent one
    // (`datable[0]`), so a lone file on disk can never be collected whatever else is true of it.
    const p = await plan({
      registry: [{ agentId: OLD_ID, lastModified: NOW - 90 * DAY, archived: true }],
      onDisk: [
        { name: fileOf(LIVE_ID), mtimeMs: NOW },
        { name: fileOf(OLD_ID), mtimeMs: NOW - 90 * DAY },
      ],
    })
    expect(p.candidates, 'the archived transcript must be the one candidate').toHaveLength(1)
    expect(p.candidates[0]?.id).toBe(nameOf(OLD_ID))
    expect(p.candidates[0]?.inRegistry, 'a registered transcript must be recognised as registered').toBe(true)

    const { opts, calls } = applySpy()
    await runSessionGCAllProjects(p, opts)

    expect(calls).toEqual([`deleteAgent ${OLD_ID}`])
  })

  it('test_a_registry_entry_whose_transcript_is_on_disk_is_not_collected_separately', async () => {
    // #52 — `idsOnDisk.has(entry.agentId)` compares a session id against filename stems, so the
    // sweep protects the transcript and deletes the registry entry that names it.
    const p = await plan({
      registry: [{ agentId: LIVE_ID, lastModified: NOW - 90 * DAY }],
      onDisk: [{ name: fileOf(LIVE_ID), mtimeMs: NOW }],
    })

    expect(
      p.candidates.filter((c) => c.kind === 'registry'),
      'the registry entry was collected while its transcript was kept',
    ).toEqual([])
  })

  it('test_an_undated_registry_entry_is_never_collected', async () => {
    // #55 — `entry.lastModified ?? 0` dates an undated entry to 1970, so ageDays reads ~19000 and it
    // is collected on sight. B-020 removed exactly this coercion for `mtimeMs` 300 lines earlier;
    // absence of a date is not evidence of age.
    const p = await plan({ registry: [{ agentId: OLD_ID }] })

    expect(
      p.candidates.filter((c) => c.kind === 'registry'),
      'an entry with no date was aged to 1970 and collected',
    ).toEqual([])
  })
})
