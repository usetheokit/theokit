/**
 * T2.2 — the registry half of session deletion becomes reachable.
 *
 * ## The defect, stated precisely
 *
 * `deleteSession` accepts a `removeFromRegistry` and REFUSES a thenable
 * (`session-lifecycle.ts:235-238`, commit `b023cef8`). That refusal was correct when it landed: the
 * old code read `registryRemoved: remover(id) ?? false`, and a Promise is truthy, so it reported a
 * removal that had not happened yet — a silent success, the worst shape.
 *
 * But the only agent registry in the ecosystem is `Agent.delete(id): Promise<void>`. The file's own
 * comment says it: *"Every real caller has an async remover, so the seam could not be satisfied
 * honestly by anyone who tried."* A correct fix for a silent-success bug hardened the seam against
 * the only implementation that can satisfy it, and `runTranscriptGC` has no remover at all — it
 * deletes transcripts and leaves the registry pointing at files that no longer exist.
 *
 * The fix is not to relax the refusal. It is to AWAIT: the reason the old code was wrong was that it
 * checked truthiness instead of completion, and awaiting is what completion looks like.
 *
 * ## Invariants asserted here
 *
 *  - Registry FIRST, unlink second (EC-3). A registry failure must leave the transcript ON DISK: an
 *    orphan file is collected by the next sweep, while an entry pointing at a deleted transcript is
 *    repaired by nothing, because GC works from transcripts.
 *  - The two outcomes are reported SEPARATELY. Collapsing them into one boolean is how the original
 *    bug hid.
 *  - A remover that never settles is bounded, and the result it produces is never mutated by a late
 *    settle (EC-8).
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { deleteSession } from '../../src/session/session-lifecycle.js'

/** A transcript on disk at the layout `deleteSession` expects, so nothing here is mocked. */
function seedSession(id: string): { cwd: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'gc-remover-'))
  const cwd = mkdtempSync(join(tmpdir(), 'gc-project-'))
  const dir = join(root, 'projects', cwd.replace(/[/\\]/g, '-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.jsonl`), '{"type":"user"}\n')
  return { cwd, root }
}

describe('deleteSession — the registry seam accepts what the ecosystem actually has', () => {
  it('test_async_remover_is_awaited_not_refused', async () => {
    const { cwd, root } = seedSession('s1')
    const calls: string[] = []
    // Exactly the shape of `Agent.delete(id): Promise<void>` — the only registry there is.
    const result = await deleteSession('s1', {
      cwd,
      root,
      force: true,
      removeFromRegistry: async (id) => {
        calls.push(id)
        await Promise.resolve()
      },
    })
    expect(calls).toEqual(['s1'])
    expect(result.registryRemoved, 'an awaited removal is a completed removal').toBe(true)
  })

  it('test_sync_remover_still_works', async () => {
    const { cwd, root } = seedSession('s2')
    const result = await deleteSession('s2', {
      cwd,
      root,
      force: true,
      removeFromRegistry: () => true,
    })
    expect(result.registryRemoved).toBe(true)
    expect(result.transcriptRemoved).toBe(true)
  })

  it('test_registry_removed_before_the_file_is_unlinked', async () => {
    // EC-3. A failing remover must leave the transcript on disk: recoverable beats unrepairable.
    const { cwd, root } = seedSession('s3')
    const transcript = join(root, 'projects', cwd.replace(/[/\\]/g, '-'), 's3.jsonl')
    const result = await deleteSession('s3', {
      cwd,
      root,
      force: true,
      removeFromRegistry: () => {
        throw new Error('registry unavailable')
      },
    })
    expect(result.registryRemoved).toBe(false)
    expect(result.registryError, 'the failure is reported, not swallowed').toBeDefined()
    expect(
      existsSync(transcript),
      'the transcript must survive a registry failure — otherwise the entry points at nothing and ' +
        'no later GC run can repair it, because GC works from transcripts',
    ).toBe(true)
    expect(result.transcriptRemoved).toBe(false)
  })

  it('test_registry_failure_is_reported_separately_from_file_deletion', async () => {
    const { cwd, root } = seedSession('s4')
    const result = await deleteSession('s4', {
      cwd,
      root,
      force: true,
      removeFromRegistry: async () => {
        await Promise.resolve()
        throw new Error('rejected')
      },
    })
    // Two distinct fields. One collapsed boolean is how the original silent success hid.
    expect(result.registryRemoved).toBe(false)
    expect(result.transcriptRemoved).toBe(false)
    expect(String(result.registryError)).toContain('rejected')
  })

  it('test_remover_that_never_settles_times_out_with_a_typed_error', async () => {
    const { cwd, root } = seedSession('s5')
    const result = await deleteSession('s5', {
      cwd,
      root,
      force: true,
      registryTimeoutMs: 25,
      removeFromRegistry: () => new Promise<void>(() => {}), // never settles
    })
    expect(result.registryRemoved).toBe(false)
    expect(String(result.registryError)).toMatch(/timed out|timeout/i)
  })

  it('test_remover_that_settles_after_the_timeout_does_not_mutate_the_returned_result', async () => {
    // EC-8. Reporting "not removed" when it later succeeded is wrong in the SAFE direction and is
    // accepted. What is not acceptable is the late settle reaching back into a returned result.
    const { cwd, root } = seedSession('s6')
    let settle!: () => void
    const result = await deleteSession('s6', {
      cwd,
      root,
      force: true,
      registryTimeoutMs: 20,
      removeFromRegistry: () =>
        new Promise<void>((resolve) => {
          settle = resolve
        }),
    })
    expect(result.registryRemoved).toBe(false)
    settle()
    await new Promise((r) => setTimeout(r, 40))
    expect(result.registryRemoved, 'a settled-too-late remover must not rewrite history').toBe(
      false,
    )
  })

  it('test_no_remover_supplied_still_deletes_the_transcript', async () => {
    const { cwd, root } = seedSession('s7')
    const result = await deleteSession('s7', { cwd, root, force: true })
    expect(result.registryRemoved).toBe(false)
    expect(result.transcriptRemoved).toBe(true)
  })
})
