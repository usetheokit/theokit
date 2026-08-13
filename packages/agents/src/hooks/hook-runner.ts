import { spawn } from 'node:child_process'

/**
 * M75 — run one hook command as a subprocess, bounded.
 *
 * ## Why this is a separate primitive
 *
 * The framework published a well-typed seam (`HookHandlers`, 8 events, `pre_tool_call` as the only
 * veto) and stopped there. Everything between "the user wrote a command in a config file" and "that
 * command runs, bounded, trusted, and its output comes back safely to the model" belonged to the
 * consumer — 828 lines importing a SINGLE symbol from the framework.
 *
 * Every hard part below is generic infrastructure the next consumer would relearn the bad way.
 *
 * ## The four traps, each with a named constant
 *
 * 1. **Output cap.** A hook that prints a gigabyte fills the model's context and the machine's
 *    memory. Truncation is not a nicety; it is what keeps a runaway command from becoming an
 *    outage.
 * 2. **The drain-versus-exit race.** `exit` fires when the process ends, `close` when its stdio
 *    streams are actually finished. Settling on `exit` truncates output that was still in flight —
 *    intermittently, which is the worst way to lose data. This settles on `close`, with a bounded
 *    grace period so a wedged stream cannot hang the run forever.
 * 3. **Process-group kill.** `child.kill()` signals the child only. A hook that spawns its own
 *    children — a shell pipeline, almost always — leaves them orphaned and running. Killing the
 *    GROUP is what makes a timeout mean something.
 * 4. **Chain budget.** One slow hook is a slow turn; a chain of them with individual timeouts is an
 *    unbounded one. The chain gets its own ceiling.
 */

/** Most output one hook may return. Beyond this the result is truncated and says so. */
export const MAX_OUTPUT_BYTES = 1_048_576

/**
 * How long to wait, after the process exits, for its stdio to finish.
 *
 * Bounded because a stream that never closes would otherwise hang the turn: the process is already
 * gone, so this is purely about draining what it wrote.
 */
export const DRAIN_BUDGET_MS = 2_000

/** Multiplier applied to a single hook's timeout to bound a whole chain. */
export const CHAIN_BUDGET_MULTIPLIER = 4

export interface HookRunInput {
  readonly command: string
  /** Working directory for the command. */
  readonly cwd: string
  /** Per-hook wall clock. The chain ceiling is this times {@link CHAIN_BUDGET_MULTIPLIER}. */
  readonly timeoutMs: number
  /** Written to the process's stdin, then closed. */
  readonly stdin?: string
  /** Environment. Passed explicitly so a caller can restrict it — never inherited implicitly. */
  readonly env?: Readonly<Record<string, string>>
}

export interface HookRunResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  /** True when {@link MAX_OUTPUT_BYTES} cut the output. */
  readonly truncated: boolean
  /** True when the timeout killed the process group. */
  readonly timedOut: boolean
}

/**
 * Run `command` through a shell, bounded by every ceiling above.
 *
 * A shell IS used, deliberately: hook commands are written by humans in config files and routinely
 * contain pipes and redirects. The security boundary is not "no shell" — it is the trust store that
 * decides whether this command may run at all (see `hook-fingerprint.ts`). Pretending a shell-less
 * spawn made arbitrary user commands safe would be a comforting lie.
 */
export async function runHookCommand(input: HookRunInput): Promise<HookRunResult> {
  return new Promise<HookRunResult>((resolve) => {
    // The rule below asks exactly the right question, and the answer is written out rather than
    // waved away.
    //
    // This DOES execute a user-supplied string through a shell, on purpose: hook commands are
    // written by humans in config files and routinely contain pipes and redirects, so a shell-less
    // spawn would break the feature while making it no safer — the string is still the user's.
    //
    // The security boundary is not "no shell". It is the two fail-closed gates in
    // `hook-spec.ts`: the directory must be trusted (M68/M73) AND the exact command must be
    // approved by fingerprint, which any edit invalidates. Sanitising the string here would be
    // security theatre on top of a decision already made upstream — and would suggest the string is
    // untrusted at this point, when reaching this line means it was explicitly authorised.
    // eslint-disable-next-line sonarjs/os-command -- answered in the paragraph above
    const child = spawn(input.command, {
      cwd: input.cwd,
      shell: true,
      // Trap 3: its own process group, so the timeout can kill the whole tree.
      detached: true,
      env: input.env as NodeJS.ProcessEnv | undefined,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let settled = false

    const capture = (current: string, chunk: Buffer): string => {
      if (current.length >= MAX_OUTPUT_BYTES) {
        truncated = true
        return current
      }
      const next = current + chunk.toString('utf8')
      if (next.length <= MAX_OUTPUT_BYTES) return next
      truncated = true
      return next.slice(0, MAX_OUTPUT_BYTES)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = capture(stdout, chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = capture(stderr, chunk)
    })

    const settle = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(drainTimer)
      resolve({ exitCode, stdout, stderr, truncated, timedOut })
    }

    const timer = setTimeout(() => {
      timedOut = true
      killGroup(child.pid)
    }, input.timeoutMs)

    // Trap 2: settle on `close`, not `exit`. `exit` fires when the process ends; `close` when its
    // stdio is finished. Settling on the former drops output still in flight — intermittently.
    let drainTimer: ReturnType<typeof setTimeout> = setTimeout(() => undefined, 0)
    child.on('exit', (code) => {
      // The process is gone; give its streams a bounded moment to finish, then settle regardless.
      drainTimer = setTimeout(() => {
        settle(code)
      }, DRAIN_BUDGET_MS)
    })
    child.on('close', (code) => {
      settle(code)
    })
    child.on('error', () => {
      settle(null)
    })

    // EPIPE is EXPECTED here, and swallowing it is the correct behaviour rather than a shortcut.
    //
    // A hook that exits without reading its stdin — `exit 1`, or any command that decides early —
    // closes the pipe while we are still writing to it. Node surfaces that as an asynchronous
    // `EPIPE` on the stream, and an unhandled one takes down the process: measured as
    // `Serialized Error: { errno: -32, code: 'EPIPE' }` crashing the suite AFTER every assertion had
    // already passed, which is how a real defect hid behind 5887 green tests.
    //
    // The hook's exit code is what the caller acts on, and that arrives regardless. A command that
    // ignored its input is not a failure of ours to report.
    child.stdin.on('error', () => undefined)
    if (input.stdin !== undefined) child.stdin.end(input.stdin)
    else child.stdin.end()
  })
}

/**
 * Kill the process GROUP, not just the child.
 *
 * The negative pid is the whole point: `process.kill(-pid)` signals every process in the group the
 * `detached` spawn created. Signalling `pid` alone leaves a shell pipeline's children running after
 * the timeout supposedly stopped them.
 */
function killGroup(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // Already gone between the timeout firing and the signal — the desired end state either way.
  }
}
