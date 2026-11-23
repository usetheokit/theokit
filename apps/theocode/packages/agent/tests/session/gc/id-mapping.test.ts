/**
 * #102 — every place the gc compares a session id with a transcript name maps first.
 *
 * `ca3db5c` fixed this in ONE of the four places. `theocode review` found the other two on its
 * first working run, and both were confirmed against the source before being accepted:
 *
 *   all-sessions.ts:193  `protectedIds.add(e.agentId)` — a SESSION id added to a set queried with
 *                        transcript names, so a registered non-archived session in another project
 *                        stays unprotected. Exactly the defect ca3db5c was cut to close.
 *   per-session.ts:179   `del(c.id)` — `Agent.delete` receives the transcript NAME where it expects
 *                        the session id, so the registry entry survives a deletion that reported
 *                        success.
 *
 * The two fail in opposite directions and that is why both matter: the first DELETES something it
 * should have kept, the second KEEPS something it said it removed.
 *
 * These arms are about the mapping, not about the filesystem: `transcriptIdOf` is the seam, and a
 * candidate now carries the id it was matched from so the deletion can speak the registry's
 * vocabulary.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { legacyTranscriptPath, transcriptPath } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'

const DAY = 86_400_000
const now = (): number => 1_000 * DAY

// The framework planner has no `readdir`/`list`/`readPointer` seams, so each entry is a real file
// under a temp transcript root; the registry listing and its remover stay injected.
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

function seed(id: string, mtimeMs: number, legacy = false): string {
  const path = (legacy ? legacyTranscriptPath : transcriptPath)(root, cwd, id)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ type: 'user', sessionId: id })}\n`)
  utimesSync(path, new Date(mtimeMs), new Date(mtimeMs))
  return path
}

const planSessionGC = (o: {
  list: () => Promise<{ agentId: string; archived?: boolean }[]>
  removed?: string[]
}) =>
  planAndRunCurrentProjectGC({
    cwd,
    root,
    now: now(),
    keepLast: 1,
    maxAgeDays: 1,
    apply: o.removed !== undefined,
    listRegistry: o.list,
    removeFromRegistry: (id) => void o.removed?.push(id),
  })

describe('#102 — deletion speaks the registry vocabulary', () => {
  it('test_a_registered_session_is_deleted_by_its_session_id_not_its_filename', async () => {
    // P2. Before: `del` received the transcript stem, `Agent.delete` found nothing, and the run
    // reported the session as removed. The registry entry outlived its transcript.
    const deleted: string[] = []
    const agentId = 'exec-522dc0ef-0bf9-419d-b40c-cf0c81d611e4'

    // A NEWER decoy, so the target is not the most-recent transcript — that guard protects it
    // unconditionally and would make this arm assert nothing.
    seed('decoy-newer', 999 * DAY)
    seed(agentId, 0)

    // Plan and apply are one call here; the registry remover is what `Agent.delete` is.
    await planSessionGC({
      list: () => Promise.resolve([{ agentId, archived: true }]),
      removed: deleted,
    })

    expect(deleted, 'Agent.delete was handed a transcript filename').toEqual([agentId])
  })

  it('test_both_naming_conventions_of_a_live_session_are_protected', async () => {
    // #102, the half `ca3db5c` broke while fixing the other half. 5.x hashes the session id into
    // the filename; 4.x used the id itself, and the SDK still exports `legacyTranscriptPath`
    // because an upgraded machine has both on disk.
    //
    // Mapping ALONE protects the 5.x name and leaves the 4.x one deletable — for a session the
    // registry currently lists. Both arms below are therefore the same claim from two directions,
    // and neither alone would have caught the trade.
    const agentId = 'exec-522dc0ef-0bf9-419d-b40c-cf0c81d611e4'
    seed('decoy-newer', 999 * DAY)
    const current = seed(agentId, 0)
    const legacy = seed(agentId, 0, true)
    const plan = await planSessionGC({
      list: () => Promise.resolve([{ agentId }]),
      removed: [], // apply, so the file checks below are not vacuous
    })

    // Candidates are reported by session id, which both names share, so the files are checked too.
    expect(plan.plan.candidates, 'a transcript of a live session was planned for deletion').toEqual(
      [],
    )
    expect(existsSync(current), 'the 5.x-named transcript of a live session was deleted').toBe(true)
    expect(existsSync(legacy), 'the 4.x-named transcript of a live session was deleted').toBe(true)
  })
})
