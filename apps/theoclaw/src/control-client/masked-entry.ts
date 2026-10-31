import { installOutputMask, type MaskableStream } from '../channels/output-mask.js'

/**
 * Run a surface's `main` with `secrets` masked on its output streams (NFR-002): every write, a
 * `console.error` of a failed turn included, goes through the exact-value mask the instance itself
 * uses. The streams are restored once `main` settles, whether it resolved or threw.
 */
export async function runWithOutputMask<T>(
  secrets: readonly string[],
  main: () => Promise<T>,
  streams: readonly MaskableStream[] = [process.stdout, process.stderr],
): Promise<T> {
  const mask = installOutputMask(secrets, streams)
  try {
    return await main()
  } finally {
    mask.uninstall()
  }
}
