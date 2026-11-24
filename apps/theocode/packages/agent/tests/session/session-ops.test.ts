/**
 * B-003 — the fork guard is handed every live path it can see.
 *
 * `forkTranscript` accepts `liveSessionPaths`: the paths it must never write over. The SDK documents
 * what belongs there — *"the live pointer, the most recent transcript, any active registry entry"* —
 * and states why the caller supplies them: only the caller knows which session is live.
 *
 * TheoCode supplied one of the three. The most recent transcript is the session a TUI is most likely
 * still appending to, and it was absent, so a fork could target it and the SDK's typed
 * `LiveSessionError` never fired.
 *
 * Residual protection is real and worth naming: `forkTranscript` opens the destination with `wx`, so
 * an existing transcript still cannot be overwritten — the loser gets a bare EEXIST instead of a
 * typed error the callers can tell apart. That is why this was MEDIUM, not HIGH.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  utimesSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { legacyTranscriptPath, transcriptPath } from '@theokit/agents/persistence'
import { sessionPointerPath } from '@theokit/agents/session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  LiveSessionDeletionError,
  deleteSession,
  forkSession,
  protectedSessions,
} from '../../src/session/session-ops.js'

let base: string
let cwd: string

/**
 * Write a transcript for `id` and stamp its mtime so "most recent" is deterministic.
 *
 * The path comes from `transcriptPath`, never from string-building. This fixture used to compose
 * `<base>/projects/<encoded-cwd>/<id>.jsonl` itself and the assertions matched on `<id>.jsonl`,
 * which stopped being the filename when the SDK moved transcripts to UUID names. Both halves had to
 * stop assuming: the writer asks for the path, and the caller compares against the path it got back
 * rather than against a name it expects the layout to produce.
 */
function writeTranscript(id: string, ageSeconds: number): string {
  const path = transcriptPath(base, cwd, id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '{}\n')
  const when = new Date(Date.now() - ageSeconds * 1000)
  utimesSync(path, when, when)
  return path
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'theocode-sessops-'))
  cwd = mkdtempSync(join(tmpdir(), 'theocode-proj-'))
})

afterEach(() => {
  rmSync(base, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

function writeLegacyTranscript(id: string): string {
  const path = legacyTranscriptPath(base, cwd, id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '{}\n')
  return path
}

function point(id: string): void {
  mkdirSync(dirname(sessionPointerPath(cwd, base)), { recursive: true })
  writeFileSync(sessionPointerPath(cwd, base), `${id}\n`)
}

describe('#2869 — the pointer is protected once, under the name on disk', () => {
  it('test_a_legacy_only_transcript_gives_exactly_the_legacy_path', async () => {
    const legacy = writeLegacyTranscript('legacy-id')
    point('legacy-id')
    expect(await protectedSessions(cwd, base)).toEqual([legacy])
  })

  it('test_a_pointer_without_a_file_keeps_the_derived_path', async () => {
    point('ghost')
    expect(await protectedSessions(cwd, base)).toContain(transcriptPath(base, cwd, 'ghost'))
  })

  it('test_an_unreadable_pointer_still_blocks_protection_and_deletion', async () => {
    const old = writeTranscript('old', 5000)
    writeTranscript('new', 1)
    // A directory where the pointer file should be: reading it fails with EISDIR, not ENOENT.
    mkdirSync(sessionPointerPath(cwd, base), { recursive: true })

    await expect(protectedSessions(cwd, base)).rejects.toThrow(/last-session pointer/)
    await expect(
      deleteSession('old', { cwd, baseDir: base, removeFromRegistry: async () => {} }),
    ).rejects.toThrow(/last-session pointer/)
    expect(existsSync(old)).toBe(true)
  })

  it('test_deleteSession_never_removes_a_pointed_legacy_only_file', async () => {
    // Deletion targets the derived name, which does not exist here; the legacy file is untouched.
    const legacy = writeLegacyTranscript('legacy-id')
    point('legacy-id')
    const result = await deleteSession('legacy-id', {
      cwd,
      baseDir: base,
      removeFromRegistry: async () => {},
    })
    expect(result.transcriptRemoved).toBe(false)
    expect(existsSync(legacy)).toBe(true)
  })

  it('test_forkSession_refuses_to_write_onto_the_pointed_session', async () => {
    writeTranscript('src', 100)
    const dst = writeTranscript('live', 1)
    point('live')
    await expect(forkSession('src', 'live', { cwd, baseDir: base })).rejects.toThrow(
      /refusing to write over a live session transcript/,
    )
    expect(readFileSync(dst, 'utf8')).toBe('{}\n')
  })
})

describe('B-003 — protectedSessions covers what the caller can see', () => {
  it('test_the_live_pointer_is_protected', async () => {
    const pointed = writeTranscript('tui-pointed', 10)
    mkdirSync(dirname(sessionPointerPath(cwd, base)), { recursive: true })
    writeFileSync(sessionPointerPath(cwd, base), 'tui-pointed\n')

    expect(await protectedSessions(cwd, base)).toContain(pointed)
  })

  it('test_the_most_recent_transcript_is_protected_even_without_a_pointer', async () => {
    writeTranscript('older', 3600)
    const newest = writeTranscript('newest', 5)

    expect(
      await protectedSessions(cwd, base),
      'the most recent transcript is the one a running session is most likely still appending to, ' +
        'and it was absent from the guard the SDK uses to refuse a fork onto a live session',
    ).toEqual([newest])
  })

  it('test_an_empty_project_protects_nothing', async () => {
    // Anti-vacuity floor: a function returning a constant would satisfy the assertions above.
    expect(await protectedSessions(cwd, base)).toEqual([])
  })

  it('test_an_ACTIVE_WRITER_LEASE_protects_a_transcript_that_is_neither', async () => {
    // The third category, and the reason this migration was worth making.
    //
    // This file used to carry a comment explaining that the category was UNREACHABLE here:
    // `listAgents` is async and both callers are synchronous write paths, so covering it would
    // have made two write paths async. `protectedTranscripts` (M71) resolves it through the SDK's
    // writer LEASE instead of the async registry — synchronously — so the constraint no longer
    // applies.
    //
    // The assertion is deliberately over a transcript that is NEITHER the pointer NOR the most
    // recent: those two were already protected, so a test using one of them would pass against the
    // old implementation and prove nothing about what changed.
    const { acquireSessionWriter } = await import('@theokit/agents/persistence')
    const leased = writeTranscript('leased', 3600) // old, and not pointed at
    writeTranscript('newest', 5) // the most recent, so `leased` is protected only by its lease

    // Anti-vacuity, in the same test: WITHOUT the lease this transcript is collectable. That is the
    // assertion the old implementation would satisfy, and it is what makes the one below meaningful
    // instead of true-by-construction.
    expect(await protectedSessions(cwd, base)).not.toContain(leased)

    const lease = await acquireSessionWriter(leased)
    try {
      expect(
        await protectedSessions(cwd, base),
        'a transcript with a live writer lease was collectable — the category this file previously ' +
          'documented as out of reach',
      ).toContain(leased)
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })

  it('test_the_pointer_and_the_most_recent_are_not_duplicated', async () => {
    writeTranscript('only-one', 5)
    mkdirSync(dirname(sessionPointerPath(cwd, base)), { recursive: true })
    writeFileSync(sessionPointerPath(cwd, base), 'only-one\n')

    expect(await protectedSessions(cwd, base)).toHaveLength(1)
  })
})

/**
 * B-078 — deletion removes the transcript, not just the listing.
 *
 * `Agent.archive` only flips a flag: `/sessions` still lists the session, suffixed `(archived)`, and
 * the transcript stays on disk. So a session that captured a pasted credential could not be removed
 * through the product at all.
 *
 * The trap this pins was MEASURED in the SDK, not guessed: `Agent.delete` is
 * `removeRegisteredAgent(agentId); await flushRegistrySaves()` — an in-memory registry delete plus a
 * save. It never touches the file. Calling it alone would empty the listing and leave the transcript
 * exactly where it was, which is the failure mode that reads as success.
 *
 * The live-session guard reuses `protectedSessions`, the same set `forkSession` already refuses to
 * overwrite (B-003) — deleting the transcript a running TUI is appending to is worse than forking
 * onto it.
 */
describe('B-078 — deleteSession', () => {
  it('test_removes_the_transcript_from_disk', async () => {
    // A NEWER transcript must exist, or the target is the most recent one and the live guard
    // correctly refuses it. The first draft of this test omitted it and read as a product failure.
    const path = writeTranscript('tui-doomed', 500)
    writeTranscript('tui-current', 1)
    expect(existsSync(path)).toBe(true)

    const result = await deleteSession('tui-doomed', {
      cwd,
      baseDir: base,
      removeFromRegistry: async () => {},
    })

    expect(result.transcriptRemoved).toBe(true)
    expect(existsSync(path), 'the transcript survived a delete that reported success').toBe(false)
  })

  it('test_removes_the_registry_entry_too', async () => {
    writeTranscript('tui-doomed', 500)
    writeTranscript('tui-current', 1)
    const removed: string[] = []

    await deleteSession('tui-doomed', {
      cwd,
      baseDir: base,
      removeFromRegistry: async (id) => {
        removed.push(id)
      },
    })

    // Both halves or neither: a transcript gone from disk while the registry still lists it leaves a
    // session that cannot be opened and cannot be removed.
    expect(removed).toEqual(['tui-doomed'])
  })
})

/** The guard half — separated so each block stays readable, not to dodge the length rule. */
describe('B-078 — deleteSession refuses a live session', () => {
  it('test_refuses_to_delete_a_live_session', async () => {
    // The newest transcript is the one a running TUI is most likely still appending to.
    writeTranscript('tui-old', 5000)
    const live = writeTranscript('tui-live', 1)

    await expect(
      deleteSession('tui-live', { cwd, baseDir: base, removeFromRegistry: async () => {} }),
    ).rejects.toThrow(LiveSessionDeletionError)

    expect(existsSync(live), 'a refused delete still removed the file').toBe(true)
  })

  it('test_refusing_leaves_the_registry_untouched', async () => {
    // Order matters: removing the registry entry and THEN refusing would leave the session
    // unreachable and undeletable — worse than either outcome alone.
    writeTranscript('tui-old', 5000)
    writeTranscript('tui-live', 1)
    const removed: string[] = []

    await expect(
      deleteSession('tui-live', {
        cwd,
        baseDir: base,
        removeFromRegistry: async (id) => {
          removed.push(id)
        },
      }),
    ).rejects.toThrow(LiveSessionDeletionError)

    expect(removed).toEqual([])
  })

  it('test_a_missing_transcript_is_reported_not_invented', async () => {
    // The registry can outlive the file. Deleting must still clear the entry, and must SAY the file
    // was already gone rather than claim it removed one.
    writeTranscript('tui-other', 5000)
    const removed: string[] = []

    writeTranscript('tui-current', 1)
    const result = await deleteSession('tui-ghost', {
      cwd,
      baseDir: base,
      removeFromRegistry: async (id) => {
        removed.push(id)
      },
    })

    expect(result.transcriptRemoved).toBe(false)
    expect(removed).toEqual(['tui-ghost'])
  })
})

describe("deleteSession — the transcript mechanics are the framework's", () => {
  it('test_the_transcript_removal_has_no_check_then_act_race', async () => {
    // The reason this file delegates rather than keeping four lines of its own.
    //
    // It used to do `existsSync(target)` and then `rmSync(target, { force: true })`, reporting the
    // FIRST call's answer. Between the two, a concurrent GC sweep or a second TUI can unlink the
    // file — and the result then claims `transcriptRemoved: true` for a file this call did not
    // remove. `@theokit/agents`' `deleteSession` has no such window: it calls `rmSync` and derives
    // the answer from whether that threw, so the reported outcome is the one that happened.
    //
    // Asserted through the observable contract rather than by racing the filesystem: the answer must
    // come from the removal itself, so a transcript that never existed reports false and one that
    // did reports true — with no third state where the report and the disk disagree.
    writeTranscript('tui-other', 5000)
    writeTranscript('tui-current', 1)
    writeTranscript('tui-doomed', 900)

    const real = await deleteSession('tui-doomed', {
      cwd,
      baseDir: base,
      removeFromRegistry: async () => {},
    })
    expect(real.transcriptRemoved).toBe(true)

    // Same call, same session, now absent: the second answer is derived, not remembered.
    const again = await deleteSession('tui-doomed', {
      cwd,
      baseDir: base,
      removeFromRegistry: async () => {},
    })
    expect(again.transcriptRemoved).toBe(false)
  })

  it('test_it_delegates_the_transcript_removal_to_the_framework', async () => {
    // Pillar of the migration: the mechanics live in `@theokit/agents/session`, not here. Asserted
    // on the seam — this module must not reach for `node:fs` to remove a transcript, because two
    // owners of "how a transcript is deleted" is how the two answers drift apart.
    const source = readFileSync(
      new URL('../../src/session/session-ops.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain("from '@theokit/agents/session'")

    // Comments stripped first. The prose above the delegation NAMES the call it replaced, and a
    // guard that reads its own documentation as a violation would force the explanation out of the
    // file — the opposite of what it is for.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code, 'session-ops.ts still unlinks transcripts by hand').not.toMatch(/\brmSync\(/)
  })
})

describe('#1905 — the TUI pointer protects an idle, older session', () => {
  function point(id: string): void {
    mkdirSync(dirname(sessionPointerPath(cwd, base)), { recursive: true })
    writeFileSync(sessionPointerPath(cwd, base), `${id}\n`)
  }

  it('test_deleteSession_refuses_the_pointed_session_that_is_not_newest', async () => {
    const pointed = writeTranscript('tui-pointed', 5000)
    writeTranscript('tui-newest', 1)
    point('tui-pointed')

    await expect(
      deleteSession('tui-pointed', { cwd, baseDir: base, removeFromRegistry: async () => {} }),
    ).rejects.toThrow(LiveSessionDeletionError)
    expect(existsSync(pointed)).toBe(true)
  })

  it('test_forkSession_refuses_to_overwrite_the_pointed_session', async () => {
    writeTranscript('src', 4000)
    const pointed = writeTranscript('tui-pointed', 5000)
    writeTranscript('tui-newest', 1)
    point('tui-pointed')

    await expect(forkSession('src', 'tui-pointed', { cwd, baseDir: base })).rejects.toThrow(
      /refusing to write over a live session/,
    )
    expect(readFileSync(pointed, 'utf8')).toBe('{}\n')
  })

  it('test_an_unpointed_unleased_non_newest_session_is_still_deletable', async () => {
    const other = writeTranscript('tui-other', 5000)
    writeTranscript('tui-pointed', 4000)
    writeTranscript('tui-newest', 1)
    point('tui-pointed')

    const result = await deleteSession('tui-other', {
      cwd,
      baseDir: base,
      removeFromRegistry: async () => {},
    })
    expect(result.transcriptRemoved).toBe(true)
    expect(existsSync(other)).toBe(false)
  })
})
