/**
 * Ends the process once stdout and stderr have handed what they hold to the system.
 *
 * When stdout is a non-blocking pipe (`docker exec`, a parent that reads the output), a write the
 * system did not take at once waits in Node's queue, and a bare `process.exit` drops it: the output
 * stopped at 64 KiB, so `theoclaw update` lost the `updated ...` line it prints after install.sh's
 * output. An empty write's callback runs after every earlier write was flushed.
 */
type Flushable = { write(chunk: string, done: () => void): boolean }

export async function exitAfterFlush(
  code: number,
  streams: readonly Flushable[] = [process.stdout, process.stderr],
  exit: (code: number) => void = (status) => process.exit(status),
): Promise<void> {
  for (const stream of streams)
    await new Promise<void>((resolve) => stream.write('', () => resolve()))
  exit(code)
}
