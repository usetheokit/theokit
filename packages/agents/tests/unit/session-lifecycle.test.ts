import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { acquireSessionWriter, transcriptPath, transcriptRoot } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  SessionInUseError,
  deleteSession,
  listSessions,
  protectedTranscriptPaths,
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
 * Recency ordering is real behaviour here — `protectedTranscriptPaths` keeps the most recent — so two
 * files written in the same millisecond would make the outcome depend on filesystem timestamp
 * resolution. `ageSeconds` says which is older, out loud. (The first draft of this file relied on
 * write order and the guard correctly refused to delete what the fixture had accidentally made the
 * newest file.)
 */
function writeTranscriptFile(sessionId: string, ageSeconds = 0, contents?: string): string {
  const path = transcriptPath(root, CWD, sessionId)
  mkdirSync(projectDirFor(CWD, root), { recursive: true })
  // The record carries `sessionId`, because a real transcript does and because SDK 5.x names the
  // FILE with a one-way hash of that id — so the content is the only place the id survives
  // (usetheokit/theokit#654). An empty fixture encoded the old "filename is the id" assumption
  // without saying so, and passed only while that assumption held.
  writeFileSync(path, contents ?? `${JSON.stringify({ type: 'user', sessionId })}\n`, 'utf8')
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
  it('test_an_absent_project_directory_lists_nothing_rather_than_throwing', async () => {
    // The first run of any project hits this. Throwing would make "no sessions yet" an error state.
    expect(await listSessions(CWD, root)).toEqual([])
  })

  it('test_it_lists_transcripts_most_recent_first', async () => {
    writeTranscriptFile('older', 60)
    writeTranscriptFile('newer', 0)
    const ids = (await listSessions(CWD, root)).map((s) => s.id)
    expect(ids).toEqual(['newer', 'older'])
  })

  it('test_it_ignores_entries_that_are_not_transcripts', async () => {
    // Anti-vacuity AND the reason `classifySessionArtifact` is used instead of a local matcher: a
    // project directory holds four kinds of file, and a lifecycle op that treated a lock as a
    // session would offer to delete the lock.
    writeTranscriptFile('real')
    writeFileSync(join(projectDirFor(CWD, root), 'not-ours.txt'), 'x', 'utf8')
    expect((await listSessions(CWD, root)).map((s) => s.id)).toEqual(['real'])
  })

  it('test_an_id_in_the_second_record_is_found', async () => {
    writeTranscriptFile('x', 0, 'not json\n{"sessionId":"s2","type":"user"}\n')
    const [entry] = await listSessions(CWD, root)
    expect(entry.id).toBe('s2')
    expect(entry.idSource).toBe('transcript')
  })

  it('test_a_directory_named_like_a_transcript_is_not_listed', async () => {
    writeTranscriptFile('real')
    mkdirSync(join(projectDirFor(CWD, root), 'x.jsonl'), { recursive: true })
    const names = (await listSessions(CWD, root)).map((s) => s.transcript)
    expect(names.some((n) => n.endsWith('x.jsonl'))).toBe(false)
    expect(names).toHaveLength(1)
  })
})

describe('deleteSession — the two stores are reported separately', () => {
  it('test_it_reports_registry_and_transcript_independently', async () => {
    // The asymmetry that made the gap a trap: `Agent.delete` clears the REGISTRY ENTRY and never
    // touches the file. A single boolean would rebuild exactly that confusion.
    writeTranscriptFile('doomed', 60) // a minute older, so it is not the most recent
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)

    const result = await deleteSession('doomed', { cwd: CWD, root, removeFromRegistry: () => true })
    expect(result).toEqual({ registryOutcome: 'removed', transcriptRemoved: true })
    expect(existsSync(transcriptPath(root, CWD, 'doomed'))).toBe(false)
  })

  it('test_an_async_registry_remover_is_awaited_rather_than_refused', async () => {
    // REPLACES `test_an_async_registry_remover_is_refused_instead_of_reported_as_done` (T2.2).
    //
    // The refusal it asserted was the right fix for the wrong shape. The original bug was
    // `registryRemoved: remover(id) ?? false` — a Promise is truthy, so a removal was reported
    // before it happened, and a rejection became an unhandled rejection nobody saw. Refusing the
    // thenable stopped the lie. But the SDK's `Agent.delete` returns `Promise<void>` and is the
    // ONLY agent registry in the ecosystem, so the refusal left the seam satisfiable by nobody:
    // this file's own comment said "every real caller has an async remover".
    //
    // Truthiness was the defect, not asynchrony. Awaiting is what "it happened" actually looks
    // like, so the seam awaits and the honest report survives.
    writeTranscriptFile('doomed', 60)
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)

    const result = await deleteSession('doomed', {
      cwd: CWD,
      root,
      removeFromRegistry: async (id) => {
        expect(id).toBe('doomed')
        await Promise.resolve()
      },
    })

    // CHANGED by usetheokit/theokit#675, and worth saying why rather than quietly editing it.
    //
    // This asserted `registryRemoved === true` under the reasoning "an awaited removal is a
    // completed removal", and that reasoning is the defect. The remover above is a void async
    // function: it resolves saying NOTHING. Awaiting fixed the earlier bug — a Promise read as
    // truthy before it settled — but completion is not confirmation, and the two were conflated.
    //
    // That distinction is not academic here: this is the exact shape `Agent.delete` has, and below
    // `@theokit/sdk@5.3.1` it resolves `void` having left `registry.json` untouched.
    expect(result.registryOutcome, 'a remover that says nothing has confirmed nothing').toBe(
      'unconfirmed',
    )
    expect(result.transcriptRemoved).toBe(true)
    expect(existsSync(transcriptPath(root, CWD, 'doomed'))).toBe(false)
  })

  it('test_without_a_registry_remover_only_the_transcript_goes', async () => {
    // And it SAYS so, distinctly (#675). `not-attempted` is not the "caller forgot" case it might
    // look like — it is the DELIBERATE path of the only real consumer this function has today.
    //
    // Measured in TheoCode on 2026-09-08: it calls `Agent.delete` itself, then invokes this function
    // WITHOUT `removeFromRegistry`, because it wants only the transcript half. The old boolean told
    // it `false`, which reads as "we tried and failed" when nobody tried — and the same consumer had
    // already stopped reading the field for exactly that reason.
    //
    // So the third value earns its place: `unconfirmed` would claim a remover ran and stayed quiet.
    writeTranscriptFile('doomed', 60)
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)

    expect(await deleteSession('doomed', { cwd: CWD, root })).toEqual({
      registryOutcome: 'not-attempted',
      transcriptRemoved: true,
    })
  })

  it('test_deleting_something_already_gone_is_not_a_failure', async () => {
    // Absent is the desired end state, so a missing file reports `false`, never throws.
    writeTranscriptFile('keeper', 0)
    writeTranscriptFile('other', 60)
    await persistSessionId(CWD, 'keeper', root)
    expect((await deleteSession('never-existed', { cwd: CWD, root })).transcriptRemoved).toBe(false)
  })
})

describe('protectedTranscriptPaths — three reasons, kept distinct', () => {
  it('test_the_pointer_target_is_protected_and_says_why', async () => {
    writeTranscriptFile('pointed', 60)
    writeTranscriptFile('other', 0)
    await persistSessionId(CWD, 'pointed', root)
    // Keyed by transcript path since #668, so an unreadable transcript can still be matched. What
    // this test asserts is unchanged: the pointer's target is protected, and the reason says why.
    expect(
      (await protectedTranscriptPaths(CWD, root)).get(transcriptPath(root, CWD, 'pointed')),
    ).toMatch(/pointer/i)
  })

  it('test_the_most_recent_is_protected_even_without_a_pointer', async () => {
    // A GC that leaves a project with nothing to `--continue` destroyed the feature it protected.
    writeTranscriptFile('only')
    expect(
      (await protectedTranscriptPaths(CWD, root)).get(transcriptPath(root, CWD, 'only')),
    ).toMatch(/most recent/i)
  })

  it('test_the_reasons_are_not_collapsed_into_a_boolean', async () => {
    // "Skipped 4 sessions" is far less useful than why each was skipped, and retention is exactly
    // where an operator asks.
    writeTranscriptFile('a')
    const reasons = [...(await protectedTranscriptPaths(CWD, root)).values()]
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
      await expect(deleteSession('live', { cwd: CWD, root })).rejects.toThrow(SessionInUseError)
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })

  it('test_the_refusal_names_the_session_and_the_reason', async () => {
    const path = writeTranscriptFile('live', 60)
    writeTranscriptFile('other', 0)
    const lease = await acquireSessionWriter(path)
    try {
      await deleteSession('live', { cwd: CWD, root })
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
    expect(
      (await deleteSession('pointed', { cwd: CWD, root, force: true })).transcriptRemoved,
    ).toBe(true)
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

/**
 * The protection check and the unlink are separated by an `await`, and nothing re-reads the check.
 *
 * `deleteSession` reads `protectedTranscriptPaths` at the top, then hands control to the caller's
 * registry remover — for up to `registryTimeoutMs` (30s by default, and `Infinity` is accepted) —
 * and only then unlinks. Every conclusion drawn before that await is a SNAPSHOT, and a user who
 * resumes the session during it makes the snapshot false. The file is deleted anyway and
 * `SessionInUseError` never fires, which is the outcome the error exists to prevent.
 *
 * The sibling sweep already knows this. `transcript-gc.ts` states it as invariant 4 — *"The apply
 * phase re-checks. A plan is a snapshot, and between snapshot and delete a user can resume a
 * session. A collector that trusts its own plan deletes the session someone just returned to."* The
 * single-session path skipped the discipline the batch path treats as non-negotiable, and it is the
 * path with no sweep behind it to catch the mistake later.
 */
describe('deleteSession — a snapshot taken before an await is not a fact after it', () => {
  /**
   * `doomed` must NOT be protected when the function starts, or the pre-check refuses and the test
   * proves nothing about the window it exists to cover. `protectedTranscriptPaths` keeps the most
   * recent, so a second, newer transcript is what makes `doomed` deletable at t=0 — the same fixture
   * shape the lease tests above use, and for the same reason.
   */
  function arrangeDeletableSession(): {
    path: string
    resume: () => Promise<{ release: () => void }>
  } {
    const path = writeTranscriptFile('doomed', 60)
    writeTranscriptFile('other', 0)
    return { path, resume: () => acquireSessionWriter(path) }
  }

  it('test_a_session_protected_during_the_registry_await_is_not_deleted', async () => {
    const { path, resume } = arrangeDeletableSession()
    let lease: { release: () => void } | undefined

    // The remover is where real time passes. Taking the writer lease HERE is the user resuming the
    // session mid-flight — the race, made deterministic instead of hoped for.
    const removeFromRegistry = async () => {
      lease = await resume()
      return true
    }

    await expect(
      deleteSession('doomed', { cwd: CWD, root, removeFromRegistry }),
    ).rejects.toBeInstanceOf(SessionInUseError)

    expect(existsSync(path), 'the transcript of a live session must survive').toBe(true)
    lease?.release()
  })

  it('test_the_refusal_says_the_registry_half_already_happened', async () => {
    // Refusing after the registry removal leaves an orphan FILE, which the next sweep collects —
    // the recoverable direction the module already chose in its ordering comment. But the caller has
    // to be TOLD, or it retries a registry removal that is already done and reads the second `false`
    // as a failure.
    const { resume } = arrangeDeletableSession()
    let lease: { release: () => void } | undefined
    const removeFromRegistry = async () => {
      lease = await resume()
      return true
    }

    let caught: unknown
    try {
      await deleteSession('doomed', { cwd: CWD, root, removeFromRegistry })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(SessionInUseError)
    // This remover RETURNS `true`, so the refusal may make the strong claim (#675). A remover that
    // said nothing would carry 'unconfirmed' instead, and the message tells the caller to verify
    // rather than to skip the retry.
    expect((caught as SessionInUseError).registryOutcome).toBe('removed')
    lease?.release()
  })

  it('test_a_session_that_stays_free_is_still_deleted', async () => {
    // Anti-vacuity floor: a re-check that always refused would satisfy both cases above.
    const { path } = arrangeDeletableSession()

    const result = await deleteSession('doomed', {
      cwd: CWD,
      root,
      removeFromRegistry: async () => true,
    })

    expect(result.transcriptRemoved).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  it('test_force_still_deletes_a_session_that_became_protected', async () => {
    // `force` means "I know, delete it anyway". A re-check that ignored it would turn an escape
    // hatch into a wall.
    const { path, resume } = arrangeDeletableSession()
    let lease: { release: () => void } | undefined

    const result = await deleteSession('doomed', {
      cwd: CWD,
      root,
      force: true,
      removeFromRegistry: async () => {
        lease = await resume()
        return true
      },
    })

    expect(result.transcriptRemoved).toBe(true)
    expect(existsSync(path)).toBe(false)
    lease?.release()
  })
})

describe('deleteSession with a verifier', () => {
  const verifierFrom = (answers: boolean[]) => {
    const calls: string[] = []
    return {
      calls,
      isListedInRegistry: async (id: string) => {
        calls.push(id)
        return answers[Math.min(calls.length - 1, answers.length - 1)] as boolean
      },
    }
  }

  it('deleteSession with a verifier reports removed when the id leaves the listing', async () => {
    writeTranscriptFile('doomed', 60)
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)
    const v = verifierFrom([true, false])
    const result = await deleteSession('doomed', {
      cwd: CWD,
      root,
      removeFromRegistry: async () => undefined,
      isListedInRegistry: v.isListedInRegistry,
    })
    expect(result.registryOutcome).toBe('removed')
    expect(result.transcriptRemoved).toBe(true)
    expect(v.calls).toEqual(['doomed', 'doomed'])
  })

  it('deleteSession with a verifier reports still-present when the remover removes nothing', async () => {
    writeTranscriptFile('doomed', 60)
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)
    const v = verifierFrom([true])
    const result = await deleteSession('doomed', {
      cwd: CWD,
      root,
      removeFromRegistry: async () => undefined,
      isListedInRegistry: v.isListedInRegistry,
    })
    expect(result.registryOutcome).toBe('still-present')
  })

  it('deleteSession with a verifier reports nothing-to-remove for an id that was never listed', async () => {
    const v = verifierFrom([false])
    const result = await deleteSession('ghost', {
      cwd: CWD,
      root,
      removeFromRegistry: async () => undefined,
      isListedInRegistry: v.isListedInRegistry,
    })
    expect(result.registryOutcome).toBe('nothing-to-remove')
  })

  it('a verifier that throws gives unconfirmed and keeps the error in registryError', async () => {
    writeTranscriptFile('doomed', 60)
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)
    const boom = new Error('list failed')
    const result = await deleteSession('doomed', {
      cwd: CWD,
      root,
      removeFromRegistry: async () => undefined,
      isListedInRegistry: async () => {
        throw boom
      },
    })
    expect(result.registryOutcome).toBe('unconfirmed')
    expect(result.registryError).toBe(boom)
    expect(result.transcriptRemoved).toBe(true)
  })

  it('a verifier that exceeds registryTimeoutMs gives unconfirmed', async () => {
    const result = await deleteSession('ghost', {
      cwd: CWD,
      root,
      registryTimeoutMs: 10,
      removeFromRegistry: async () => undefined,
      isListedInRegistry: () => new Promise<boolean>(() => undefined),
    })
    expect(result.registryOutcome).toBe('unconfirmed')
    expect(result.registryError).toBeInstanceOf(Error)
  })

  it('reads before the remover and after it, in that order', async () => {
    writeTranscriptFile('doomed', 60)
    writeTranscriptFile('keeper', 0)
    await persistSessionId(CWD, 'keeper', root)
    const log: string[] = []
    let listed = true
    await deleteSession('doomed', {
      cwd: CWD,
      root,
      removeFromRegistry: async () => {
        log.push('remove')
        listed = false
      },
      isListedInRegistry: async () => {
        log.push(`read:${String(listed)}`)
        return listed
      },
    })
    expect(log).toEqual(['read:true', 'remove', 'read:false'])
  })

  it('a session protected during the after-read is not deleted', async () => {
    const path = writeTranscriptFile('doomed', 60)
    writeTranscriptFile('other', 0)
    let lease: { release: () => void } | undefined
    let reads = 0
    await expect(
      deleteSession('doomed', {
        cwd: CWD,
        root,
        removeFromRegistry: async () => undefined,
        isListedInRegistry: async () => {
          reads += 1
          if (reads === 2) lease = await acquireSessionWriter(path)
          return false
        },
      }),
    ).rejects.toBeInstanceOf(SessionInUseError)
    expect(existsSync(path)).toBe(true)
    lease?.release()
  })

  it('does not call the verifier without a remover', async () => {
    const v = verifierFrom([true])
    const result = await deleteSession('ghost', {
      cwd: CWD,
      root,
      isListedInRegistry: v.isListedInRegistry,
    })
    expect(result.registryOutcome).toBe('not-attempted')
    expect(v.calls).toEqual([])
  })
})
