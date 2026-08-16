/**
 * The GC sweep against a real transcript tree, with a registry that does not answer.
 *
 * The unit tests pin the rule with a hand-built plan. This runs the whole path — plan the sweep from
 * what is on disk, then apply it — because the failure this closes only appears at that scale: a
 * remover that never settles hung `runTranscriptGC` indefinitely, and what hangs is not one session
 * but every session after it, with no error, no timeout and no output. A sweep is the thing that runs
 * unattended over a whole project, which is exactly why it was the wrong half to leave unbounded.
 *
 * Asserted here rather than only in a unit test because the bound has to survive the real planner's
 * protection rules — the most recent transcript is always kept, so a fixture that forgets a second
 * session tests nothing while appearing to pass.
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  awaitRegistryRemoval,
  SessionRegistryRemoverError,
} from '../../packages/agents/src/session/gc/registry-remover.js'
import {
  planTranscriptGC,
  runTranscriptGC,
} from '../../packages/agents/src/session/gc/transcript-gc.js'

/** A project with several transcripts, all but the newest aged well past any retention window. */
function agedProject(count: number): { cwd: string; root: string; dir: string } {
  const root = mkdtempSync(join(tmpdir(), 'gc-int-root-'))
  const cwd = mkdtempSync(join(tmpdir(), 'gc-int-cwd-'))
  const dir = join(root, 'projects', cwd.replace(/[/\\]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const old = new Date(Date.now() - 400 * 86_400_000)
  for (let i = 0; i < count; i += 1) {
    const file = join(dir, `s${String(i)}.jsonl`)
    writeFileSync(file, '{"type":"user"}\n')
    if (i < count - 1) utimesSync(file, old, old)
  }
  return { cwd, root, dir }
}

describe('runTranscriptGC over a real tree', () => {
  it('test_a_registry_that_never_answers_does_not_hang_the_sweep', async () => {
    const { cwd, root, dir } = agedProject(4)
    const plan = planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 1 })
    expect(
      plan.candidates.length,
      'the fixture must give the sweep something to do',
    ).toBeGreaterThan(0)

    const started = Date.now()
    const result = await runTranscriptGC(plan, {
      apply: true,
      registryTimeoutMs: 20,
      removeFromRegistry: () => new Promise<void>(() => {}), // never settles
    })
    const elapsed = Date.now() - started

    expect(
      elapsed,
      'unbounded, this returned never; the assertion is that it returns at all, promptly',
    ).toBeLessThan(5_000)
    expect(result.errors.length).toBe(plan.candidates.length)
    expect(result.removed, 'nothing may be deleted when the registry never confirmed').toEqual([])
    expect(
      readdirSync(dir).length,
      'every transcript survives — an orphan file is collected next sweep, an orphan entry by nothing',
    ).toBe(4)
  })

  it('test_a_working_registry_still_collects_and_leaves_the_newest', async () => {
    // The other direction, so the bound cannot be satisfied by refusing to do anything.
    const { cwd, root, dir } = agedProject(4)
    const plan = planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 1 })
    const removedFromRegistry: string[] = []

    const result = await runTranscriptGC(plan, {
      apply: true,
      registryTimeoutMs: 1_000,
      removeFromRegistry: async (id) => {
        removedFromRegistry.push(id)
        await Promise.resolve()
      },
    })

    expect(result.errors).toEqual([])
    // Copies sorted in their own statements: the lint objects to sorting in place inside an
    // expression, and `toSorted` is past this project's lib target.
    const seenSorted = [...removedFromRegistry].sort((a, b) => a.localeCompare(b))
    const removedSorted = [...result.removed].sort((a, b) => a.localeCompare(b))
    expect(seenSorted).toEqual(removedSorted)
    expect(readdirSync(dir).length).toBe(4 - result.removed.length)
    expect(
      existsSync(join(dir, 's3.jsonl')),
      'the newest is what `--continue` would find and must survive',
    ).toBe(true)
  })

  it('test_the_error_the_sweep_reports_is_the_shared_typed_one', async () => {
    // The point of extracting `awaitRegistryRemoval` was ONE rule for both callers. Asserting that
    // the sweep's error is the shared class — not a lookalike built locally — is what makes that
    // claim checkable; two call sites each throwing their own Error is how the divergence started.
    const direct = await awaitRegistryRemoval(new Promise<void>(() => {}), 'sX', 15).catch(
      (e: unknown) => e,
    )
    expect(direct).toBeInstanceOf(SessionRegistryRemoverError)
    expect((direct as SessionRegistryRemoverError).sessionId).toBe('sX')

    const { cwd, root } = agedProject(3)
    const plan = planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 1 })
    const result = await runTranscriptGC(plan, {
      apply: true,
      registryTimeoutMs: 15,
      removeFromRegistry: () => new Promise<void>(() => {}),
    })
    expect(result.errors[0]?.message).toContain('timed out')
  })

  it('test_no_timeout_configured_keeps_the_previous_behaviour', async () => {
    // The bound is opt-in. A caller that never passed `registryTimeoutMs` must get exactly what it
    // had, or adding the option would be a behaviour change wearing a bug fix's clothes.
    const { cwd, root } = agedProject(3)
    const plan = planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 1 })
    const result = await runTranscriptGC(plan, {
      apply: true,
      removeFromRegistry: () => undefined,
    })
    expect(result.errors).toEqual([])
    expect(result.removed.length).toBe(plan.candidates.length)
  })
})
