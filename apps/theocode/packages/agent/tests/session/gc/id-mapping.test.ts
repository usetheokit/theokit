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
import { basename } from 'node:path'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'
import { describe, expect, it } from 'vitest'

import { planSessionGC, runSessionGC } from '../../../src/session/gc/per-session.js'

const DAY = 86_400_000
const now = (): number => 1_000 * DAY

describe('#102 — deletion speaks the registry vocabulary', () => {
  it('test_a_registered_session_is_deleted_by_its_session_id_not_its_filename', async () => {
    // P2. Before: `del` received the transcript stem, `Agent.delete` found nothing, and the run
    // reported the session as removed. The registry entry outlived its transcript.
    const deleted: string[] = []
    const agentId = 'exec-522dc0ef-0bf9-419d-b40c-cf0c81d611e4'

    const plan = await planSessionGC({
      cwd: '/p',
      now,
      keepLast: 0,
      maxAgeDays: 1,
      list: () => Promise.resolve([{ agentId, archived: true }]),
      // A NEWER decoy, so the target is not the most-recent transcript — that guard protects it
      // unconditionally and would make this arm assert nothing.
      readdir: () => [
        { id: 'decoy-newer', mtimeMs: 999 * DAY },
        { id: idOf(agentId), mtimeMs: 0 },
      ],
      readPointer: () => undefined,
    } as never)

    await runSessionGC(plan, {
      apply: true,
      // B-161: `readdir` and `cwd` are injected here as well as into planSessionGC. Without them
      // `resolveApply` falls through to `process.cwd()` and reads the REAL transcript store —
      // per-session.ts:226, `(opts.readdir ?? readTranscriptDir)(transcriptDir(cwd, baseDir))` — so
      // this test covered three production lines on a machine that had sessions and none on a clean
      // checkout, making total coverage a property of the machine.
      cwd: '/p',
      readdir: () => [],
      delete: (id: string) => {
        deleted.push(id)
        return Promise.resolve()
      },
    } as never)

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
    const plan = await planSessionGC({
      cwd: '/p',
      now,
      keepLast: 0,
      maxAgeDays: 1,
      list: () => Promise.resolve([{ agentId }]),
      readdir: () => [
        { id: 'decoy-newer', mtimeMs: 999 * DAY },
        { id: idOf(agentId), mtimeMs: 0 },
        { id: agentId, mtimeMs: 0 },
      ],
      readPointer: () => undefined,
    } as never)

    const doomed = plan.candidates.map((c) => c.id)
    expect(doomed, 'the 5.x-named transcript of a live session was planned for deletion').not.toContain(idOf(agentId))
    expect(doomed, 'the 4.x-named transcript of a live session was planned for deletion').not.toContain(agentId)
  })
})

// The forward mapping, from the SAME module the production code uses. Re-deriving it here would
// give the test a second copy that keeps passing while production drifts — the family of bug this
// file exists to close.
function idOf(session: string): string {
  return basename(transcriptPath(transcriptRoot(), '/p', session)).replace(/\.jsonl$/, '')
}
