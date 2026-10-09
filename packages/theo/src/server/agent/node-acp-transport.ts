/**
 * The stdio transport `createACPTool` spawns by default: the agent as a Node subprocess (an adapter
 * concern per G8), and the process lifecycle around it. It changes for operating-system reasons
 * (signals, process groups, pipes), where `acp-tool.ts` changes for protocol reasons, so the two
 * live apart (review finding F-arch-5). `acp-tool.ts` re-exports everything here.
 *
 * The transport is a byte pipe: what the agent writes is judged by `AcpClient`. It reports the
 * process failing, its stdin breaking or the process exiting through `onClose`, with an
 * {@link AcpTransportClosedError}, and `close` ends the process and its group, SIGTERM first and
 * SIGKILL past a grace period.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

import type { AcpTransport } from '@theokit/agents'

/** The agent process could not start, failed, or exited before the call finished. */
export class AcpTransportClosedError extends Error {
  override readonly name = 'AcpTransportClosedError'

  constructor(
    /** The agent executable, as configured. */
    readonly command: string,
    /** What happened to the process, e.g. `exited with code 3` or `failed: spawn x ENOENT`. */
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`[theokit] createACPTool: the agent process "${command}" ${reason}`, options)
  }
}

/**
 * A transport `createACPTool` can release. `close` is called once when the call ends, and the
 * call waits for it when it returns a promise. `onClose`, inherited from {@link AcpTransport},
 * reports a channel that closed on its own (the process failed or exited), which rejects the request
 * in flight with the error it reports: {@link NodeAcpTransport} reports an
 * {@link AcpTransportClosedError}. Both are optional so a plain {@link AcpTransport} still works.
 */
export interface AcpToolTransport extends AcpTransport {
  close?(): void | Promise<void>
}

/** How long {@link NodeAcpTransport.close} waits after SIGTERM before it sends SIGKILL. */
const SIGTERM_GRACE_MS = 2_000
/** How long it waits for the exit SIGKILL causes; the signal cannot be ignored, so this is a bound. */
const SIGKILL_WAIT_MS = 2_000
/** How often {@link NodeAcpTransport.close} checks whether the agent's process group is gone. */
const GROUP_POLL_MS = 20

/**
 * Whether the agent gets its own process group. A launcher (`npx`, a shell script) runs the agent
 * as its child, so signalling only the pid the transport spawned ends the launcher and leaves the
 * agent running; signalling the group ends both. Windows has no process groups to signal this way:
 * there the transport signals the spawned process alone, as it always did, and an agent behind a
 * launcher can outlive the call.
 */
const OWN_PROCESS_GROUP = process.platform !== 'win32'

/** Stdio transport backed by a spawned subprocess (the default for `createACPTool`). */
export class NodeAcpTransport implements AcpToolTransport {
  // stdin=pipe, stdout=pipe, stderr=inherit → the third stream is null.
  private readonly proc: ChildProcessByStdio<Writable, Readable, null>
  private closed: AcpTransportClosedError | undefined
  private readonly listeners: ((error: AcpTransportClosedError) => void)[] = []
  /** Settles when the process has exited (or never started). */
  private readonly exited: Promise<void>

  constructor(
    private readonly command: string,
    args: string[] = [],
    cwd?: string,
  ) {
    // `detached` makes the agent the leader of a new process group (POSIX), the group close signals.
    this.proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'inherit'],
      detached: OWN_PROCESS_GROUP,
    })
    // A pipe cuts stdout wherever it likes; a streaming decoder carries a multibyte character split
    // across two chunks instead of turning each half into U+FFFD.
    this.proc.stdout.setEncoding('utf8')
    // 'exit', not 'close': a grandchild holding stdout open delays 'close' but not the exit.
    this.exited = new Promise((resolve) => {
      this.proc.once('exit', () => {
        resolve()
      })
    })
    // Without an 'error' listener a spawn failure (ENOENT) is thrown as an uncaught exception that
    // takes the host down; stdin raises EPIPE when the process is gone. Both end the channel.
    this.proc.on('error', (err) => {
      this.end(`failed: ${err.message}`, err)
    })
    this.proc.stdin.on('error', (err) => {
      this.end(`closed its stdin: ${err.message}`, err)
    })
    // 'close', not 'exit': it fires after stdout is drained, so a reply written just before the
    // process exits is still delivered.
    this.proc.on('close', (code, signal) => {
      this.end(code === null ? `exited on signal ${String(signal)}` : `exited with code ${code}`)
    })
  }

  send(line: string): void {
    if (this.closed === undefined) this.proc.stdin.write(line)
  }

  subscribe(onData: (chunk: string) => void): void {
    // A byte pipe: what the agent writes is judged by AcpClient, the one owner of the JSON-RPC
    // shape rule for every transport, which never throws back into this listener.
    this.proc.stdout.on('data', onData)
  }

  onClose(listener: (error: AcpTransportClosedError) => void): void {
    if (this.closed !== undefined) listener(this.closed)
    else this.listeners.push(listener)
  }

  /**
   * End the channel and the process, and settle once the process and its group have exited:
   * SIGTERM first, then SIGKILL for anything still running after {@link SIGTERM_GRACE_MS}.
   */
  async close(): Promise<void> {
    this.end('was closed by the caller')
    try {
      if (!this.running() && !this.groupAlive()) return
      this.signal('SIGTERM')
      if (await this.goneWithin(SIGTERM_GRACE_MS)) return
      this.signal('SIGKILL')
      await this.goneWithin(SIGKILL_WAIT_MS)
    } finally {
      // Nothing is read or written after close; a process that escaped its group and still holds
      // the pipes must not keep the host's event loop alive.
      this.proc.stdin.destroy()
      this.proc.stdout.destroy()
      this.proc.unref()
    }
  }

  /** Whether the process started and has not exited yet. */
  private running(): boolean {
    return (
      this.proc.pid !== undefined && this.proc.exitCode === null && this.proc.signalCode === null
    )
  }

  /** Whether a process of the agent's group is still running (always `false` without a group). */
  private groupAlive(): boolean {
    const pid = this.proc.pid
    if (!OWN_PROCESS_GROUP || pid === undefined) return false
    try {
      process.kill(-pid, 0)
      return true
    } catch (err) {
      // ESRCH: no process is left in the group. EPERM: one is, and it is not ours to signal.
      return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
  }

  /** Send `signal` to the agent's process group, or to the spawned process without one. */
  private signal(signal: NodeJS.Signals): void {
    const pid = this.proc.pid
    if (!OWN_PROCESS_GROUP || pid === undefined) {
      this.proc.kill(signal)
      return
    }
    try {
      process.kill(-pid, signal)
    } catch (err) {
      // The group emptied between the check and the signal: there is nothing left to end.
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err
    }
  }

  /** Wait up to `ms` for the process and every process of its group to exit; `true` when they did. */
  private async goneWithin(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms
    if (!(await this.exitsWithin(ms))) return false
    while (this.groupAlive()) {
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS))
    }
    return true
  }

  /** Wait up to `ms` for the process to exit; `true` when it did. */
  private async exitsWithin(ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const elapsed = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        resolve(false)
      }, ms)
    })
    try {
      return await Promise.race([this.exited.then(() => true as const), elapsed])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Record the first way the channel ended and tell every listener; later endings are ignored. */
  private end(reason: string, cause?: unknown): void {
    if (this.closed !== undefined) return
    const error = new AcpTransportClosedError(this.command, reason, { cause })
    this.closed = error
    for (const listener of this.listeners.splice(0)) listener(error)
  }
}
