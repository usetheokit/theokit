/**
 * The APPLY phase of the all-projects sweep — the half that deletes.
 *
 * Split from `all-sessions.ts` when that file hit this repository's 400-line gate. The seam is not
 * arbitrary: an audit of this module found that every one of the seven test files importing it
 * imported the PLAN phase only, and that the `deleteAgent` arm below was entered by nothing — which
 * is how two data-losing defects sat inside it at 78.78% coverage. Making the boundary a module
 * boundary means "which phase does this test drive?" is answered by the import line.
 *
 * Nothing here decides WHAT to collect. It receives a plan and carries it out, re-checking at the
 * last moment the two things that can change between the two phases: a live writer appearing, and
 * the resumable pointer moving.
 */
import { basename } from 'node:path'

import { transcriptPath, transcriptRoot } from '@theokit/agents/persistence'

import {
  LOCK_SUFFIX,
  transcriptId,
  assertNeverKind,
  type AllCandidate,
  type AllPlan,
  type AllResult,
  type ApplyAllOptions,
} from './all-sessions.js'
import { removeTolerant } from './remove-tolerant.js'

function backstopRefusal(
  c: AllCandidate,
  livePointers: ReadonlySet<string>,
  opts: ApplyAllOptions,
): string | undefined {
  if (c.id !== undefined && livePointers.has(c.id)) {
    return `${c.target}: refused — the live-session pointer changed between plan and apply`
  }
  // B-003 — transcripts are re-checked here too. The early return used to drop everything that was
  // not a lock, so a transcript that gained a writer between plan and apply was deleted anyway.
  if (c.kind === 'transcript') {
    return opts.hasLiveWriter(c.target)
      ? `${c.target}: refused — the transcript gained a live writer between plan and apply`
      : undefined
  }
  if (c.kind !== 'lock-file' && c.kind !== 'lock-directory') return undefined
  const transcript = c.target.replace(LOCK_SUFFIX, '.jsonl')
  return opts.hasLiveWriter(transcript)
    ? `${c.target}: refused — the sibling transcript gained a live writer between plan and apply`
    : undefined
}

async function removeCandidate(c: AllCandidate, opts: ApplyAllOptions): Promise<void> {
  switch (c.kind) {
    case 'transcript':
      // B-021 — `deleteAgent` takes the SESSION id. It used to be handed `c.id`, the transcript
      // NAME, which `Agent.delete` does not recognise: it no-ops on an unknown id and never touches
      // the `.jsonl`, so the sweep removed nothing while `removed` reported the file gone — on every
      // run, forever. Measured by driving the real sweeper.
      if (c.inRegistry === true && c.agentId !== undefined) await opts.deleteAgent(c.agentId)
      else await opts.unlink(c.target)
      return
    case 'registry':
      await opts.deleteAgent(c.target)
      return
    case 'lock-file':
    case 'tmp':
      await opts.unlink(c.target)
      return
    case 'lock-directory':
      await opts.rmdir(c.target)
      return
    default:
      assertNeverKind(c.kind)
  }
}

export async function runSessionGCAllProjects(
  plan: AllPlan,
  opts: ApplyAllOptions,
): Promise<AllResult> {
  if (opts.apply !== true) {
    return { dryRun: true, removed: plan.candidates.map((c) => c.target), errors: [] }
  }
  const removed: string[] = []
  const errors: string[] = []

  // B-021 — BOTH names, for the same reason `resolveGuards` adds both: this set is asked with
  // `c.id`, a transcript NAME, while `readPointer` returns a session id. Holding only the id made
  // the TOCTOU backstop match nothing, so its refusal list was empty and a session that became live
  // between plan and apply had its transcript unlinked. Measured by driving the real sweeper.
  const livePointers = new Set<string>()
  for (const cwd of new Set(plan.liveCwds)) {
    const pointer = opts.readPointer(cwd)
    if (pointer === undefined) continue
    livePointers.add(pointer)
    livePointers.add(transcriptId(basename(transcriptPath(transcriptRoot(), cwd, pointer))))
  }

  for (const c of plan.candidates) {
    const refusal = backstopRefusal(c, livePointers, opts)
    if (refusal !== undefined) {
      errors.push(refusal)
      continue
    }
    await removeTolerant(c.target, () => removeCandidate(c, opts), removed, errors)
  }

  await removeEmptyProjects(plan, opts, removed, errors)

  return { dryRun: false, removed, errors }
}

async function removeEmptyProjects(
  plan: AllPlan,
  opts: ApplyAllOptions,
  removed: string[],
  errors: string[],
): Promise<void> {
  const list = opts.listProject
  if (list === undefined) return
  for (const dir of plan.touchedProjects) {
    const project = dir.slice(dir.lastIndexOf('/') + 1)
    try {
      if (list(project).length === 0) {
        await opts.rmdir(dir)
        removed.push(dir)
      }
    } catch (err) {
      errors.push(`${dir}: ${(err as Error).message}`)
    }
  }
}

