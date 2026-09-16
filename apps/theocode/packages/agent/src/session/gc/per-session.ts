import { existsSync, readdirSync, statSync, promises as fsp } from 'node:fs'
import { basename, join } from 'node:path'

import { Agent } from '@theokit/agents'
import { encodeProjectDir, transcriptPath, transcriptRoot } from '@theokit/agents/persistence'

import { listAgents } from '../agent-list.js'
import { assertCollectionFloor } from './collection-window.js'
import { readPointerId } from './pointer.js'
import { removeTolerant } from './remove-tolerant.js'

const defaultBaseDir = transcriptRoot

function transcriptDir(cwd: string, baseDir: string = defaultBaseDir()): string {
  return join(baseDir, 'projects', encodeProjectDir(cwd))
}

interface SessionGCCandidate {
  /** The TRANSCRIPT name (the `.jsonl` stem). What `unlink` takes. */
  id: string
  ageDays: number
  inRegistry: boolean
  /**
   * #102 — the SESSION id this transcript was matched from, when the registry knows it.
   *
   * `Agent.delete` takes a session id and was being handed `id`, which is the transcript name, so
   * the registry entry outlived a deletion that reported success. The match already computes this
   * value; it was thrown away one line later. Absent when no registry entry matched, which is the
   * `unlink` path and needs no session id.
   */
  agentId?: string
}

export interface SessionGCPlan {
  candidates: SessionGCCandidate[]
  kept: string[]
  pointer?: string
  mostRecent?: string
  total: number
}

interface RegistryEntry {
  agentId: string
  archived?: boolean
}

export interface PlanSessionGCOptions {
  cwd?: string
  baseDir?: string
  now?: () => number
  keepLast?: number
  maxAgeDays?: number
  list?: (cwd: string) => Promise<RegistryEntry[]>
  readPointer?: (cwd: string) => string | undefined
  readdir?: (dir: string) => { id: string; mtimeMs: number }[]
}

/** Transcripts in a project directory, newest first is the caller's job to sort. Sync by design:
 *  the fork guard runs on a synchronous write path. */
function readTranscriptDir(dir: string): { id: string; mtimeMs: number }[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ id: f.slice(0, -6), mtimeMs: statSync(join(dir, f)).mtimeMs }))
}

function realReadPointer(cwd: string): string | undefined {
  return readPointerId(cwd)
}

function resolvePlanOptions(opts: PlanSessionGCOptions) {
  const cwd = opts.cwd ?? process.cwd()
  return {
    cwd,
    baseDir: opts.baseDir ?? defaultBaseDir(),
    now: opts.now ?? Date.now,
    keepLast: opts.keepLast ?? 10,
    maxAgeDays: opts.maxAgeDays ?? 30,
    listFn: opts.list ?? defaultList,
    readdir: opts.readdir ?? readTranscriptDir,
    readPointer: opts.readPointer ?? realReadPointer,
  }
}

/**
 * #102 — the candidate carries the SESSION id it was matched from, so the deletion can address the
 * registry in the registry's vocabulary. `find`, not `some`: discarding the match is what made
 * `Agent.delete` receive a transcript name.
 */
function candidateFor(
  id: string,
  ageDays: number,
  registryAll: ReadonlySet<string>,
  namesOf: (session: string) => string[],
): SessionGCCandidate {
  const agentId = [...registryAll].find((a) => namesOf(a).includes(id))
  return {
    id,
    ageDays,
    inRegistry: agentId !== undefined,
    ...(agentId !== undefined ? { agentId } : {}),
  }
}

/** #106 — only an EXPLICIT `unavailable` counts; an absent field is not doubt. See the call site. */
function unreadable(entry: { id: string; mtimeMs: number }): boolean {
  // `readdir` is typed for this repository's own seam, which has no `idSource`. A caller that hands
  // in `listSessions` output carries one, so the field is read defensively rather than declared —
  // widening the seam's type would make every existing caller look as though it supplied something
  // it does not.
  return (entry as { idSource?: unknown }).idSource === 'unavailable'
}

export async function planSessionGC(opts: PlanSessionGCOptions = {}): Promise<SessionGCPlan> {
  const { cwd, baseDir, now, keepLast, maxAgeDays, listFn, readdir, readPointer } =
    resolvePlanOptions(opts)

  assertCollectionFloor(maxAgeDays)

  const onDisk = readdir(transcriptDir(cwd, baseDir)).sort(
    (a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id),
  )
  const listed = await listFn(cwd)
  const registryAll = new Set(listed.map((e) => e.agentId))  // session ids; mapped where compared

  const pointer = readPointer(cwd)
  const mostRecent = onDisk[0]?.id
  // A SESSION ID and a TRANSCRIPT NAME are different strings, and this set held both while the lookup
  // below asks with a name. Measured: a registry entry `tui-838055f5-…` names a file called
  // `80a43d49-….jsonl`. So registry entries and the pointer contributed values nothing could ever ask
  // for, and only `keepLast` and most-recent — filename-derived on both sides — protected anything.
  // The same mismatch made `inRegistry` permanently false, which is why every session read as an
  // orphan: a report that looked like an explanation and was an artefact of the comparison.
  //
  // One namespace, using the SDK's forward mapping. The inverse cannot exist over a hash
  // (usetheokit/theokit-sdk#577) and is not wanted: every id here is already in hand.
  const transcriptIdOf = (session: string): string =>
    basename(transcriptPath(transcriptRoot(), cwd, session)).replace(/\.jsonl$/, '')
  /**
   * #102 — BOTH names a session id can appear under on disk.
   *
   * 5.x names a transcript `sessionUuidFor(id).jsonl`, a hash. 4.x named it after the id itself,
   * which is why the SDK still exports `legacyTranscriptPath`, and an upgraded machine has both
   * conventions side by side. `ca3db5c` replaced the raw id with the mapped one and so stopped
   * protecting every legacy-named transcript of a live registered session — trading one deletion
   * bug for another. Caught by `resume-protection.test.ts`, whose fixture is a 4.x transcript.
   *
   * Adding both is the safe direction: a name that matches nothing merely keeps a file, while a
   * name that is missing deletes one, and `unlink` here has no restore.
   */
  const namesOf = (session: string): string[] => [transcriptIdOf(session), session]
  const protectedIds = new Set<string>([
    ...listed.filter((e) => e.archived !== true).flatMap((e) => namesOf(e.agentId)),
    ...onDisk.slice(0, keepLast).map((x) => x.id),
  ])
  if (pointer !== undefined) for (const n of namesOf(pointer)) protectedIds.add(n)
  if (mostRecent !== undefined) protectedIds.add(mostRecent)

  const candidates: SessionGCCandidate[] = []
  const kept: string[] = []
  for (const entry of onDisk) {
    const { id, mtimeMs } = entry
    const ageDays = (now() - mtimeMs) / 86_400_000
    // #106 — "I could not read this" is not "this belongs to nobody", and only the second justifies
    // deletion. `@theokit/sdk@5.3.0`'s `listSessions` reports `idSource: "unavailable"` instead of
    // falling back to the filename — the fallback that produced this whole family of defect in two
    // independent consumers. Without the distinction an unreadable transcript matched no registry
    // id, fell into "not registered", and was unlinked.
    //
    // ABSENT means "no reason to doubt", not "unreadable": this repository's own `readdir` seam does
    // not supply the field, and reading its absence as doubt would switch `gc` off entirely for
    // every caller that has not adopted the new listing. Pinned by an arm.
    //
    // The asymmetry is the argument. Keeping a file that turns out to be junk costs disk; deleting
    // one that turns out to be a live session costs the session, and `unlink` has no undo.
    if (unreadable(entry)) {
      kept.push(id)
      continue
    }
    if (!protectedIds.has(id) && ageDays > maxAgeDays) {
      // `registryAll` holds SESSION ids and `id` is a transcript name — comparing them directly is
      // what made this field permanently false. Ask the registry in its own vocabulary.
      // #102 — `find`, not `some`: the matching id is the one `Agent.delete` needs, and discarding
      // it here is what made the deletion address a name the registry has never heard of.
      candidates.push(candidateFor(id, ageDays, registryAll, namesOf))
    } else {
      kept.push(id)
    }
  }

  return { candidates, kept, pointer, mostRecent, total: onDisk.length }
}

async function defaultList(cwd: string): Promise<RegistryEntry[]> {
  const items = await listAgents(cwd)
  return items.map((i) => ({ agentId: i.agentId, archived: i.archived ?? false }))
}

export interface RunSessionGCOptions {
  apply?: boolean
  cwd?: string
  baseDir?: string
  delete?: (id: string) => Promise<void>
  unlink?: (idOrPath: string) => Promise<void>
  readPointer?: (cwd: string) => string | undefined
  readdir?: (dir: string) => { id: string; mtimeMs: number }[]
}

export interface SessionGCResult {
  dryRun: boolean
  removed: string[]
  errors: string[]
}

function resolveApply(plan: SessionGCPlan, opts: RunSessionGCOptions) {
  const cwd = opts.cwd ?? process.cwd()
  const baseDir = opts.baseDir ?? defaultBaseDir()
  const newestNow = (opts.readdir ?? readTranscriptDir)(transcriptDir(cwd, baseDir)).sort(
    (a, b) => b.mtimeMs - a.mtimeMs || a.id.localeCompare(b.id),
  )[0]?.id
  const untouchable = new Set(
    [(opts.readPointer ?? realReadPointer)(cwd), newestNow, plan.pointer, plan.mostRecent].filter(
      (id): id is string => id !== undefined,
    ),
  )
  return {
    del: opts.delete ?? ((id: string) => Agent.delete(id)),
    unlink: opts.unlink ?? ((id: string) => fsp.unlink(transcriptPath(baseDir, cwd, id))),
    untouchable,
  }
}

export async function runSessionGC(
  plan: SessionGCPlan,
  opts: RunSessionGCOptions = {},
): Promise<SessionGCResult> {
  const dryRun = opts.apply !== true
  const removed: string[] = []
  const errors: string[] = []
  if (dryRun) {
    return { dryRun: true, removed: plan.candidates.map((c) => c.id), errors: [] }
  }
  const { del, unlink, untouchable } = resolveApply(plan, opts)

  for (const c of plan.candidates) {
    if (untouchable.has(c.id)) {
      errors.push(
        `${c.id}: refused — the live pointer / most-recent transcript must never be deleted`,
      )
      continue
    }
    // #102 — the registry's own vocabulary. `c.id` is the transcript name; `Agent.delete` wants
    // the session id, and got the wrong one until the match started carrying it.
    await removeTolerant(
      c.id,
      () => (c.inRegistry ? del(c.agentId ?? c.id) : unlink(c.id)),
      removed,
      errors,
    )
  }
  return { dryRun: false, removed, errors }
}
