import { join } from 'node:path'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'

import { dirname } from 'node:path'

import { Agent, TheokitAgentError } from '@theokit/agents'
import { forkTranscript, transcriptPath, transcriptRoot } from '@theokit/agents/persistence'
import { deleteSession as deleteInFramework, protectedTranscriptPaths } from '@theokit/agents/session'

import { listAgents } from './agent-list.js'

const defaultBaseDir = transcriptRoot

export interface SessionInfo {
  agentId: string
  name?: string
  archived: boolean
  lastModified?: number
}

/**
 * #124 — the registry entries this product calls sessions, which is all of them.
 *
 * This used to keep only ids beginning with `tui-`. Three surfaces mint ids — the TUI (`tui-`), the
 * headless CLI (`exec-`) and the review runner (`review-`) — so every session the headless surface
 * created was invisible to the only command that reveals an id, and `archive`/`rename`/`delete`/
 * `fork` all take one. Four operations unreachable from that surface, reported as `no sessions for
 * this directory`: an assertion of absence, not a description of a filter.
 *
 * Listing the three known prefixes instead would be the same defect in miniature — a fourth surface
 * mints a fourth prefix and disappears, silently, exactly as `exec-` did from the first commit.
 *
 * What settles it is that this codebase already answers "what is a session", and the answer is not
 * the name: `gc/filesystem.ts:98` and `gc/per-session.ts:203` build the DELETION PROTECTION SET from
 * this same listing with no filter at all. Two answers to one question is how they come to disagree,
 * and here the stricter one guarded a display while the looser one guarded deletion.
 *
 * Split from `listSessions` so the rule is testable without a registry on disk — the I/O is the
 * other half, and it was never the part that was wrong.
 */
export function sessionsFrom(
  items: readonly { agentId: string; name?: string; archived?: boolean; lastModified?: number }[],
): SessionInfo[] {
  return items.map((i) => ({
    agentId: i.agentId,
    name: i.name,
    archived: i.archived ?? false,
    lastModified: i.lastModified,
  }))
}

export async function listSessions(cwd: string = process.cwd()): Promise<SessionInfo[]> {
  return sessionsFrom(await listAgents(cwd))
}

export function legacyRootHint(found: number, legacyRoot: string): string | undefined {
  if (found > 0) return undefined
  const newRoot = process.env.THEOKIT_HOME?.trim()
  if (newRoot === undefined || newRoot.length === 0) return undefined
  if (newRoot === legacyRoot) return undefined
  let projects: string[]
  try {
    projects = readdirSync(join(legacyRoot, 'projects'))
  } catch {
    return undefined
  }
  if (projects.length === 0) return undefined
  return (
    `No sessions in ${newRoot} (THEOKIT_HOME). ` +
    `There are ${projects.length} project(s) with sessions under the previous root ${legacyRoot} — ` +
    `unset THEOKIT_HOME to see them again, or move the contents.`
  )
}

export function archiveSession(agentId: string): Promise<void> {
  return Agent.archive(agentId)
}

export function renameSession(agentId: string, name: string): Promise<void> {
  return Agent.rename(agentId, name)
}

/**
 * B-078 — refusing to delete a session another process is still writing.
 *
 * The same set `forkSession` refuses to overwrite (B-003). Deleting a live transcript is strictly
 * worse than forking onto it: the fork is caught by `wx`, this would not be caught by anything.
 */
export class LiveSessionDeletionError extends TheokitAgentError {
  override readonly name = 'LiveSessionDeletionError'
  readonly agentId: string

  constructor(agentId: string) {
    super(
      `refusing to delete session ${agentId}: its transcript is live — it is either the session ` +
        `this directory points at or the most recently written one, so a TUI is probably still ` +
        `appending to it. Switch to another session (/new) and delete it from there.`,
    )
    this.agentId = agentId
  }
}

/**
 * What happened to the registry entry, MEASURED by re-reading the listing.
 *
 * Three states rather than a boolean, because a boolean would have to lie about the third: a session
 * that was not listed before the delete (archived sessions are excluded from the listing) is absent
 * after it too, and calling that a removal is a false success of exactly the shape #125 filed.
 */
export type RegistryOutcome = 'removed' | 'still-present' | 'unverified'

export interface DeleteSessionResult {
  /** Whether a transcript file was found and unlinked. False when the registry outlived the file. */
  readonly transcriptRemoved: boolean
  /** What happened to the registry entry — re-read, never taken from the removal's own report. */
  readonly registryEntry: RegistryOutcome
}

/**
 * #125 — classify the registry half from the listing before and after.
 *
 * Its own function, and pure, so the RULE is testable without a registry on disk. The I/O around it
 * was never the part that was wrong: what was wrong is that nothing asked the question.
 *
 * Why not the SDK's `registryRemoved`: measured 2026-09-07, it is `true` even when the injected
 * removal returns `undefined` and removes nothing. It reports that the call did not REJECT, and with
 * `Agent.delete(id): Promise<void>` never throwing on a miss (theokit-sdk#612) that is
 * indistinguishable from success. Carrying it through would move the false assertion, not remove it.
 */
export function classifyRegistryOutcome(seen: {
  before: readonly string[]
  after: readonly string[]
  id: string
}): RegistryOutcome {
  if (seen.after.includes(seen.id)) return 'still-present'
  if (!seen.before.includes(seen.id)) return 'unverified'
  return 'removed'
}

export interface DeleteSessionOptions {
  cwd?: string
  baseDir?: string
  /**
   * Injected so a test does not mutate the real agent registry. Defaults to `Agent.delete`, which —
   * measured in the SDK, not assumed — is `removeRegisteredAgent()` plus a registry save: it clears
   * the ENTRY and never touches the file. That is exactly why this function exists; calling it alone
   * empties the listing and leaves the transcript on disk, which reads as success.
   */
  removeFromRegistry?: (agentId: string) => Promise<void>
}

/**
 * Permanently delete a session: its registry entry AND its transcript.
 *
 * Order is load-bearing. The live check runs FIRST and throws before anything is mutated, because
 * removing the registry entry and then refusing would leave a session that can be neither opened
 * nor deleted — worse than either outcome on its own.
 */
export async function deleteSession(
  agentId: string,
  opts: DeleteSessionOptions = {},
): Promise<DeleteSessionResult> {
  const cwd = opts.cwd ?? process.cwd()
  const dir = opts.baseDir ?? defaultBaseDir()
  const target = transcriptPath(dir, cwd, agentId)

  if (protectedSessions(cwd, dir).includes(target)) {
    throw new LiveSessionDeletionError(agentId)
  }

  const removeFromRegistry = opts.removeFromRegistry ?? ((id: string) => Agent.delete(id))
  // Read BEFORE, so a session that was never listed can be told apart from one that was removed.
  const before = (await listAgents(cwd)).map((a) => a.agentId)
  await removeFromRegistry(agentId)

  // The transcript removal is the framework's — and not only to avoid a second copy.
  //
  // This used to be `existsSync(target)` followed by `rmSync(target, { force: true })`, reporting
  // the FIRST call's answer. Between the two there is a window: a GC sweep or a second TUI can
  // unlink the file, and the result then claims `transcriptRemoved: true` for a file this call did
  // not remove. `deleteSession` in `@theokit/agents/session` derives the answer from whether its own
  // `rmSync` threw, so what it reports is what happened.
  //
  // `force: true` is honest here rather than a bypass: the live check ran above, BEFORE the registry
  // entry was removed, and it raised this product's typed error. Re-running it now would test a
  // state that this function itself has already changed.
  //
  // A registry entry outliving its file stays a normal state (the GC removes transcripts by age),
  // reported through the result rather than raised at someone deleting a session.
  // `await` since @theokit/agents@10.0.0: `deleteSession` went async because the only agent registry
  // in the ecosystem is `Agent.delete(id): Promise<void>`, and the registry half of a deletion is
  // unreachable without awaiting it. Without the `await` this destructures a Promise and
  // `transcriptRemoved` is `undefined` — reported to the caller as "not removed" for a file that was.
  const { transcriptRemoved } = await deleteInFramework(agentId, {
    cwd,
    root: dir,
    force: true,
  })
  // #125 — the registry half is MEASURED, not reported. The removal returns `Promise<void>` and does
  // not throw when it removes nothing, so awaiting it is indistinguishable from success; the only
  // evidence available is the listing itself.
  const after = (await listAgents(cwd)).map((a) => a.agentId)
  return {
    transcriptRemoved,
    registryEntry: classifyRegistryOutcome({ before, after, id: agentId }),
  }
}

/**
 * B-003 — what `forkTranscript` refuses to overwrite, and what `deleteSession` refuses to remove.
 *
 * ## The third category, which this file documented as unreachable
 *
 * The comment this replaces named the SDK's three categories — live pointer, most recent transcript,
 * active registry entry — covered two, and explained the omission: *"`listAgents` is async and both
 * callers are synchronous write paths, so including it would turn two write paths async for a guard
 * that is already backstopped."* The stated cost was losing the typed `LiveSessionError` in favour
 * of a bare `EEXIST` — not losing the protection.
 *
 * `protectedTranscriptPaths` (M71) covers that third category SYNCHRONOUSLY, through the SDK's writer
 * lease instead of the async registry. The constraint that forced the omission does not apply to it,
 * so the guard is complete now and neither caller became async.
 *
 * It also carries the REASON per session (`'resumable session pointer'`, `'most recent session'`,
 * `'active writer lease'`) — which is what a refusal needs to say. This projection drops it because
 * both callers here take paths; anything wanting the reason calls the primitive directly.
 *
 * ## The keys are already paths — and the rename is why relying on that is safe
 *
 * This mapped each key forward through `transcriptPath`, because the keys used to be session ids.
 * They are paths now, so the mapping built a path out of a path: garbage matching nothing, an empty
 * array, and an open guard in `deleteSession`.
 *
 * Measured against the upstream candidate BEFORE it was published, over a symlink into their build:
 * `deleteSession` resolved `{ transcriptRemoved: true }` on a LIVE session instead of refusing, and
 * a transcript with an active writer lease was collectable. Five tests, of 1244.
 *
 * Nothing in the type said so — `Map<string, string>` before and after, identical signature,
 * opposite meaning. Upstream removed the old NAME rather than aliasing it, so the same change is now
 * a compile error here instead of a deletion. That is the only reason this comment describes a near
 * miss rather than an incident.
 */
export function protectedSessions(cwd: string, baseDir: string): string[] {
  return [...protectedTranscriptPaths(cwd, baseDir).keys()]
}

export function forkSession(
  sessionId: string,
  newId: string,
  opts: { cwd?: string; baseDir?: string } = {},
): { newId: string; copied: boolean } {
  const cwd = opts.cwd ?? process.cwd()
  const dir = opts.baseDir ?? defaultBaseDir()
  const src = transcriptPath(dir, cwd, sessionId)
  const dst = transcriptPath(dir, cwd, newId)
  if (!existsSync(src)) return { newId, copied: false }
  mkdirSync(dirname(dst), { recursive: true })
  forkTranscript(src, dst, { liveSessionPaths: protectedSessions(cwd, dir) })
  return { newId, copied: true }
}

export async function compactSession(
  sessionId: string,
): Promise<{ preTokens: number; postTokens: number }> {
  return Agent.compact(sessionId, { trigger: 'manual' })
}
