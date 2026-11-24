import { existsSync } from 'node:fs'
import process from 'node:process'
import { Agent } from '@theokit/agents'
import { exitAfterDrain, sessionsGcCommand } from '@theokit/agents/commands'
import {
  planTranscriptGC,
  runTranscriptGC,
  type GCSession,
  type RunTranscriptGCResult,
  type TranscriptGCPlan,
} from '@theokit/agents/session'

import type { ExecSessions } from '../runtime/index.js'

async function gcAcrossAllProjects(args: ExecSessions): Promise<void> {
  const { planAllProjectsOnDisk, runAllProjectsOnDisk, formatReport } =
    await import('@theocode/agent/session')
  let plan
  try {
    plan = await planAllProjectsOnDisk({
      ...(args.keepLast !== undefined ? { keepLast: args.keepLast } : {}),
      ...(args.maxAgeDays !== undefined ? { maxAgeDays: args.maxAgeDays } : {}),
    })
  } catch (err) {
    process.stderr.write(`[sessions gc] ${err instanceof Error ? err.message : String(err)}\n`)
    exitAfterDrain(1)
    return
  }
  const result = await runAllProjectsOnDisk(plan, { apply: args.apply })
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ type: 'sessions.gc.all', dryRun: result.dryRun, byKind: plan.totalByKind, removed: result.removed.length, kept: plan.kept.length, errors: [...plan.errors, ...result.errors] })}\n`,
    )
  } else {
    for (const l of formatReport(plan, result)) process.stderr.write(`${l}\n`)
  }
  exitAfterDrain(plan.errors.length + result.errors.length > 0 ? 1 : 0)
}

export function humanReport(plan: TranscriptGCPlan, result: RunTranscriptGCResult): string[] {
  const failed = new Set(result.errors.map((e) => e.id))
  // Per transcript FILE, not per session id: a current and a legacy file can share an id, and one
  // can be removed while the other fails. An applied run is judged by what is left on disk.
  const gone = (c: TranscriptGCPlan['candidates'][number]): boolean =>
    result.dryRun || !existsSync(c.transcript)
  const removedCount = plan.candidates.filter(gone).length
  const verb = result.dryRun ? 'would remove' : 'removed'
  const lines = [
    `[sessions gc] ${result.dryRun ? 'DRY-RUN' : 'APPLIED'} — ${removedCount} ${verb}; ${plan.kept.length + plan.candidates.length - removedCount} kept`,
    ...plan.candidates.map((c) => {
      const ageDays = Math.round((Date.now() - c.modifiedAt.getTime()) / 86_400_000)
      const outcome = gone(c)
        ? `[${verb}]`
        : failed.has(c.id)
          ? '[NOT removed — see errors]'
          : '[kept — became protected]'
      return `  - ${c.id ?? c.transcript} (${ageDays}d) ${outcome}`
    }),
  ]
  if (result.dryRun && plan.candidates.length > 0) lines.push('  → re-run with --apply to delete')
  return [
    ...lines,
    ...result.errors.map((e) => `  ! ${e.id ?? 'unnamed transcript'}: ${e.message}`),
  ]
}

export interface CurrentProjectGCOptions {
  cwd: string
  keepLast?: number
  maxAgeDays?: number
  apply: boolean
  /** Test seams: the transcript root, the clock, the registry listing and its remover. */
  root?: string
  now?: number
  listRegistry?: (cwd: string) => Promise<{ agentId: string; archived?: boolean }[]>
  removeFromRegistry?: (id: string) => unknown
}

/** The framework's note for a candidate with no id; here that is expected, not a failure. */
const UNNAMEABLE = 'transcript collected without a registry removal'

/**
 * The project's registry listing INCLUDING archived sessions. The default listing hides them, and
 * an archived session's transcript would then look unregistered and be unlinked with its entry kept.
 */
async function listIncludingArchived(
  cwd: string,
  list: (o: { runtime: 'local'; cwd: string; includeArchived: true }) => Promise<{
    items: { agentId: string; archived?: boolean }[]
    nextCursor?: string
  }> = (o) => Agent.list(o),
): Promise<{ agentId: string; archived?: boolean }[]> {
  const r = await list({ runtime: 'local', cwd, includeArchived: true })
  if (r.nextCursor !== undefined) {
    throw new Error(
      `the agent listing returned a cursor (${r.nextCursor}) this version cannot drain`,
    )
  }
  return r.items
}

/**
 * `sessions gc` for one project: the framework's planner with TheoCode's protection added: every
 * non-archived registry session. Throws what
 * the framework throws (`GCFloorError`, `GCProtectionUnavailableError`); the caller prints it.
 */
export async function planAndRunCurrentProjectGC(
  opts: CurrentProjectGCOptions,
): Promise<{ plan: TranscriptGCPlan; result: RunTranscriptGCResult }> {
  const { cwd } = opts
  const everyone = await (opts.listRegistry ?? listIncludingArchived)(cwd)
  const registeredIds = everyone.filter((a) => a.archived !== true).map((a) => a.agentId)
  // The framework protects its `last-session` pointer itself and refuses on an unreadable one.
  const protectedIds = (): ReadonlyMap<string, string> => {
    const out = new Map<string, string>()
    for (const id of registeredIds) out.set(id, 'registered session')
    return out
  }
  // A transcript the framework could not read is kept: "I could not read this" is no reason to unlink.
  const isProtected = (s: GCSession): string | undefined =>
    !s.idReadable && s.id === undefined ? `transcript id unreadable: ${s.transcript}` : undefined
  const knownIds = (): string[] => everyone.map((a) => a.agentId)
  const plan = await planTranscriptGC({
    cwd,
    keepLast: opts.keepLast ?? 10,
    maxAgeDays: opts.maxAgeDays ?? 30,
    protectedIds,
    isProtected,
    knownIds,
    ...(opts.root !== undefined ? { root: opts.root } : {}),
    ...(opts.now !== undefined ? { now: opts.now } : {}),
  })
  const registered = new Set(everyone.map((a) => a.agentId))
  const removeById = opts.removeFromRegistry ?? ((id: string) => Agent.delete(id))
  // A transcript's own id that no registry entry carries has nothing to remove there.
  const remove = (id: string) => (registered.has(id) ? removeById(id) : undefined)
  const result = await runTranscriptGC(plan, {
    apply: opts.apply,
    protectedIds,
    isProtected,
    removeFromRegistry: remove,
  })
  return {
    plan,
    result: {
      ...result,
      errors: result.errors.filter((e) => !e.message.startsWith(UNNAMEABLE)),
    },
  }
}

async function gcForCurrentProject(args: ExecSessions): Promise<void> {
  let outcome: Awaited<ReturnType<typeof sessionsGcCommand>>
  try {
    outcome = await sessionsGcCommand({
      cwd: process.cwd(),
      apply: args.apply,
      json: args.json,
      ...(args.keepLast !== undefined ? { keepLast: args.keepLast } : {}),
      ...(args.maxAgeDays !== undefined ? { maxAgeDays: args.maxAgeDays } : {}),
      human: humanReport,
      run: (resolved) => planAndRunCurrentProjectGC(resolved),
    })
  } catch (err) {
    process.stderr.write(`[sessions gc] ${err instanceof Error ? err.message : String(err)}\n`)
    exitAfterDrain(1)
    return
  }
  // The JSON report is a machine line on stdout; the human one goes to stderr.
  const out = args.json ? process.stdout : process.stderr
  for (const l of outcome.lines) out.write(`${l}\n`)
  exitAfterDrain(outcome.failed > 0 ? 1 : 0)
}

/**
 * B-074 — the five operations the TUI had and this surface did not.
 *
 * Every one is a call into `@theocode/agent/session`, the SAME functions the TUI commands use. That
 * is the point of the item rather than a convenience: the two surfaces drifted because each grew
 * its own half, and a second implementation here would have re-created the divergence while
 * appearing to close it.
 */
type SessionOps = typeof import('@theocode/agent/session')
type Say = (payload: Record<string, unknown>, human: string) => void

async function printSessionList(json: boolean, ops: SessionOps): Promise<void> {
  const sessions = await ops.listSessions()
  if (json) {
    process.stdout.write(`${JSON.stringify({ type: 'sessions.list', sessions })}\n`)
    return
  }
  if (sessions.length === 0) {
    process.stderr.write('no sessions for this directory\n')
    return
  }
  for (const s of sessions) {
    const name = s.name === undefined ? '' : ` (${s.name})`
    process.stderr.write(`${s.agentId}${name}${s.archived ? ' [archived]' : ''}\n`)
  }
}

async function runTargeted(args: ExecSessions, ops: SessionOps, say: Say): Promise<void> {
  const target = args.target ?? ''
  if (args.action === 'archive') {
    await ops.archiveSession(target)
    return say({ type: 'sessions.archive', id: target }, `archived ${target}`)
  }
  if (args.action === 'rename') {
    await ops.renameSession(target, args.name ?? '')
    return say({ type: 'sessions.rename', id: target, name: args.name }, `renamed ${target}`)
  }
  if (args.action === 'delete') {
    const r = await ops.deleteSession(target)
    const report = deleteReport(target, r)
    say(
      {
        type: 'sessions.delete',
        id: target,
        transcriptRemoved: r.transcriptRemoved,
        registryEntry: r.registryEntry,
      },
      report.message,
    )
    // #125 — a delete that left the entry behind must reach the exit code. A script deleting in a
    // loop has no other way to learn that nothing was deleted.
    if (report.failed) exitAfterDrain(1)
    return
  }
  const r = await ops.forkSession(target, `${target}-fork-${String(process.pid)}`)
  if (!r.copied) {
    process.stderr.write(`[sessions fork] no transcript for ${target}\n`)
    exitAfterDrain(1)
    return
  }
  // MEASURED (B-074): a fork copies the TRANSCRIPT; the agent registry only learns the id when
  // something opens it. The TUI hides this because `/fork` immediately points the live session at
  // the new id. Headless nothing does, so the fork is real on disk and absent from `sessions list`
  // until it is resumed — said plainly rather than left for the user to discover from an empty list.
  return say(
    { type: 'sessions.fork', from: target, to: r.newId, registered: false },
    `forked ${target} -> ${r.newId}\n` +
      `  it is a transcript, not yet a listed session — open it with: theocode resume ${r.newId}`,
  )
}

async function sessionOperation(args: ExecSessions): Promise<void> {
  const ops = await import('@theocode/agent/session')
  const say: Say = (payload, human) => {
    if (args.json) process.stdout.write(`${JSON.stringify(payload)}\n`)
    else process.stderr.write(`${human}\n`)
  }
  try {
    if (args.action === 'list') return await printSessionList(args.json, ops)
    return await runTargeted(args, ops, say)
  } catch (err) {
    // Reported with the operation that failed, never swallowed: a `delete` that silently did
    // nothing is discovered when the session is still there.
    process.stderr.write(
      `[sessions ${args.action}] ${err instanceof Error ? err.message : String(err)}\n`,
    )
    exitAfterDrain(1)
  }
}

/**
 * #125 — what to say about a delete, per store, and whether it failed.
 *
 * Both branches of the previous message opened with `deleted ${id}`, and the second asserted about
 * the registry — the half nothing had checked. A session left registered with its transcript gone
 * was reported as a success, exit 0.
 *
 * Three registry outcomes and three sentences, because collapsing them is how the false success
 * happened: `unverified` is not a failure (an archived session is excluded from the listing this
 * verification reads, so absence proves nothing) and it is not a removal either.
 */
export function deleteReport(
  id: string,
  r: { transcriptRemoved: boolean; registryEntry: 'removed' | 'still-present' | 'unverified' },
): { message: string; failed: boolean } {
  const transcript = r.transcriptRemoved
    ? 'transcript removed from disk'
    : 'its transcript was already gone'
  if (r.registryEntry === 'still-present') {
    return {
      message:
        `${id} is STILL REGISTERED after the delete — ${transcript}. ` +
        'The registry half did not happen (theokit-sdk#612); the session will keep appearing in ' +
        '`sessions list` with no transcript behind it.',
      failed: true,
    }
  }
  if (r.registryEntry === 'unverified') {
    return {
      message:
        `${id}: ${transcript}. Whether the registry entry went could not be verified — it was not ` +
        'in the listing before the delete either, which is what an archived session looks like.',
      failed: false,
    }
  }
  return { message: `deleted ${id} — ${transcript}`, failed: false }
}

export async function sessionsCommand(args: ExecSessions): Promise<void> {
  if (args.action !== 'gc') return sessionOperation(args)
  if (args.allProjects) return gcAcrossAllProjects(args)
  return gcForCurrentProject(args)
}
