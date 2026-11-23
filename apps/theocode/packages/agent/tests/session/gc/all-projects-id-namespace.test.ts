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
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'
import { runProjectsGC, sessionPointerPath } from '@theokit/agents/session'
import { afterEach, describe, expect, it } from 'vitest'

import { claimRoot, OWNER, THEOCODE_MARKER } from '../../../src/session/gc/root-ownership.js'
import { planSessionGCAllProjects, type LegacyPlan } from './legacy-plan.js'

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
  /** A real transcript root, so the apply phase has files to remove. */
  base?: string
}

const bases: string[] = []
afterEach(() => {
  for (const b of bases.splice(0)) rmSync(b, { recursive: true, force: true })
})

async function plan(seams: Seams): Promise<LegacyPlan> {
  return planSessionGCAllProjects({
    projectsRoot: seams.base ?? '/transcripts',
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

/** A real tree under a scratch transcript root, so the apply phase removes real files. */
function realTree(
  names: string[],
  ageDays: number[] = [],
): { base: string; files: string[]; pointer: string } {
  const base = mkdtempSync(join(tmpdir(), 'theocode-gc-ns-'))
  bases.push(base)
  const files = names.map((n) => {
    const file = join(base, 'projects', basename(join(transcriptPath(base, CWD, 'x'), '..')), n)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, `${JSON.stringify({ cwd: CWD })}\n`)
    // The SDK's own "most recent session" guard reads these mtimes, so they match the plan's.
    const when = new Date(NOW - (ageDays[names.indexOf(n)] ?? 0) * DAY)
    utimesSync(file, when, when)
    return file
  })
  claimRoot(join(base, 'projects'))
  return { base, files, pointer: sessionPointerPath(CWD, base) }
}

function apply(framework: LegacyPlan['framework'], deleted: string[]) {
  return runProjectsGC(framework, {
    apply: true,
    owner: OWNER,
    existingMarker: THEOCODE_MARKER,
    removeFromRegistry: (id) => void deleted.push(id),
  })
}

describe('the all-projects sweep speaks one id namespace', () => {
  it('test_the_apply_backstop_refuses_a_transcript_whose_session_became_the_live_pointer', async () => {
    // #49 — the TOCTOU backstop compares a filename stem against the pointer (a session id). Before
    // the fix the refusal list is empty and the LIVE session's transcript is unlinked. The pointer
    // is set at APPLY time only — that is the TOCTOU shape: at plan time this session was not live,
    // so nothing protected it. A newer decoy is needed because the most recent transcript is always
    // protected.
    const t = realTree([fileOf(OLD_ID), fileOf(LIVE_ID)], [0, 90])
    const p = await plan({
      base: t.base,
      onDisk: [
        { name: fileOf(OLD_ID), mtimeMs: NOW },
        { name: fileOf(LIVE_ID), mtimeMs: NOW - 90 * DAY },
      ],
    })
    expect(
      p.candidates,
      'the fixture must produce a candidate, or this case proves nothing',
    ).toHaveLength(1)
    writeFileSync(t.pointer, `${LIVE_ID}\n`)

    const result = await apply(p.framework, [])

    expect(existsSync(t.files[1] as string), 'the live session transcript was removed').toBe(true)
    expect(result.removed).toEqual([])
    expect(result.refused.map((r) => r.reason).join(' ')).toMatch(/pointer|resum|live/i)
  })

  it('test_a_registered_transcript_is_deleted_by_its_session_id_not_its_filename', async () => {
    // #51 — the registry delete requires a session id. Passing the filename makes it a no-op that
    // never touches the .jsonl, while `removed` reports the file gone. Every run, forever.
    // ARCHIVED, because that is the reachable shape: every UNarchived registry entry is protected,
    // so a live registered transcript is never a candidate. An archived session's transcript is
    // collectable AND in the registry. A second, NEWER transcript is required: the most recent one
    // is always protected, so a lone file can never be collected.
    const t = realTree([fileOf(LIVE_ID), fileOf(OLD_ID)], [0, 90])
    const p = await plan({
      base: t.base,
      // The framework protects the registry's most recently modified session, so the newer one is
      // listed too; the archived one is then genuinely collectable.
      registry: [
        { agentId: LIVE_ID, lastModified: NOW },
        { agentId: OLD_ID, lastModified: NOW - 90 * DAY, archived: true },
      ],
      onDisk: [
        { name: fileOf(LIVE_ID), mtimeMs: NOW },
        { name: fileOf(OLD_ID), mtimeMs: NOW - 90 * DAY },
      ],
    })
    const transcripts = p.candidates.filter((c) => c.kind === 'transcript')
    expect(transcripts, 'the archived transcript must be the one candidate').toHaveLength(1)
    expect(basename(transcripts[0]?.target ?? '')).toBe(fileOf(OLD_ID))

    const deleted: string[] = []
    await apply(p.framework, deleted)

    expect(
      deleted.every((id) => id === OLD_ID),
      `deleted by filename: ${deleted.join(',')}`,
    ).toBe(true)
    expect(
      existsSync(t.files[1] as string),
      'the transcript of the archived session survived',
    ).toBe(false)
  })

  it('test_a_registry_entry_whose_transcript_is_on_disk_is_not_collected_separately', async () => {
    // #52 — a session id compared against filename stems: the sweep protects the transcript and
    // deletes the registry entry that names it.
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
    // is collected on sight. Absence of a date is not evidence of age.
    const p = await plan({ registry: [{ agentId: OLD_ID }] })

    expect(
      p.candidates.filter((c) => c.kind === 'registry'),
      'an entry with no date was aged to 1970 and collected',
    ).toEqual([])
  })
})

describe('pointer and registry protections hold across plan and apply', () => {
  it('test_the_pointer_session_transcript_is_not_planned_at_all', async () => {
    const p = await plan({
      pointer: OLD_ID,
      onDisk: [
        { name: fileOf(LIVE_ID), mtimeMs: NOW },
        { name: fileOf(OLD_ID), mtimeMs: NOW - 90 * DAY },
      ],
    })

    expect(p.candidates).toEqual([])
  })

  it('test_an_unarchived_registry_entry_protects_its_stale_transcript', async () => {
    const p = await plan({
      registry: [{ agentId: OLD_ID, lastModified: NOW - 90 * DAY }],
      onDisk: [
        { name: fileOf(LIVE_ID), mtimeMs: NOW },
        { name: fileOf(OLD_ID), mtimeMs: NOW - 90 * DAY },
      ],
    })

    expect(p.candidates).toEqual([])
  })

  it('test_an_unregistered_stale_transcript_is_unlinked_by_path_not_deleted_by_id', async () => {
    const t = realTree([fileOf(LIVE_ID), fileOf(OLD_ID)], [0, 90])
    const p = await plan({
      base: t.base,
      onDisk: [
        { name: fileOf(LIVE_ID), mtimeMs: NOW },
        { name: fileOf(OLD_ID), mtimeMs: NOW - 90 * DAY },
      ],
    })
    expect(p.candidates).toHaveLength(1)

    const deleted: string[] = []
    await apply(p.framework, deleted)

    expect(existsSync(t.files[1] as string)).toBe(false)
    expect(deleted, 'an unregistered transcript was deleted through the registry').toEqual([])
  })

  it('test_a_stale_registry_entry_with_no_transcript_is_a_registry_candidate', async () => {
    const p = await plan({
      registry: [{ agentId: OLD_ID, lastModified: NOW - 90 * DAY }],
      onDisk: [{ name: fileOf(LIVE_ID), mtimeMs: NOW }],
    })

    expect(p.candidates.filter((c) => c.kind === 'registry').map((c) => c.target)).toContain(OLD_ID)
  })
})
