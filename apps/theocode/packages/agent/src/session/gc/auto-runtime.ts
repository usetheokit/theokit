import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { projectsRoot } from '@theokit/agents/session'

import { sweepDecision } from './auto.js'
import { buildSweepCommand, type SweepCommand } from './spawn-sweep.js'

/**
 * The real wiring for B-131 / B-132: a stamp on disk, and the collector that already existed.
 *
 * Split from `auto.ts` on purpose. The decision — is it enabled, is it due, what is reported, what
 * happens when it fails — is pure and heavily tested there. This file is the part that touches the
 * filesystem and the module graph, and it is deliberately thin enough to read in one screen.
 */

/** At most once a day. The retention window is measured in days; a shorter interval buys nothing. */
const DEFAULT_INTERVAL_HOURS = 24

/**
 * Beside the projects tree rather than inside it.
 *
 * `listProjectDirs` filters to directories, so a dotfile inside the root would be ignored today —
 * but "today" is the wrong thing to rely on for a file that sits in the middle of the one path that
 * deletes user data. One level up is unambiguous.
 */
function stampPath(root: string): string {
  return join(dirname(root), '.last-session-gc')
}

function readLastRun(root: string): Date | undefined {
  const path = stampPath(root)
  if (!existsSync(path)) return undefined
  const at = new Date(readFileSync(path, 'utf8').trim())
  return Number.isNaN(at.getTime()) ? undefined : at
}

function writeLastRun(root: string, at: Date): void {
  const path = stampPath(root)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${at.toISOString()}\n`)
}

/**
 * Start the sweep in a CHILD PROCESS and return immediately (B-142).
 *
 * The in-process form above blocks the event loop for as long as the sweep takes — measured at 37.1 s
 * cold and 4.9-13.2 s warm on the 13 269-project tree this repository cites — because the work is
 * synchronous JavaScript inside a dependency and `void` defers only the tail of a function whose tail
 * is empty. A child process is the only mechanism that makes "housekeeping never delays a start"
 * true rather than asserted.
 *
 * The parent keeps the decision and the stamp; the child runs `sessions gc --all-projects`, the
 * command that already exists, so the delete path has exactly one implementation.
 *
 * NOT detached, and what that actually means was MEASURED rather than reasoned about (2026-09-03):
 * a child spawned without `detached` SURVIVES the parent's normal exit — it is orphaned and
 * reparented, not killed. What `detached` changes is the process GROUP: without it the child stays
 * in the parent's group, so closing the terminal window sends SIGHUP to both.
 *
 * An earlier version of this comment claimed the child was "bound to this process's lifetime", and
 * that was simply false. It is recorded here because the same file already carried one false claim
 * about asynchrony (B-142), and a second one written while fixing the first is worth naming.
 *
 * The CLI still does not use this, and the reason had to be replaced along with the claim it rested
 * on. It is not that the child would be killed — it would not. It is that `onReport` fires on the
 * child's `close` event, and a one-shot CLI is gone by then: the sweep would run completely
 * unobserved, and B-132's requirement is that what the collector did is visible. A sweep nobody can
 * see is the "it ran and removed nothing" / "it never ran" ambiguity this design exists to remove.
 * `sessions gc` remains the explicit command it always was.
 */
export function startSessionSweepInBackground(opts: {
  readonly enabled: boolean
  readonly onReport: (line: string) => void
  readonly now?: Date
  readonly projectsRootOverride?: string
  readonly intervalHours?: number
  readonly spawnSweep?: (cmd: SweepCommand) => {
    on: (event: 'close', cb: (code: number | null) => void) => void
    stdout?: { on: (event: 'data', cb: (chunk: unknown) => void) => void } | null
  }
}): { readonly started: boolean; readonly reason: string } {
  const root = opts.projectsRootOverride ?? projectsRoot()
  const now = opts.now ?? new Date()

  const decision = sweepDecision({
    enabled: opts.enabled,
    now,
    intervalHours: opts.intervalHours ?? DEFAULT_INTERVAL_HOURS,
    lastRun: readLastRunSafely(root),
  })
  if (!decision.run) return { started: false, reason: decision.reason }

  const command = commandOrUndefined(!decision.firstRun, opts.onReport)
  if (command === undefined) return { started: false, reason: 'unspawnable' }

  // Stamped BEFORE the spawn, which is also what narrows the concurrency window to the microseconds
  // between the read above and this write. Two TUIs started in the same instant can both decide to
  // run and both spawn.
  //
  // NO LOCK, deliberately. The consequence of two concurrent sweeps is bounded: a concurrent
  // `unlink` counts ENOENT as removed, and `rmdir` on a directory another sweep has repopulated
  // fails ENOTEMPTY, which is the safe direction. The second half was measured 2026-09-03 rather
  // than assumed from POSIX: `fs.rmdirSync` on a non-empty directory throws `ENOTEMPTY`. A lock file would add a failure mode strictly
  // worse than the one it prevents — a stale lock disables collection permanently, which is exactly
  // the shape B-143 had to fix in the pointer read. Rung 1 of the parsimony ladder: not until
  // someone observes harm.
  stampTolerantly(root, now, opts.onReport)

  try {
    const child =
      opts.spawnSweep?.(command) ??
      spawn(command.command, [...command.args], { ...command.options, stdio: [...command.options.stdio] })
    reportWhenFinished(child, decision.firstRun, opts.onReport)
    return { started: true, reason: decision.firstRun ? 'first-run-dry' : 'applying' }
  } catch (err) {
    opts.onReport(`[sessions gc] could not start the background sweep: ${reasonOf(err)}`)
    return { started: false, reason: 'spawn-failed' }
  }
}

/**
 * What to tell the operator when the sweep did NOT start, or `undefined` for the normal cases.
 *
 * `too-soon` and `disabled` are the two states the design intends: the sweep runs at most once a
 * day, and it can be switched off. Reporting them would put a line in the log on nearly every
 * launch, and a diagnostics channel that always says something is one nobody reads.
 *
 * Everything else means collection will not happen and nothing else will say so — the silent
 * non-collection B-138 was about. It lived inline in `tui/src/main.tsx` as a three-clause condition
 * in a file at 0% coverage; it lives here because "what the operator is told about the sweep" is one
 * concern, and `sweepFinishedLine` is the other half of it.
 */
export function startupNoticeFor(outcome: {
  readonly started: boolean
  readonly reason: string
}): string | undefined {
  if (outcome.started) return undefined
  if (outcome.reason === 'too-soon' || outcome.reason === 'disabled') return undefined
  return `[sessions gc] not started: ${outcome.reason}`
}

/** A stamp that cannot be read is the same as no stamp: sweep, rather than refuse to. */
function readLastRunSafely(root: string): Date | undefined {
  try {
    return readLastRun(root)
  } catch {
    return undefined
  }
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * What the operator reads when the child finishes.
 *
 * Extracted because composing it inline pushed the caller past the complexity gate, and because the
 * first-run sentence is the one that has to tell someone how to opt out — burying it in a nested
 * ternary is how that sentence gets lost in the next edit.
 */
function sweepFinishedLine(firstRun: boolean, code: number | null, said: string): string {
  const exit = code === 0 || code === null ? '' : ` with exit ${String(code)}`
  // The child's verdict line — `DRY-RUN — …` or `APPLIED — N artifact(s) removed`. A silent child
  // still produces a report: reporting only when there is output would make a broken child
  // indistinguishable from a collector that never ran.
  const summary = said
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('DRY-RUN') || l.startsWith('APPLIED'))
  const detail = summary === undefined ? '' : ` — ${summary}`
  if (!firstRun) return `[sessions gc] background sweep finished${exit}${detail}`
  return (
    `[sessions gc] first background sweep finished${exit}${detail} — DRY RUN by design. ` +
    'The next one will apply; set `session_gc = false` to keep collection manual.'
  )
}

/**
 * The command, or `undefined` with the reason reported.
 *
 * Refusing to spawn is the safe direction, and `buildSweepCommand` carries the measured reason — a
 * child with no script exits 0 having swept nothing, so the collector would report a finished sweep
 * every day while collecting nothing. Not repeated here: this docblock held a COPY of that reason,
 * the copy said "an idle Node REPL that never exits" (measured false, B-147), and the correction
 * landed on the original while the copy went on shipping it.
 */
function commandOrUndefined(
  apply: boolean,
  onReport: (line: string) => void,
): SweepCommand | undefined {
  try {
    return buildSweepCommand({ apply, execPath: process.execPath, script: process.argv[1] })
  } catch (err) {
    onReport(`[sessions gc] ${reasonOf(err)}`)
    return undefined
  }
}

/**
 * Record the attempt, and carry on if the state directory will not take it.
 *
 * A read-only home must not mean the retention policy stops being applied; it means the interval is
 * not remembered, which is the smaller of the two problems.
 */
function stampTolerantly(root: string, now: Date, onReport: (line: string) => void): void {
  try {
    writeLastRun(root, now)
  } catch (err) {
    onReport(`[sessions gc] could not record the run time: ${reasonOf(err)}`)
  }
}

/**
 * Wire the child's reporting: collect what it says, and report once it is done.
 *
 * B-150 — the child's own summary line is what carries the counts two Definitions of Done require.
 * Collected rather than displayed: piping captures it, and the parent decides where it goes.
 *
 * Extracted because it pushed the caller past the complexity gate, and because "what the operator is
 * told" is a concern of its own — the same reason `sweepFinishedLine` is separate.
 */
function reportWhenFinished(
  child: {
    on: (event: 'close', cb: (code: number | null) => void) => void
    stdout?: { on: (event: 'data', cb: (chunk: unknown) => void) => void } | null
  },
  firstRun: boolean,
  onReport: (line: string) => void,
): void {
  let said = ''
  child.stdout?.on('data', (chunk) => {
    said += String(chunk)
  })
  child.on('close', (code) => {
    onReport(sweepFinishedLine(firstRun, code, said))
  })
}
