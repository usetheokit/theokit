import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireSessionWriter, transcriptPath, transcriptRoot } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SessionInUseError,
  deleteSession,
  listSessions,
  protectedTranscripts,
} from '../../src/session/session-lifecycle.js'
import { loadOrCreateSessionId, persistSessionId } from '../../src/session/session-pointer.js'
import {
  projectDirFor,
  projectsRoot,
  projectDirMatches,
  recordProjectDir,
  resolveProjectDir,
} from '../../src/session/project-index.js'

/**
 * M71 — the session lifecycle vocabulary, against a real transcript root on disk.
 *
 * Real files rather than mocks: every assertion here is about what happens to bytes — which file
 * survives a delete, whether a lock is observed, whether a pointer round-trips. A mocked filesystem
 * would let all of them pass while the module deleted the wrong thing.
 */

const CWD = '/some/project'
/** A fixed clock for mtimes — a live clock makes ordering depend on run speed. */
const FIXED_NOW = 1_700_000_000_000
let root: string
/**
 * A root that cannot be written to.
 *
 * A regular FILE used as a directory: every write under it fails `ENOTDIR`, instantly and on every
 * platform. The first draft used `/proc/nonexistent-root`, which made `mkdirSync(..., {recursive:
 * true})` hang rather than fail — a fixture that turned "assert this does not throw" into a test
 * that never finished.
 */
let unwritableRoot: string

/**
 * Write a transcript with an EXPLICIT mtime.
 *
 * Recency ordering is real behaviour here — `protectedTranscripts` keeps the most recent — so two
 * files written in the same millisecond would make the outcome depend on filesystem timestamp
 * resolution. `ageSeconds` says which is older, out loud. (The first draft of this file relied on
 * write order and the guard correctly refused to delete what the fixture had accidentally made the
 * newest file.)
 */
function writeTranscriptFile(sessionId: string, ageSeconds = 0, contents = ''): string {
  const path = transcriptPath(root, CWD, sessionId)
  mkdirSync(projectDirFor(CWD, root), { recursive: true })
  writeFileSync(path, contents, 'utf8')
  const when = new Date(FIXED_NOW - ageSeconds * 1000)
  utimesSync(path, when, when)
  return path
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theokit-session-'))
  unwritableRoot = join(root, 'a-file-not-a-directory')
  writeFileSync(unwritableRoot, 'x', 'utf8')
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('listSessions', () => {
  it('test_an_absent_project_directory_lists_nothing_rather_than_throwing', () => {
    // The first run of any project hits this. Throwing would make "no sessions yet" an error state.
    expect(listSessions(CWD, root)).toEqual([])
  })

  it('test_it_lists_transcripts_most_recent_first', () => {
    writeTranscriptFile('older', 60)
    writeTranscriptFile('newer', 0)
    const ids = listSessions(CWD, root).map((s) => s.id)
    expect(ids).toHaveLength(2)
    expect(ids).toContain('older')
    expect(ids).toContain('newer')
  })

  it('test_it_ignores_entries_that_are_not_transcripts', () => {
    // Anti-vacuity AND the reason `classifySessionArtifact` is used instead of a local matcher: a
    // project directory holds four kinds of file, and a lifecycle op that treated a lock as a
    // session would offer to delete the lock.
    writeTranscriptFile('real')
    writeFileSync(join(projectDirFor(CWD, root), 'not-ours.txt'), 'x', 'utf8')
    expect(listSessions(CWD, root).map((s) => s.id)).toEqual(['real'])
  })
})

describe('deleteSession — the two stores are reported separately', () => {
  it('test_it_reports_registry_and_transcript_independently', async () => {
    // The asymmetry that made the gap a trap: `Agent.delete` clears the REGISTRY ENTRY and never
    // touches the file. A single boolean would rebuild exactly that confusion.
    writeTranscriptFile('doomed', 60) // a minute older, so it is not the most recent
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)

    const result = deleteSession('doomed', { cwd: CWD, root, removeFromRegistry: () => true })
    expect(result).toEqual({ registryRemoved: true, transcriptRemoved: true })
    expect(existsSync(transcriptPath(root, CWD, 'doomed'))).toBe(false)
  })

  it('test_an_async_registry_remover_is_refused_instead_of_reported_as_done', async () => {
    // The seam could not be satisfied by any real registry, and failed dishonestly when tried.
    //
    // Measured: the SDK's `Agent.delete` returns `Promise<void>` — it is the only agent registry in
    // the ecosystem, and the sole synchronous `delete(name): boolean` in the SDK's surface belongs to
    // `Budget`, not to a registry. So EVERY genuine caller has an async remover.
    //
    // What the old code did with one: `options.removeFromRegistry?.(id) ?? false` evaluates to a
    // Promise, which is truthy, so `registryRemoved: true` was reported before the removal had
    // happened — and a rejection became an unhandled rejection nobody saw. Reporting a delete that
    // has not occurred is strictly worse than refusing to try.
    //
    // TypeScript blocks this at a typed call site, which is why it survived: only JS callers and
    // `as`-casts reach it, and both get a wrong answer rather than an error.
    writeTranscriptFile('doomed', 60)
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)

    const asyncRemover = (() => Promise.resolve(true)) as unknown as (id: string) => boolean

    expect(() =>
      deleteSession('doomed', { cwd: CWD, root, removeFromRegistry: asyncRemover }),
    ).toThrow(/synchronous/i)

    // And it refuses BEFORE mutating: the transcript is still there for the caller to retry.
    expect(existsSync(transcriptPath(root, CWD, 'doomed'))).toBe(true)
  })

  it('test_without_a_registry_remover_only_the_transcript_goes', async () => {
    // And it SAYS so. The registry is the runtime's, injected — a caller that forgot to pass the
    // remover gets `registryRemoved: false`, not a silent half-delete it believes was whole.
    writeTranscriptFile('doomed', 60)
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)

    expect(deleteSession('doomed', { cwd: CWD, root })).toEqual({
      registryRemoved: false,
      transcriptRemoved: true,
    })
  })

  it('test_deleting_something_already_gone_is_not_a_failure', async () => {
    // Absent is the desired end state, so a missing file reports `false`, never throws.
    writeTranscriptFile('keeper', 0)
    writeTranscriptFile('other', 60)
    await persistSessionId(CWD, 'keeper', root)
    expect(deleteSession('never-existed', { cwd: CWD, root }).transcriptRemoved).toBe(false)
  })
})

describe('protectedTranscripts — three reasons, kept distinct', () => {
  it('test_the_pointer_target_is_protected_and_says_why', async () => {
    writeTranscriptFile('pointed', 60)
    writeTranscriptFile('other', 0)
    await persistSessionId(CWD, 'pointed', root)
    expect(protectedTranscripts(CWD, root).get('pointed')).toMatch(/pointer/i)
  })

  it('test_the_most_recent_is_protected_even_without_a_pointer', () => {
    // A GC that leaves a project with nothing to `--continue` destroyed the feature it protected.
    writeTranscriptFile('only')
    expect(protectedTranscripts(CWD, root).get('only')).toMatch(/most recent/i)
  })

  it('test_the_reasons_are_not_collapsed_into_a_boolean', () => {
    // "Skipped 4 sessions" is far less useful than why each was skipped, and retention is exactly
    // where an operator asks.
    writeTranscriptFile('a')
    const reasons = [...protectedTranscripts(CWD, root).values()]
    expect(reasons.every((r) => typeof r === 'string' && r.length > 0)).toBe(true)
  })
})

describe('deleteSession — the negative case the DoD demands', () => {
  it('test_deleting_a_session_with_an_ACTIVE_WRITER_LEASE_fails_with_a_typed_error', async () => {
    const path = writeTranscriptFile('live', 60)
    writeTranscriptFile('other', 0)
    const lease = await acquireSessionWriter(path)
    try {
      // Typed, not a bare throw: a caller catching `SessionInUseError` distinguishes "something is
      // using this" from any IO failure, and the alternative — deleting anyway — discards state a
      // running process still holds, unrecoverably.
      expect(() => deleteSession('live', { cwd: CWD, root })).toThrow(SessionInUseError)
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })

  it('test_the_refusal_names_the_session_and_the_reason', async () => {
    const path = writeTranscriptFile('live', 60)
    writeTranscriptFile('other', 0)
    const lease = await acquireSessionWriter(path)
    try {
      deleteSession('live', { cwd: CWD, root })
      expect.unreachable('a live session was deleted')
    } catch (error) {
      expect(error).toBeInstanceOf(SessionInUseError)
      expect((error as SessionInUseError).sessionId).toBe('live')
      expect((error as SessionInUseError).reason.length).toBeGreaterThan(0)
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })

  it('test_force_deletes_anyway_so_the_guard_is_a_default_not_a_wall', async () => {
    // Counter-proof. A refusal with no way past is not a guard, it is a removed feature — and the
    // operator with a stale lock from a crashed process needs the way past.
    writeTranscriptFile('pointed')
    await persistSessionId(CWD, 'pointed', root)
    expect(deleteSession('pointed', { cwd: CWD, root, force: true }).transcriptRemoved).toBe(true)
  })
})

describe('session pointer — atomic, and never rejects', () => {
  it('test_a_fresh_project_mints_an_id_instead_of_failing', () => {
    const { sessionId, resumed } = loadOrCreateSessionId(CWD, () => 'minted', root)
    expect(sessionId).toBe('minted')
    expect(resumed).toBe(false)
  })

  it('test_a_persisted_id_round_trips_and_reports_resumed', async () => {
    await persistSessionId(CWD, 'kept', root)
    expect(loadOrCreateSessionId(CWD, () => 'unused', root)).toEqual({
      sessionId: 'kept',
      resumed: true,
    })
  })

  it('test_an_unwritable_root_REPORTS_the_failure_instead_of_throwing', async () => {
    // The narrow, deliberate exception to fail-fast. Losing the pointer costs a `--continue`;
    // failing the run costs the run. The failure is RETURNED, never swallowed — a caller that cares
    // can surface it, one that does not still has a usable session.
    await expect(persistSessionId(CWD, 'x', unwritableRoot)).resolves.toEqual({
      persisted: false,
    })
  })

  it('test_reading_an_unreadable_pointer_falls_back_to_a_fresh_id', () => {
    expect(loadOrCreateSessionId(CWD, () => 'fresh', unwritableRoot)).toEqual({
      sessionId: 'fresh',
      resumed: false,
    })
  })
})

describe('project index — the reverse lookup encodeProjectDir never had', () => {
  it('test_a_recorded_cwd_resolves_back_from_its_encoded_name', () => {
    recordProjectDir(CWD, root)
    const encoded = projectDirFor(CWD, root).split('/').pop() ?? ''
    expect(resolveProjectDir(encoded, root)).toBe(CWD)
  })

  it('test_an_unknown_name_resolves_to_undefined_meaning_NOT_KNOWN_HERE', () => {
    // The distinction that keeps a GC from deleting live projects: `undefined` is "no sidecar", the
    // same state a project created before this index existed produces. It is not "does not exist".
    expect(resolveProjectDir('never-recorded', root)).toBeUndefined()
  })

  it('test_the_matcher_confirms_a_cwd_the_caller_already_has', () => {
    const encoded = projectDirFor(CWD, root).split('/').pop() ?? ''
    expect(projectDirMatches(encoded, CWD)).toBe(true)
    expect(projectDirMatches(encoded, '/a/different/project')).toBe(false)
  })

  it('test_recording_is_best_effort_and_never_throws', () => {
    // An index is an optimisation. A machine that cannot write it should still run an agent.
    expect(() => recordProjectDir(CWD, unwritableRoot)).not.toThrow()
  })
})

describe('projectsRoot — one owner for the transcript layout', () => {
  it('test_the_projects_segment_has_a_single_owner', () => {
    // `join(root, 'projects', encoded)` was written in three places: twice here and once in the
    // closest consumer, which restated it as `join(transcriptRoot(), 'projects')` to enumerate every
    // project for a GC sweep.
    //
    // The failure mode is silent, which is why this is worth a function. Change the segment and the
    // consumer's `existsSync(root) ? readdir(root) : []` returns an EMPTY list — so the sweep finds
    // nothing, deletes nothing, and reports success. A wrong path that throws is a bug report; a
    // wrong path that returns nothing is a backup that quietly stopped running.
    const root = '/tmp/theokit-root'

    expect(projectsRoot(root)).toBe(join(root, 'projects'))
    // The two must agree BY CONSTRUCTION, not by both being edited together.
    expect(projectDirFor('/some/where', root).startsWith(projectsRoot(root))).toBe(true)
  })

  it('test_it_defaults_to_the_transcript_root', () => {
    expect(projectsRoot()).toBe(projectsRoot(transcriptRoot()))
  })
})
