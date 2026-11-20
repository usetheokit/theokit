/**
 * The all-projects sweep must speak ONE id namespace, the way `per-session.ts` already does.
 *
 * A session id and the name of its transcript are different strings: `@theokit/agents` derives the
 * filename by hashing the id (`sessionUuidFor`), so `exec-522dc0ef-…` is stored as
 * `7dc7d4ef-419d-8142-….jsonl`. `per-session.ts` was fixed for this twice (#102, B-143) and pins it
 * with `id-namespace.test.ts`. The all-projects sweep never got the fix, and four of its guards
 * compare one namespace against the other — so they match nothing, forever, in silence.
 *
 * WHY THIS FILE EXISTS SEPARATELY. Every other test here drives the planner and stops.
 * The other files import only the PLAN phase; the APPLY phase is reached
 * by three tests, all through a candidate that is NOT in the registry, which takes the `unlink` arm.
 * The registry-removal arm is entered by nothing, and two data-losing defects live inside it. Coverage
 * read 78.78% with 21 sibling test files, which is why nothing surfaced them.
 *
 * These cases therefore drive BOTH phases with the real SDK mapping, and each one fails on the
 * pre-fix tree in a way that costs a user something: a live transcript unlinked, or a sweep that
 * reports a removal it did not perform.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { transcriptPath } from '@theokit/agents/persistence'
import { afterAll, describe, expect, it } from 'vitest'

import {
  planAllProjectsOnDisk,
  runAllProjectsOnDisk,
  type AllPlan,
} from '../../../src/session/gc/projects-gc.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'

const LIVE_ID = 'exec-522dc0ef-9247-4a5b-bdce-e421c29d11b8'
const OLD_ID = 'exec-11111111-2222-3333-4444-555555555555'

const DAY = 86_400_000

const scratch: string[] = []
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

interface Seams {
  registry?: { id: string; lastModified?: number; archived?: boolean }[]
  /** Transcripts by session id, with their age in days. */
  onDisk?: { id: string; ageDays: number }[]
}

/** A real tree: an existing cwd (so the project is ALIVE) and transcripts named by the SDK's mapping. */
function tree(seams: Seams): {
  home: string
  root: string
  cwd: string
  file: (id: string) => string
} {
  const home = mkdtempSync(join(tmpdir(), 'theocode-idns-home-'))
  const cwd = mkdtempSync(join(tmpdir(), 'theocode-idns-cwd-'))
  scratch.push(home, cwd)
  const root = join(home, 'projects')
  claimRoot(root)
  const file = (id: string): string => transcriptPath(home, cwd, id)
  for (const e of seams.onDisk ?? []) {
    mkdirSync(dirname(file(e.id)), { recursive: true })
    writeFileSync(file(e.id), `${JSON.stringify({ cwd })}\n`)
    const at = new Date(Date.now() - e.ageDays * DAY)
    utimesSync(file(e.id), at, at)
  }
  return { home, root, cwd, file }
}

const plan = (root: string, seams: Seams): Promise<AllPlan> =>
  planAllProjectsOnDisk({
    projectsRoot: root,
    keepLast: 1,
    maxAgeDays: 30,
    listRegistry: async () => seams.registry ?? [],
  })

describe('the all-projects sweep speaks one id namespace', () => {
  it('test_the_apply_backstop_refuses_a_transcript_whose_session_became_the_live_pointer', async () => {
    // #49 — the TOCTOU backstop compares a transcript against the pointer (a session id). Before the
    // fix the refusal list is empty and the LIVE session's transcript is unlinked.
    // The pointer is set at APPLY time only — that is the TOCTOU shape: at plan time this session
    // was not live, so nothing protected it. A newer decoy is needed because the newest transcript
    // is always protected.
    const seams: Seams = {
      onDisk: [
        { id: OLD_ID, ageDays: 0 },
        { id: LIVE_ID, ageDays: 90 },
      ],
    }
    const t = tree(seams)
    const p = await plan(t.root, seams)
    expect(
      p.candidates,
      'the fixture must produce a candidate, or this case proves nothing',
    ).toHaveLength(1)

    mkdirSync(join(t.cwd, '.theokit'), { recursive: true })
    writeFileSync(join(t.cwd, '.theokit', 'tui-session'), `${LIVE_ID}\n`)
    const result = await runAllProjectsOnDisk(p, { apply: true })

    expect(existsSync(t.file(LIVE_ID)), 'the live session transcript was removed').toBe(true)
    expect(result.removed.filter((r) => r.endsWith('.jsonl'))).toEqual([])
    expect(result.refused.map((r) => r.reason).join(' ')).toMatch(/pointer/)
  })

  it('test_a_registered_transcript_is_deleted_by_its_session_id_not_its_filename', async () => {
    // #51 — registry removal requires a session id. Passing the filename makes it a no-op that never
    // touches the .jsonl, while `removed` reports the file gone. Every run, forever.
    // ARCHIVED, because that is the reachable shape: every UNarchived registry entry is protected, so
    // a live registered transcript is never a candidate. A second, NEWER transcript is required: the
    // newest is always protected, so a lone file can never be collected.
    const seams: Seams = {
      registry: [{ id: OLD_ID, lastModified: Date.now() - 90 * DAY, archived: true }],
      onDisk: [
        { id: LIVE_ID, ageDays: 0 },
        { id: OLD_ID, ageDays: 90 },
      ],
    }
    const t = tree(seams)
    const p = await plan(t.root, seams)
    expect(p.candidates, 'the archived transcript must be the one candidate').toHaveLength(1)
    expect(p.candidates[0]?.target).toBe(t.file(OLD_ID))
    expect(
      p.candidates[0]?.sessionId,
      'a registered transcript must be recognised as registered, by its session id',
    ).toBe(OLD_ID)

    const removedFromRegistry: string[] = []
    const result = await runAllProjectsOnDisk(p, {
      apply: true,
      removeFromRegistry: (id) => void removedFromRegistry.push(id),
    })

    expect(removedFromRegistry).toEqual([OLD_ID])
    expect(result.errors).toEqual([])
    expect(existsSync(t.file(OLD_ID))).toBe(false)
  })

  it('test_a_registry_entry_whose_transcript_is_on_disk_is_not_collected_separately', async () => {
    // #52 — a session id compared against filename stems protects the transcript and deletes the
    // registry entry that names it.
    const seams: Seams = {
      registry: [{ id: LIVE_ID, lastModified: Date.now() - 90 * DAY }],
      onDisk: [{ id: LIVE_ID, ageDays: 0 }],
    }
    const t = tree(seams)

    const p = await plan(t.root, seams)

    expect(
      p.candidates.filter((c) => c.kind === 'registry'),
      'the registry entry was collected while its transcript was kept',
    ).toEqual([])
  })

  it('test_an_undated_registry_entry_is_never_collected', async () => {
    // #55 — `entry.lastModified ?? 0` dates an undated entry to 1970, so it is collected on sight.
    // Absence of a date is not evidence of age. A recent transcript keeps the project ALIVE, the only
    // verdict under which registry entries are collected at all.
    const seams: Seams = { registry: [{ id: OLD_ID }], onDisk: [{ id: LIVE_ID, ageDays: 0 }] }
    const t = tree(seams)

    const p = await plan(t.root, seams)

    expect(
      p.candidates.filter((c) => c.kind === 'registry'),
      'an entry with no date was aged to 1970 and collected',
    ).toEqual([])
  })

  it('test_a_dated_registry_entry_with_no_transcript_is_collected', async () => {
    // Anti-vacuity for the case above: a planner that never collected registry entries would pass it.
    const seams: Seams = {
      registry: [{ id: OLD_ID, lastModified: Date.now() - 90 * DAY }],
      onDisk: [{ id: LIVE_ID, ageDays: 0 }],
    }
    const t = tree(seams)

    const p = await plan(t.root, seams)

    expect(p.candidates.filter((c) => c.kind === 'registry').map((c) => c.target)).toEqual([OLD_ID])
  })
})
