import process from 'node:process'
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
    process.exit(1)
  }
  const result = await runAllProjectsOnDisk(plan, { apply: args.apply })
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ type: 'sessions.gc.all', dryRun: result.dryRun, byKind: plan.totalByKind, removed: result.removed.length, kept: plan.kept.length, errors: [...plan.errors, ...result.errors] })}\n`,
    )
  } else {
    for (const l of formatReport(plan, result)) process.stderr.write(`${l}\n`)
  }
  process.exit(plan.errors.length + result.errors.length > 0 ? 1 : 0)
}

function humanReport(
  plan: {
    kept: unknown[]
    pointer?: string
    mostRecent?: string
    candidates: { id: string; ageDays: number; inRegistry: boolean }[]
  },
  result: { dryRun: boolean; removed: unknown[]; errors: string[] },
): string[] {
  const verb = result.dryRun ? 'would remove' : 'removed'
  const pointer = plan.pointer?.slice(0, 16) ?? 'none'
  const mostRecent = plan.mostRecent?.slice(0, 16) ?? 'none'
  const lines = [
    `[sessions gc] ${result.dryRun ? 'DRY-RUN' : 'APPLIED'} — ${result.removed.length} ${verb}; ${plan.kept.length} kept (pointer=${pointer}, most-recent=${mostRecent})`,
    ...plan.candidates.map(
      (c) =>
        `  - ${c.id} (${Math.round(c.ageDays)}d, ${c.inRegistry ? 'registry' : 'orphan'}) [${verb}]`,
    ),
  ]
  if (result.dryRun && plan.candidates.length > 0) lines.push('  → re-run with --apply to delete')
  return [...lines, ...result.errors.map((e) => `  ! ${e}`)]
}

async function gcForCurrentProject(args: ExecSessions): Promise<void> {
  const { planSessionGC, runSessionGC } = await import('@theocode/agent/session')
  const plan = await planSessionGC({
    cwd: process.cwd(),
    ...(args.keepLast !== undefined ? { keepLast: args.keepLast } : {}),
    ...(args.maxAgeDays !== undefined ? { maxAgeDays: args.maxAgeDays } : {}),
  })
  const result = await runSessionGC(plan, { apply: args.apply })
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({ type: 'sessions.gc', dryRun: result.dryRun, removed: result.removed, kept: plan.kept.length, pointer: plan.pointer, mostRecent: plan.mostRecent, errors: result.errors })}\n`,
    )
  } else {
    for (const l of humanReport(plan, result)) process.stderr.write(`${l}\n`)
  }
  process.exit(result.errors.length > 0 ? 1 : 0)
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
    if (report.failed) process.exit(1)
    return
  }
  const r = ops.forkSession(target, `${target}-fork-${String(process.pid)}`)
  if (!r.copied) {
    process.stderr.write(`[sessions fork] no transcript for ${target}\n`)
    process.exit(1)
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
    process.exit(1)
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
